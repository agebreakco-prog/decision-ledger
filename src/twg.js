// Teamwork Graph (Preview) integration via curated queries — no Cypher
// registration needed. Used to answer "who should weigh in on this decision?":
// page owners + contributors of the source page, plus the teams they belong to.
// Every call degrades gracefully: missing scopes return empty results, errors
// return { available: false } and the UI falls back to the page author.

import api from '@forge/api';

export const pageAri = (cloudId, pageId) => `ari:cloud:confluence:${cloudId}:page/${pageId}`;
export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;

const PAGE_PEOPLE = `
query decisionLedger_pagePeople($id: ID!) {
  confluencePageOwners(id: $id, first: 5) {
    edges { node { __typename ... on AtlassianUser { id accountId name } } }
  }
  confluencePageContributors(id: $id, first: 10) {
    edges { node { __typename ... on AtlassianUser { id accountId name } } }
  }
}`;

const USER_TEAMS = `
query decisionLedger_userTeams($userId: ID!) {
  atlassianUserInTeams(userId: $userId, first: 5) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
  }
}`;

async function run(query, variables) {
  const res = await api.asUser().requestTeamworkGraph(query, variables);
  const body = await res.json();
  if (body.errors?.length && !body.data) throw new Error(body.errors[0].message);
  return body.data || {};
}

const nodes = (conn) => (conn?.edges || []).map((e) => e.node).filter(Boolean);

/** People (and their teams) connected to a decision's Confluence source page. */
export async function pageStakeholders(cloudId, pageId) {
  try {
    const data = await run(PAGE_PEOPLE, { id: pageAri(cloudId, pageId) });
    const owners = nodes(data.confluencePageOwners).map((u) => ({ ...u, role: 'owner' }));
    const contributors = nodes(data.confluencePageContributors)
      .filter((u) => !owners.some((o) => o.accountId === u.accountId))
      .map((u) => ({ ...u, role: 'contributor' }));
    const people = [...owners, ...contributors].slice(0, 8);
    const teams = new Map();
    for (const p of people.slice(0, 3)) {
      try {
        const t = await run(USER_TEAMS, { userId: userAri(p.accountId) });
        for (const team of nodes(t.atlassianUserInTeams)) teams.set(team.id, team.displayName);
      } catch {
        /* team scope not granted: ignore */
      }
    }
    return { available: true, people, teams: [...teams.values()] };
  } catch (e) {
    return { available: false, people: [], teams: [], error: String(e.message || e) };
  }
}
