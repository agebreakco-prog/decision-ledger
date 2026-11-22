import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFromAdf, extractFromStorage, extractFromText, matchDecisionLine, splitRationale,
} from '../src/lib/extract.js';
import { confluencePageAdf } from './fixtures.js';

const meta = { source: { type: 'confluence-page', id: '123', title: 'Billing sync', url: 'https://x/wiki/123' } };

test('ADF: native decision items, Decisions heading, inline Agreed:, decision table', () => {
  const ds = extractFromAdf(confluencePageAdf, meta);
  const texts = ds.map((d) => d.text);
  assert.ok(texts.includes('Use PostgreSQL for the billing service'), texts.join(' | '));
  assert.ok(texts.includes('No deploys to production on Fridays'));
  assert.ok(texts.includes('Invoices are generated asynchronously via the job queue'));
  assert.ok(texts.includes('GraphQL over REST for the public API'));
  assert.ok(texts.includes('Feature flags are mandatory for all checkout changes'));
  assert.equal(ds.length, 5, texts.join(' | '));
});

test('ADF: skips UNDECIDED items and non-decision sections', () => {
  const texts = extractFromAdf(confluencePageAdf, meta).map((d) => d.text);
  assert.ok(!texts.some((t) => /S3/.test(t)));
  assert.ok(!texts.some((t) => /Marco to draft/.test(t)));
});

test('ADF: captures rationale, owner mention and method', () => {
  const ds = extractFromAdf(confluencePageAdf, meta);
  const pg = ds.find((d) => d.text.startsWith('Use PostgreSQL'));
  assert.match(pg.rationale, /transactional guarantees/);
  assert.equal(pg.owner.accountId, 'acc-priya');
  assert.equal(pg.method, 'decision-macro');
  const inv = ds.find((d) => d.text.startsWith('Invoices'));
  assert.match(inv.rationale, /checkout latency/);
  assert.equal(inv.method, 'heading');
  const ff = ds.find((d) => d.text.startsWith('Feature flags'));
  assert.equal(ff.rationale, 'Two incidents in Q3');
  assert.equal(ff.owner.accountId, 'acc-lena');
  assert.equal(ff.method, 'table');
  const gql = ds.find((d) => d.text.startsWith('GraphQL'));
  assert.match(gql.rationale, /partners asked/);
});

test('ids are stable across re-extraction and unique per source', () => {
  const a = extractFromAdf(confluencePageAdf, meta).map((d) => d.id);
  const b = extractFromAdf(confluencePageAdf, meta).map((d) => d.id);
  assert.deepEqual(a, b);
  const c = extractFromAdf(confluencePageAdf, { source: { ...meta.source, id: '999' } }).map((d) => d.id);
  assert.notDeepEqual(a, c);
  assert.equal(new Set(a).size, a.length);
});

test('matchDecisionLine recognises common phrasings', () => {
  assert.equal(matchDecisionLine('Decision: move standup to 9:30'), 'move standup to 9:30');
  assert.equal(matchDecisionLine('DECIDED - freeze hiring for Q1'), 'freeze hiring for Q1');
  assert.equal(matchDecisionLine('We decided to sunset the legacy mobile app'), 'sunset the legacy mobile app');
  assert.equal(matchDecisionLine('The team agreed that refunds over $500 need approval'), 'refunds over $500 need approval');
  assert.equal(matchDecisionLine('Let us decide later'), null);
  assert.equal(matchDecisionLine('We should discuss the decision next week'), null);
});

test('splitRationale', () => {
  assert.deepEqual(splitRationale('Use Kafka for events because SQS lacks replay.'), {
    text: 'Use Kafka for events',
    rationale: 'SQS lacks replay',
  });
  assert.deepEqual(splitRationale('Use Kafka for events'), { text: 'Use Kafka for events', rationale: '' });
});

test('plain text (Jira comment) extraction with rationale on next line and owner', () => {
  const comment = [
    'Thanks all, summarising the call.',
    'Decision: ship the EU pricing page on Dec 1 owner: @Marta Kowalski',
    'Why: legal sign-off is done',
    'Next we will look at APAC.',
  ].join('\n');
  const ds = extractFromText(comment, { source: { type: 'jira-comment', id: 'C-1' } });
  assert.equal(ds.length, 1);
  assert.match(ds[0].text, /^Ship the EU pricing page on Dec 1$/);
  assert.equal(ds[0].rationale, 'legal sign-off is done');
  assert.equal(ds[0].owner.name, 'Marta Kowalski');
});

test('plain text: markdown "## Decisions" section', () => {
  const md = '## Notes\n- talked about hiring\n## Decisions\n- Hire two contractors for the migration\n- Keep the release train at two weeks\n## Next steps\n- Book a room';
  const ds = extractFromText(md);
  assert.deepEqual(
    ds.map((d) => d.text),
    ['Hire two contractors for the migration', 'Keep the release train at two weeks']
  );
});

test('storage format: decision-item adf-node and inline Decided:', () => {
  const xhtml =
    '<p>Intro</p><ac:adf-extension><ac:adf-node type="decision-list"><ac:adf-node type="decision-item">' +
    '<ac:adf-attribute key="state">DECIDED</ac:adf-attribute><ac:adf-content>Use Terraform for all new infra</ac:adf-content>' +
    '</ac:adf-node></ac:adf-node></ac:adf-extension><p>Decided: retire Jenkins by March</p>';
  const ds = extractFromStorage(xhtml, meta);
  assert.deepEqual(ds.map((d) => d.text).sort(), ['Retire Jenkins by March', 'Use Terraform for all new infra']);
});

test('ignores empty / junk input', () => {
  assert.deepEqual(extractFromAdf(null), []);
  assert.deepEqual(extractFromText(''), []);
  assert.deepEqual(extractFromText('Decision: ok'), []);
});

test('ADF: trailing @mention owners are stripped from decision text and rationale', () => {
  const doc = { type: 'doc', content: [{ type: 'decisionList', content: [{ type: 'decisionItem', attrs: { state: 'DECIDED' }, content: [
    { type: 'text', text: 'use PostgreSQL for orders because we need ACID ' },
    { type: 'mention', attrs: { id: 'acc-1', text: '@age break' } },
  ] }] }] };
  const [d] = extractFromAdf(doc, {});
  assert.equal(d.text, 'Use PostgreSQL for orders');
  assert.equal(d.rationale, 'we need ACID');
  assert.equal(d.owner.accountId, 'acc-1');
});
