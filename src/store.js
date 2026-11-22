// Forge Key-Value Store persistence. Free-tier friendly: decisions are small
// (~0.5 KB) and every read is a prefix query capped at MAX_DECISIONS.

import { kvs, WhereConditions } from '@forge/kvs';

export const MAX_DECISIONS = 1000;
const DEC = 'd:';
const SRC = 'src:';
const ISSUE = 'ic:';
const SETTINGS = 'settings';
const ACTIVITY = 'activity';

export const DEFAULT_SETTINGS = {
  autoScanPages: true, // extract decisions when Confluence pages are created/updated
  autoScanComments: true, // extract "Decision:" lines from Jira comments
  checkIssues: true, // check new issues / comments against the ledger
  autoComment: true, // post a short heads-up comment on Jira when a conflict is likely
  minConfidence: 0.55, // threshold for posting a comment
};

const safe = (s) => String(s).replace(/[^a-zA-Z0-9:._\-#]/g, '_').slice(0, 400);

export async function listDecisions() {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(DEC)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    for (const r of page.results) out.push(r.value);
    cursor = page.nextCursor;
  } while (cursor && out.length < MAX_DECISIONS);
  return out;
}

export const getDecision = (id) => kvs.get(DEC + safe(id));
export const putDecision = (d) => kvs.set(DEC + safe(d.id), d);
export const deleteDecision = (id) => kvs.delete(DEC + safe(id));

export async function getSourceIds(sourceKey) {
  return (await kvs.get(SRC + safe(sourceKey))) || [];
}
export const setSourceIds = (sourceKey, ids) => kvs.set(SRC + safe(sourceKey), ids);

export async function getIssueConflicts(issueKey) {
  return (await kvs.get(ISSUE + safe(issueKey))) || { issueKey, conflicts: [] };
}
export const setIssueConflicts = (issueKey, value) => kvs.set(ISSUE + safe(issueKey), value);

/** All per-issue conflict records (used for the "Flagged Jira issues" stat). */
export async function listIssueConflicts() {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(ISSUE)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    for (const r of page.results) out.push(r.value);
    cursor = page.nextCursor;
  } while (cursor && out.length < 500);
  return out;
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await kvs.get(SETTINGS)) || {}) };
}
export const setSettings = async (s) => {
  const merged = { ...(await getSettings()), ...s };
  await kvs.set(SETTINGS, merged);
  return merged;
};

export async function getActivity() {
  return (await kvs.get(ACTIVITY)) || [];
}
export async function logActivity(entry) {
  const list = await getActivity();
  list.unshift({ at: new Date().toISOString(), ...entry });
  await kvs.set(ACTIVITY, list.slice(0, 40));
}
