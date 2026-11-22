// Business operations shared by UI resolvers, Rovo actions / MCP tools and
// event triggers. All AI-free and deterministic: no Forge LLM calls.

import * as store from './store.js';
import * as atl from './atlassian.js';
import { pageStakeholders } from './twg.js';
import { adfText, extractFromAdf, extractFromText } from './lib/extract.js';
import { buildIndex, detectConflict, findConflicts, related, searchLedger } from './lib/match.js';
import { clean, hash, truncate } from './lib/text.js';

// ---------- ingest ----------

/**
 * Replace the decisions that came from one source (page / comment) with a
 * fresh extraction, keep human edits (status, supersededBy) on unchanged ids,
 * and cross-check new decisions against the rest of the ledger.
 */
export async function ingest(sourceKey, extracted, { actor } = {}) {
  const oldIds = await store.getSourceIds(sourceKey);
  const newIds = extracted.map((d) => d.id);
  const ledger = await store.listDecisions();
  const others = ledger.filter((d) => !newIds.includes(d.id) && !oldIds.includes(d.id));
  const { idf } = buildIndex(others.length ? others : extracted);

  const added = [];
  const conflicts = [];
  for (const d of extracted) {
    const existing = ledger.find((x) => x.id === d.id);
    const merged = existing
      ? { ...d, status: existing.status, supersededBy: existing.supersededBy, recordedBy: existing.recordedBy }
      : { ...d, recordedBy: actor || null, recordedAt: new Date().toISOString() };
    merged.conflictsWith = others
      .filter((o) => o.status !== 'superseded')
      .map((o) => ({ o, r: detectConflict(merged.text, o, idf) }))
      .filter(({ r }) => r.conflict)
      .map(({ o, r }) => ({ id: o.id, text: truncate(o.text, 120), confidence: r.confidence, reasons: r.reasons }))
      .slice(0, 3);
    if (merged.conflictsWith.length) conflicts.push({ decision: merged, with: merged.conflictsWith });
    if (!existing) added.push(merged);
    await store.putDecision(merged);
  }
  const removed = oldIds.filter((id) => !newIds.includes(id));
  for (const id of removed) await store.deleteDecision(id);
  await store.setSourceIds(sourceKey, newIds);

  if (added.length || removed.length) {
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const parts = [added.length ? `Captured ${plural(added.length, 'decision')}` : '', removed.length ? `removed ${plural(removed.length, 'decision')}` : '']
      .filter(Boolean)
      .join(', ');
    await store.logActivity({
      kind: 'scan',
      message: `${parts.charAt(0).toUpperCase() + parts.slice(1)} from ${extracted[0]?.source?.title || sourceKey}`,
      source: extracted[0]?.source || null,
    });
  }
  for (const c of conflicts) {
    await store.logActivity({
      kind: 'conflict',
      message: `New decision "${truncate(c.decision.text, 70)}" may contradict "${truncate(c.with[0].text, 70)}"`,
      source: c.decision.source,
      decisionId: c.decision.id,
    });
  }
  return { added: added.length, removed: removed.length, total: newIds.length, conflicts: conflicts.length };
}

function pageMeta(page) {
  return {
    source: { type: 'confluence-page', id: page.id, title: page.title, url: page.url, spaceId: page.spaceId },
    owner: page.authorId ? { accountId: page.authorId } : null,
    decidedAt: page.updatedAt,
    labels: page.labels || [],
  };
}

export async function scanPage(pageId, who = 'user', actor) {
  const page = await atl.getPage(pageId, who);
  const decisions = extractFromAdf(page.adf, pageMeta(page));
  const result = await ingest(`page:${page.id}`, decisions, { actor });
  return { ...result, page: { id: page.id, title: page.title, url: page.url }, decisions };
}

/** Backfill one batch (25 pages) of a space; returns a cursor to continue. */
export async function scanSpace(spaceKey, cursor, actor) {
  const space = await atl.getSpaceByKey(spaceKey);
  if (!space) throw new Error(`Space ${spaceKey} not found`);
  const { pages, cursor: next } = await atl.listSpacePages(space.id, cursor);
  let found = 0;
  let conflicts = 0;
  for (const page of pages) {
    if (!page.adf) continue;
    const ds = extractFromAdf(page.adf, pageMeta(page));
    if (!ds.length && !(await store.getSourceIds(`page:${page.id}`)).length) continue;
    const r = await ingest(`page:${page.id}`, ds, { actor });
    found += r.total;
    conflicts += r.conflicts;
  }
  return { scanned: pages.length, found, conflicts, cursor: next };
}

