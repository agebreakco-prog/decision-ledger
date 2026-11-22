// Thin adapters over the Confluence v2 and Jira v3 REST APIs.
// `who` is 'user' (resolvers / Rovo actions: respects the viewer's permissions)
// or 'app' (event triggers).

import api, { route } from '@forge/api';

const as = (who) => (who === 'app' ? api.asApp() : api.asUser());

async function json(res, what) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${what} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ---------------- Confluence ----------------

function parseAdf(page) {
  const raw = page?.body?.atlas_doc_format?.value;
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function pageUrl(page, base) {
  const webui = page?._links?.webui;
  const b = page?._links?.base || base || '';
  return webui ? `${b}${webui}` : '';
}

export async function getPage(pageId, who = 'user') {
  const res = await as(who).requestConfluence(
    route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format&include-labels=true`,
    { headers: { Accept: 'application/json' } }
  );
  const page = await json(res, `Get page ${pageId}`);
  return {
    id: String(page.id),
    title: page.title,
    spaceId: page.spaceId,
    authorId: page.ownerId || page.authorId,
    updatedAt: page.version?.createdAt || page.createdAt,
    url: pageUrl(page),
    labels: (page.labels?.results || []).map((l) => l.name),
    adf: parseAdf(page),
  };
}

export async function getSpaceByKey(spaceKey, who = 'user') {
  const res = await as(who).requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`, {
    headers: { Accept: 'application/json' },
  });
  const data = await json(res, `Get space ${spaceKey}`);
  return data.results?.[0] || null;
}

export async function listSpaces(who = 'user') {
  const res = await as(who).requestConfluence(route`/wiki/api/v2/spaces?limit=50&sort=name`, {
    headers: { Accept: 'application/json' },
  });
  const data = await json(res, 'List spaces');
  return (data.results || []).map((s) => ({ id: s.id, key: s.key, name: s.name }));
}

/** One page (max 25) of a space's pages with bodies. Returns { pages, cursor }. */
export async function listSpacePages(spaceId, cursor, who = 'user') {
  const r = cursor
    ? route`/wiki/api/v2/spaces/${spaceId}/pages?limit=25&body-format=atlas_doc_format&cursor=${cursor}`
    : route`/wiki/api/v2/spaces/${spaceId}/pages?limit=25&body-format=atlas_doc_format`;
  const res = await as(who).requestConfluence(r, { headers: { Accept: 'application/json' } });
  const data = await json(res, `List pages of space ${spaceId}`);
  const next = data._links?.next ? new URL(data._links.next, 'https://x').searchParams.get('cursor') : null;
  return {
    pages: (data.results || []).map((p) => ({
      id: String(p.id),
      title: p.title,
      spaceId: p.spaceId,
      authorId: p.ownerId || p.authorId,
      updatedAt: p.version?.createdAt || p.createdAt,
      url: pageUrl(p, data._links?.base),
      labels: [],
      adf: parseAdf(p),
    })),
    cursor: next,
  };
}

// ---------------- Jira ----------------

export async function getIssue(issueKey, who = 'user') {
  const res = await as(who).requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=summary,description,labels,components,issuetype,status,comment,project`,
    { headers: { Accept: 'application/json' } }
  );
  const issue = await json(res, `Get issue ${issueKey}`);
  const f = issue.fields || {};
  return {
    id: issue.id,
    key: issue.key,
    summary: f.summary || '',
    description: f.description || null, // ADF
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    projectKey: f.project?.key,
    status: f.status?.name,
    comments: (f.comment?.comments || []).slice(-20).map((c) => ({
      id: c.id,
      body: c.body,
      authorId: c.author?.accountId,
      authorName: c.author?.displayName,
      created: c.created,
    })),
    self: issue.self,
  };
}

export async function getComment(issueKey, commentId, who = 'app') {
  const res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`, {
    headers: { Accept: 'application/json' },
  });
  const c = await json(res, `Get comment ${commentId}`);
  return { id: c.id, body: c.body, authorId: c.author?.accountId, authorName: c.author?.displayName, created: c.created };
}

export async function addComment(issueKey, adfBody, who = 'app') {
  const res = await as(who).requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: adfBody }),
  });
  return json(res, `Comment on ${issueKey}`);
}

export function issueBrowseUrl(issue) {
  try {
    const u = new URL(issue.self);
    return `${u.origin}/browse/${issue.key}`;
  } catch {
    return '';
  }
}
