// Service-layer tests with Forge storage and product APIs replaced by in-memory fakes.
// Run with --experimental-test-module-mocks (see package.json "test" script).
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import { confluencePageAdf } from './fixtures.js';

const kv = new Map();
const comments = [];
const settings = {
  autoScanPages: true, autoScanComments: true, checkIssues: true, autoComment: true, minConfidence: 0.55,
};
const issues = {
  'PAY-12': {
    id: '10012', key: 'PAY-12', summary: 'Migrate billing service to MongoDB',
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Switch to MongoDB for the billing service so we can iterate on the schema faster.' }] }] },
    labels: ['billing'], components: [], comments: [], self: 'https://acme.atlassian.net/rest/api/3/issue/10012',
  },
  'PAY-14': {
    id: '10014', key: 'PAY-14', summary: 'Checkout hotfix for coupon rounding',
    description: null, labels: ['checkout'], components: [],
    comments: [{ id: '501', body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Decision: round coupon discounts half-up\nWhy: matches finance reports' }] }] } }],
    self: 'https://acme.atlassian.net/rest/api/3/issue/10014',
  },
};

const storeUrl = new URL('../src/store.js', import.meta.url).href;
const atlUrl = new URL('../src/atlassian.js', import.meta.url).href;
const twgUrl = new URL('../src/twg.js', import.meta.url).href;

let svc;
before(async () => {
  mock.module(storeUrl, {
    namedExports: {
      listDecisions: async () => [...kv].filter(([k]) => k.startsWith('d:')).map(([, v]) => structuredClone(v)),
      getDecision: async (id) => structuredClone(kv.get('d:' + id)),
      putDecision: async (d) => kv.set('d:' + d.id, structuredClone(d)),
      deleteDecision: async (id) => kv.delete('d:' + id),
      getSourceIds: async (k) => kv.get('src:' + k) || [],
      setSourceIds: async (k, ids) => kv.set('src:' + k, ids),
      getIssueConflicts: async (k) => structuredClone(kv.get('ic:' + k)) || { issueKey: k, conflicts: [] },
      setIssueConflicts: async (k, v) => kv.set('ic:' + k, structuredClone(v)),
      listIssueConflicts: async () => [...kv].filter(([k]) => k.startsWith('ic:')).map(([, v]) => structuredClone(v)),
      getSettings: async () => settings,
      setSettings: async (s) => Object.assign(settings, s),
      getActivity: async () => kv.get('activity') || [],
      logActivity: async (e) => kv.set('activity', [e, ...(kv.get('activity') || [])]),
    },
  });
  mock.module(atlUrl, {
    namedExports: {
      getPage: async (id) => ({
        id, title: 'Billing platform sync', spaceId: '1', authorId: 'acc-author', updatedAt: '2026-11-04T10:00:00Z',
        url: `https://acme.atlassian.net/wiki/spaces/PAY/pages/${id}`, labels: ['billing'], adf: confluencePageAdf,
      }),
      getIssue: async (key) => structuredClone(issues[key]),
      getComment: async (key, id) => {
        if (key === 'PAY-12' && id === '900') {
          return { id, body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deploy the checkout hotfix to production on Friday evening' }] }] } };
        }
        return { id, body: issues[key].comments.find((c) => c.id === id).body };
      },
      addComment: async (key, body) => comments.push({ key, body }),
      issueBrowseUrl: (i) => `https://acme.atlassian.net/browse/${i.key}`,
      listSpaces: async () => [],
    },
  });
  mock.module(twgUrl, {
    namedExports: {
      pageStakeholders: async () => ({
        available: true,
        people: [{ accountId: 'acc-priya', name: 'Priya Shah', role: 'owner' }, { accountId: 'acc-marco', name: 'Marco', role: 'contributor' }],
        teams: ['Payments Platform'],
      }),
    },
  });
  svc = await import('../src/service.js');
});

test('scanPage ingests decisions and is idempotent', async () => {
  const r1 = await svc.scanPage('123', 'app');
  assert.equal(r1.total, 5);
  assert.equal(r1.added, 5);
  const r2 = await svc.scanPage('123', 'app');
  assert.equal(r2.added, 0);
  assert.equal((await svc.ledgerView({})).stats.active, 5);
});

test('issueInsights flags the MongoDB issue against the PostgreSQL decision', async () => {
  const i = await svc.issueInsights('PAY-12');
  assert.match(i.conflicts[0].decision.text, /PostgreSQL/);
  assert.match(i.conflicts[0].reasons[0], /mongodb/);
  assert.ok(i.related.length >= 1);
});

test('issueInsights lists decisions recorded in the issue comments', async () => {
  const i = await svc.issueInsights('PAY-14');
  assert.equal(i.recordedHere.length, 1);
  assert.equal(i.recordedHere[0].rationale, 'matches finance reports');
});

test('issue-created trigger stores the conflict and posts one warning comment', async () => {
  const r = await svc.onJiraIssueCreated('PAY-12', settings);
  assert.equal(r.conflicts, 1);
  assert.equal(comments.length, 1);
  const json = JSON.stringify(comments[0].body);
  assert.match(json, /Decision Ledger/);
  assert.match(json, /PostgreSQL/);
  // second event for the same issue does not spam
  await svc.onJiraIssueCreated('PAY-12', settings);
  assert.equal(comments.length, 1);
});

test('comment trigger: decisions extracted from Jira comments; conflicting comment flagged', async () => {
  const r = await svc.onJiraComment('PAY-14', '501', settings);
  assert.equal(r.extracted, 1);
  const r2 = await svc.onJiraComment('PAY-12', '900', settings);
  assert.equal(r2.conflicts, 1);
  assert.equal(comments.length, 2);
  assert.match(JSON.stringify(comments[1].body), /Fridays/);
});

test('recordDecision reports conflicts with existing decisions', async () => {
  const r = await svc.recordDecision({ text: 'Make feature flags optional for checkout copy changes', actor: 'acc-x' });
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].decision.text, /Feature flags/);
});

test('supersede marks the old decision and links the replacement', async () => {
  const ledger = await svc.ledgerView({ query: 'Friday deploys' });
  const old = ledger.results[0].decision;
  assert.match(old.text, /Fridays/);
  const r = await svc.supersede(old.id, 'Production deploys on Fridays are allowed before 12:00 with on-call approval', 'Weekend incidents dropped after the canary rollout');
  assert.equal(r.superseded.status, 'superseded');
  const after = await svc.ledgerView({ status: 'superseded' });
  assert.equal(after.results[0].decision.supersededBy, r.replacement.id);
  assert.match(after.results[0].decision.supersededByText, /before 12:00/);
  // superseded decisions no longer produce conflicts
  const check = await svc.checkText('Deploy the hotfix to production on Friday evening');
  assert.ok(!check.conflicts.some((c) => c.decision.id === old.id));
});

test('stakeholders via Teamwork Graph for Confluence-sourced decisions', async () => {
  const pg = (await svc.ledgerView({ query: 'PostgreSQL billing' })).results[0].decision;
  const s = await svc.stakeholders(pg.id, 'cloud-1');
  assert.equal(s.via, 'teamwork-graph');
  assert.equal(s.people[0].name, 'Priya Shah');
  assert.deepEqual(s.teams, ['Payments Platform']);
});

test('activity log records scans, conflicts and records', async () => {
  const v = await svc.ledgerView({});
  const kinds = new Set(v.activity.map((a) => a.kind));
  for (const k of ['scan', 'conflict', 'record', 'status']) assert.ok(kinds.has(k), k);
  assert.ok(v.stats.flaggedIssues >= 1, 'flagged Jira issues are counted');
  assert.ok(v.activity.some((a) => /^Captured \d+ decisions? from /.test(a.message)));
});

test('issue panel keeps showing conflicts flagged by triggers on older comments', async () => {
  // PAY-12's stored flags come from the issue-created and comment triggers above;
  // the Friday-deploy decision was superseded, so only the PostgreSQL flag remains.
  const i = await svc.issueInsights('PAY-12');
  assert.ok(i.conflicts.some((c) => /PostgreSQL/.test(c.decision.text)));
  assert.ok(!i.conflicts.some((c) => /Fridays/.test(c.decision.text)));
  await svc.dismissConflict('PAY-12', i.conflicts[0].decision.id);
  assert.deepEqual((await svc.issueInsights('PAY-12')).dismissed, [i.conflicts[0].decision.id]);
});
