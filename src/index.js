// Function entry points referenced from manifest.yml.
//   resolver            -> UI Kit frontends (Confluence global page, byline, Jira issue panel)
//   action handlers     -> Rovo agent actions, also exposed as MCP tools (rovo:mcp)
//   trigger handlers    -> Confluence page + Jira issue/comment events

import Resolver from '@forge/resolver';
import * as svc from './service.js';
import * as store from './store.js';
import { listSpaces } from './atlassian.js';
import { truncate } from './lib/text.js';

// ---------------- UI resolvers ----------------

const resolver = new Resolver();
const actor = (req) => req.context?.accountId || null;

resolver.define('ledger', ({ payload }) => svc.ledgerView(payload || {}));
resolver.define('spaces', () => listSpaces('user'));
resolver.define('scanSpace', ({ payload, context }) => svc.scanSpace(payload.spaceKey, payload.cursor, context?.accountId));
resolver.define('checkText', ({ payload }) => svc.checkText(payload.text));
resolver.define('record', (req) => svc.recordDecision({ ...req.payload, actor: actor(req) }));
resolver.define('setStatus', ({ payload }) => svc.setStatus(payload.id, payload.status, payload.supersededBy));
resolver.define('supersede', (req) => svc.supersede(req.payload.id, req.payload.text, req.payload.rationale, actor(req)));
resolver.define('stakeholders', ({ payload, context }) => svc.stakeholders(payload.id, context?.cloudId));
resolver.define('getSettings', () => store.getSettings());
resolver.define('saveSettings', ({ payload }) => store.setSettings(payload));

// Confluence page byline
resolver.define('pageDecisions', async ({ context }) => {
  const pageId = context?.extension?.content?.id;
  return { pageId, decisions: pageId ? await svc.decisionsForPage(pageId) : [] };
});
resolver.define('scanThisPage', async (req) => {
  const pageId = req.context?.extension?.content?.id;
  if (!pageId) throw new Error('No page in context');
  const r = await svc.scanPage(pageId, 'user', actor(req));
  return { ...r, decisions: await svc.decisionsForPage(pageId) };
});

// Jira issue panel
resolver.define('issueInsights', ({ context }) => svc.issueInsights(context.extension.issue.key, 'user'));
resolver.define('dismissConflict', ({ payload, context }) => svc.dismissConflict(context.extension.issue.key, payload.decisionId));
resolver.define('recordFromIssue', (req) =>
  svc.recordDecision({
    ...req.payload,
    issueKey: req.context.extension.issue.key,
    actor: actor(req),
  })
);

export const handler = resolver.getDefinitions();

// ---------------- Rovo actions / MCP tools ----------------

const accountOf = (payload, context) => context?.principal?.accountId || payload?.context?.accountId || null;
const issueKeyOf = (payload) => {
  const k = String(payload?.issueKey || '').trim().toUpperCase();
  if (/^[A-Z][A-Z0-9_]+-\d+$/.test(k)) return k;
  return payload?.context?.jira?.issueKey || null;
};
const line = (m) =>
  `- [${m.decision.status}] ${m.decision.text}${m.decision.rationale ? ` (why: ${truncate(m.decision.rationale, 100)})` : ''}` +
  `${m.decision.source?.url ? ` — source: ${m.decision.source.url}` : m.decision.source?.title ? ` — source: ${m.decision.source.title}` : ''}` +
  ` [id: ${m.decision.id}]`;

export async function findDecisionsAction(payload) {
  const view = await svc.ledgerView({ query: payload?.query || '', status: payload?.includeSuperseded ? 'all' : 'active', limit: 8 });
  if (!view.results.length) return { summary: `No recorded decisions match "${payload?.query || ''}".`, decisions: [] };
  return {
    summary: `${view.results.length} decision(s) found:\n${view.results.map(line).join('\n')}`,
    decisions: view.results.map((r) => ({ ...r.decision, relevance: r.score })),
  };
}