// ---------- Jira ----------

function commentMeta(issue, comment, baseUrl) {
  return {
    source: {
      type: 'jira-comment',
      id: `${issue.key}#${comment.id}`,
      title: `${issue.key}: ${issue.summary}`,
      url: baseUrl ? `${baseUrl}?focusedCommentId=${comment.id}` : '',
      issueKey: issue.key,
    },
    owner: comment.authorId ? { accountId: comment.authorId, name: comment.authorName } : null,
    decidedAt: comment.created,
    labels: [...(issue.labels || []), ...(issue.components || [])],
  };
}

const isLedgerComment = (text) => /^\s*decision ledger\b/i.test(text || '');
const issueText = (issue) => `${issue.summary}\n${adfText(issue.description)}`;

/** Live view for the Jira issue panel. */
export async function issueInsights(issueKey, who = 'user') {
  const issue = await atl.getIssue(issueKey, who);
  const ledger = await store.listDecisions();
  const ownIds = new Set();
  const url = atl.issueBrowseUrl(issue);
  // Decisions recorded *in* this issue's comments.
  const fromComments = [];
  for (const c of issue.comments) {
    for (const d of extractFromText(adfText(c.body), commentMeta(issue, c, url))) {
      ownIds.add(d.id);
      fromComments.push(d);
    }
  }
  const text = issueText(issue);
  const labels = [...issue.labels, ...issue.components];
  const rel = related(text, ledger.filter((d) => !ownIds.has(d.id)), { labels, limit: 6 });
  // Latest human comment; the app's own "Decision Ledger:" warnings are skipped so they never re-trigger a match.
  const humanComments = issue.comments.map((c) => adfText(c.body)).filter((t) => !isLedgerComment(t));
  const latestComment = humanComments.length ? humanComments[humanComments.length - 1] : '';
  const conflictsIssue = findConflicts(text, ledger, { excludeIds: [...ownIds] });
  const conflictsComment = latestComment ? findConflicts(latestComment, ledger, { excludeIds: [...ownIds] }) : [];
  const byId = new Map();
  for (const c of [...conflictsIssue.map((c) => ({ ...c, where: 'issue' })), ...conflictsComment.map((c) => ({ ...c, where: 'latest comment' }))]) {
    const prev = byId.get(c.decision.id);
    if (!prev || prev.confidence < c.confidence) byId.set(c.decision.id, c);
  }
  // Conflicts flagged earlier by triggers (e.g. an older comment) stay visible until dismissed.
  const stored = await store.getIssueConflicts(issueKey);
  for (const s of stored.conflicts || []) {
    if (byId.has(s.decisionId)) continue;
    const d = ledger.find((x) => x.id === s.decisionId);
    if (d && d.status !== 'superseded') {
      byId.set(d.id, { decision: d, confidence: s.confidence, reasons: s.reasons, where: `earlier ${s.where}` });
    }
  }
  return {
    issue: { key: issue.key, summary: issue.summary, url, labels },
    related: rel.map(slimMatch),
    conflicts: [...byId.values()].sort((a, b) => b.confidence - a.confidence).map((c) => ({ ...slimMatch(c), where: c.where })),
    recordedHere: fromComments.map(slim),
    dismissed: stored.dismissed || [],
    ledgerSize: ledger.length,
  };
}

/** Trigger: new comment. Extract decisions, then check it against the ledger. */
export async function onJiraComment(issueKey, commentId, settings) {
  const issue = await atl.getIssue(issueKey, 'app');
  const comment = await atl.getComment(issueKey, commentId, 'app');
  const text = adfText(comment.body);
  const out = { extracted: 0, conflicts: 0 };
  if (settings.autoScanComments) {
    const ds = extractFromText(text, commentMeta(issue, comment, atl.issueBrowseUrl(issue)));
    if (ds.length) out.extracted = (await ingest(`comment:${issue.key}#${comment.id}`, ds)).total;
  }
  if (settings.checkIssues && !isLedgerComment(text)) {
    out.conflicts = await flagConflicts(issue, text, 'comment', settings);
  }
  return out;
}

/** Trigger: new issue. */
export async function onJiraIssueCreated(issueKey, settings) {
  if (!settings.checkIssues) return { conflicts: 0 };
  const issue = await atl.getIssue(issueKey, 'app');
  return { conflicts: await flagConflicts(issue, issueText(issue), 'issue', settings) };
}

async function flagConflicts(issue, text, where, settings) {
  const ledger = await store.listDecisions();
  const own = ledger.filter((d) => d.source?.issueKey === issue.key).map((d) => d.id);
  const conflicts = findConflicts(text, ledger, { excludeIds: own, limit: 3 });
  if (!conflicts.length) return 0;
  const state = await store.getIssueConflicts(issue.key);
  const already = new Set((state.conflicts || []).map((c) => c.decisionId));
  const fresh = conflicts.filter((c) => !already.has(c.decision.id));
  state.conflicts = [
    ...(state.conflicts || []),
    ...fresh.map((c) => ({ decisionId: c.decision.id, confidence: c.confidence, reasons: c.reasons, where, at: new Date().toISOString() })),
  ].slice(-20);
  await store.setIssueConflicts(issue.key, state);
  for (const c of fresh) {
    await store.logActivity({
      kind: 'conflict',
      message: `${issue.key} (${where}) may contradict "${truncate(c.decision.text, 80)}"`,
      issueKey: issue.key,
      decisionId: c.decision.id,
    });
  }
  const worth = fresh.filter((c) => c.confidence >= settings.minConfidence);
  if (settings.autoComment && worth.length) {
    await atl.addComment(issue.key, conflictCommentAdf(worth, where), 'app');
  }
  return fresh.length;
}

export function conflictCommentAdf(conflicts, where) {
  const items = conflicts.map((c) => {
    const d = c.decision;
    const label = truncate(d.text, 160);
    const textNode = d.source?.url
      ? { type: 'text', text: label, marks: [{ type: 'link', attrs: { href: d.source.url } }] }
      : { type: 'text', text: label };
    return {
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [
            textNode,
            { type: 'text', text: ` — ${c.reasons[0] || 'possible contradiction'} (confidence ${Math.round(c.confidence * 100)}%)` },
          ],
        },
      ],
    };
  });
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'panel',
        attrs: { panelType: 'warning' },
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Decision Ledger: ', marks: [{ type: 'strong' }] },
              { type: 'text', text: `this ${where} may contradict ${conflicts.length === 1 ? 'a recorded team decision' : `${conflicts.length} recorded team decisions`}:` },
            ],
          },
          { type: 'bulletList', content: items },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Open the "Related decisions" panel on this issue to review or dismiss this flag. To change the decision, supersede it in Confluence → Apps → Decision Ledger.', marks: [{ type: 'em' }] }],
          },
        ],
      },
    ],
  };
}

export async function dismissConflict(issueKey, decisionId) {
  const state = await store.getIssueConflicts(issueKey);
  state.dismissed = [...new Set([...(state.dismissed || []), decisionId])];
  await store.setIssueConflicts(issueKey, state);
  return state;
}

// ---------- ledger operations ----------

export async function recordDecision({ text, rationale = '', ownerAccountId, ownerName, sourceUrl = '', sourceTitle = '', issueKey, labels = [], actor }) {
  const body = clean(text);
  if (body.length < 6) throw new Error('Decision text is too short.');
  const id = `manual-${hash(`${issueKey || ''}|${body.toLowerCase()}`)}`;
  const decision = {
    id,
    text: body,
    rationale: clean(rationale),
    owner: ownerAccountId ? { accountId: ownerAccountId, name: ownerName } : actor ? { accountId: actor } : ownerName ? { name: ownerName } : null,
    decidedAt: new Date().toISOString(),
    source: {
      type: issueKey ? 'jira-issue' : 'manual',
      id: issueKey || id,
      title: sourceTitle || (issueKey ? issueKey : 'Recorded manually'),
      url: sourceUrl,
      issueKey: issueKey || undefined,
    },
    labels: (Array.isArray(labels) ? labels : String(labels).split(',')).map((l) => clean(l)).filter(Boolean),
    status: 'active',
    method: 'manual',
  };
  const ledger = await store.listDecisions();
  const conflicts = findConflicts(decision.text, ledger, { excludeIds: [id] });
  decision.conflictsWith = conflicts.map((c) => ({ id: c.decision.id, text: truncate(c.decision.text, 120), confidence: c.confidence, reasons: c.reasons }));
  decision.recordedBy = actor || null;
  decision.recordedAt = new Date().toISOString();
  await store.putDecision(decision);
  await store.logActivity({ kind: 'record', message: `Recorded: "${truncate(decision.text, 90)}"`, decisionId: id });
  return { decision: slim(decision), conflicts: conflicts.map(slimMatch) };
}