export async function checkConflictsAction(payload) {
  let text = payload?.text || '';
  const key = issueKeyOf(payload);
  if (!text && key) {
    const insight = await svc.issueInsights(key, 'user');
    return {
      summary: insight.conflicts.length
        ? `${key} may contradict ${insight.conflicts.length} decision(s):\n${insight.conflicts
            .map((c) => `${line(c)} — ${c.reasons.join(' ')} (confidence ${Math.round(c.confidence * 100)}%)`)
            .join('\n')}`
        : `${key} does not contradict any recorded decision. Related: ${insight.related.length}.`,
      conflicts: insight.conflicts,
      related: insight.related,
    };
  }
  if (!text) return { summary: 'Provide the proposal text or a Jira issue key to check.' };
  const r = await svc.checkText(text);
  return {
    summary: r.conflicts.length
      ? `Possible contradictions:\n${r.conflicts.map((c) => `${line(c)} — ${c.reasons.join(' ')} (confidence ${Math.round(c.confidence * 100)}%)`).join('\n')}`
      : `No contradictions found. ${r.related.length} related decision(s):\n${r.related.map(line).join('\n')}`,
    ...r,
  };
}

export async function recordDecisionAction(payload, context) {
  const r = await svc.recordDecision({
    text: payload?.decision,
    rationale: payload?.rationale,
    ownerName: payload?.owner,
    sourceUrl: payload?.sourceUrl || payload?.context?.jira?.url || payload?.context?.confluence?.url || '',
    issueKey: issueKeyOf(payload) || undefined,
    labels: payload?.labels ? String(payload.labels).split(',') : [],
    actor: accountOf(payload, context),
  });
  return {
    summary:
      `Recorded decision ${r.decision.id}: "${r.decision.text}".` +
      (r.conflicts.length ? ` Warning — it may contradict:\n${r.conflicts.map((c) => `${line(c)} — ${c.reasons.join(' ')}`).join('\n')}` : ' No conflicts with existing decisions.'),
    ...r,
  };
}

export async function issueDecisionsAction(payload) {
  const key = issueKeyOf(payload);
  if (!key) return { summary: 'Which Jira issue? Provide an issue key such as PROJ-123.' };
  const i = await svc.issueInsights(key, 'user');
  return {
    summary:
      `${key} "${i.issue.summary}": ${i.related.length} related decision(s), ${i.conflicts.length} possible conflict(s).\n` +
      i.related.map(line).join('\n'),
    ...i,
  };
}

export async function supersedeDecisionAction(payload, context) {
  const r = await svc.supersede(payload?.decisionId, payload?.newDecision, payload?.rationale, accountOf(payload, context));
  return { summary: `Superseded "${r.superseded.text}" with "${r.replacement.text}" (${r.replacement.id}).`, ...r };
}

export async function stakeholdersAction(payload) {
  const r = await svc.stakeholders(payload?.decisionId, payload?.context?.cloudId);
  const people = r.people.map((p) => `${p.name || p.accountId} (${p.role})`).join(', ') || 'unknown';
  return {
    summary: `People to involve for "${r.decision.text}": ${people}${r.teams.length ? `. Teams: ${r.teams.join(', ')}` : ''}. (source: ${r.via})`,
    ...r,
  };
}

export async function scanPageAction(payload, context) {
  const pageId = String(payload?.pageId || payload?.context?.confluence?.contentId || '').replace(/\D/g, '');
  if (!pageId) return { summary: 'Provide a Confluence page id, or run me from a Confluence page.' };
  const r = await svc.scanPage(pageId, 'user', accountOf(payload, context));
  return {
    summary: `Scanned "${r.page.title}": ${r.total} decision(s) (${r.added} new), ${r.conflicts} possible conflict(s).\n${r.decisions.map((d) => `- ${d.text}`).join('\n')}`,
    ...r,
  };
}

// ---------------- Event triggers ----------------

export async function onPageEvent(event) {
  const settings = await store.getSettings();
  if (!settings.autoScanPages) return;
  const pageId = event?.content?.id;
  if (!pageId) return;
  try {
    await svc.scanPage(String(pageId), 'app', event?.atlassianId);
  } catch (e) {
    console.warn(`page scan failed ${pageId}: ${e.message}`);
  }
}

export async function onIssueCreated(event) {
  const key = event?.issue?.key;
  if (!key) return;
  try {
    await svc.onJiraIssueCreated(key, await store.getSettings());
  } catch (e) {
    console.warn(`issue check failed ${key}: ${e.message}`);
  }
}

export async function onIssueCommented(event) {
  const key = event?.issue?.key;
  const commentId = event?.comment?.id;
  if (!key || !commentId) return;
  try {
    await svc.onJiraComment(key, commentId, await store.getSettings());
  } catch (e) {
    console.warn(`comment check failed ${key}#${commentId}: ${e.message}`);
  }
}