export async function setStatus(id, status, supersededBy) {
  const d = await store.getDecision(id);
  if (!d) throw new Error(`Decision ${id} not found`);
  d.status = status;
  if (supersededBy) d.supersededBy = supersededBy;
  if (status === 'active') delete d.supersededBy;
  await store.putDecision(d);
  await store.logActivity({ kind: 'status', message: `Marked ${status}: "${truncate(d.text, 80)}"`, decisionId: id });
  return slim(d);
}

/** Supersede an old decision with a new one in a single step. */
export async function supersede(id, newText, rationale, actor) {
  const old = await store.getDecision(id);
  if (!old) throw new Error(`Decision ${id} not found`);
  const created = await recordDecision({
    text: newText,
    rationale: rationale || `Supersedes: ${old.text}`,
    labels: old.labels,
    sourceUrl: old.source?.url,
    sourceTitle: old.source?.title,
    actor,
  });
  await setStatus(id, 'superseded', created.decision.id);
  return { superseded: slim({ ...old, status: 'superseded' }), replacement: created.decision };
}

export async function ledgerView(filters = {}) {
  const ledger = await store.listDecisions();
  const results = searchLedger(ledger, filters);
  const labels = [...new Set(ledger.flatMap((d) => d.labels || []))].sort().slice(0, 50);
  const byId = new Map(ledger.map((d) => [d.id, d]));
  // Jira issues with at least one open (not dismissed, still active) conflict flag.
  const issueFlags = typeof store.listIssueConflicts === 'function' ? await store.listIssueConflicts() : [];
  const flaggedIssues = issueFlags.filter((s) =>
    (s.conflicts || []).some((c) => !(s.dismissed || []).includes(c.decisionId) && byId.get(c.decisionId)?.status !== 'superseded' && byId.has(c.decisionId))
  ).length;
  return {
    results: results.map(slimMatch).map((r) => {
      const next = r.decision.supersededBy && byId.get(r.decision.supersededBy);
      return next ? { ...r, decision: { ...r.decision, supersededByText: next.text } } : r;
    }),
    stats: {
      total: ledger.length,
      active: ledger.filter((d) => d.status !== 'superseded').length,
      superseded: ledger.filter((d) => d.status === 'superseded').length,
      withConflicts: ledger.filter((d) => d.status !== 'superseded' && d.conflictsWith?.length).length,
      fromConfluence: ledger.filter((d) => d.source?.type === 'confluence-page').length,
      fromJira: ledger.filter((d) => String(d.source?.type).startsWith('jira')).length,
      flaggedIssues,
    },
    labels,
    activity: (await store.getActivity()).slice(0, 12),
  };
}

export async function checkText(text, limit = 5) {
  const ledger = await store.listDecisions();
  return {
    conflicts: findConflicts(text, ledger, { limit }).map(slimMatch),
    related: related(text, ledger, { limit }).map(slimMatch),
  };
}

export async function stakeholders(decisionId, cloudId) {
  const d = await store.getDecision(decisionId);
  if (!d) throw new Error(`Decision ${decisionId} not found`);
  const fallback = d.owner ? [{ accountId: d.owner.accountId, name: d.owner.name, role: 'decision owner' }] : [];
  if (d.source?.type !== 'confluence-page' || !cloudId) return { decision: slim(d), people: fallback, teams: [], via: 'ledger' };
  const g = await pageStakeholders(cloudId, d.source.id);
  if (!g.available || !g.people.length) return { decision: slim(d), people: fallback, teams: [], via: 'ledger', note: g.error };
  return { decision: slim(d), people: g.people, teams: g.teams, via: 'teamwork-graph' };
}

export async function decisionsForPage(pageId) {
  const ids = await store.getSourceIds(`page:${pageId}`);
  const out = [];
  for (const id of ids) {
    const d = await store.getDecision(id);
    if (d) out.push(slim(d));
  }
  return out;
}

// ---------- shaping ----------

export function slim(d) {
  return {
    id: d.id,
    // Older records may start lowercase ("reporting queries …"); display them as sentences.
    text: d.text ? d.text.charAt(0).toUpperCase() + d.text.slice(1) : d.text,
    rationale: d.rationale || '',
    owner: d.owner || null,
    decidedAt: d.decidedAt,
    status: d.status || 'active',
    supersededBy: d.supersededBy || null,
    labels: d.labels || [],
    source: d.source || null,
    method: d.method,
    conflictsWith: d.conflictsWith || [],
  };
}

function slimMatch(m) {
  return {
    decision: slim(m.decision),
    score: m.score ?? null,
    matchedTerms: m.matchedTerms || [],
    confidence: m.confidence ?? null,
    reasons: m.reasons || [],
  };
}
