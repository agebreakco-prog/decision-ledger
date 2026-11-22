---
name: decision-ledger
description: Look up, check against, and record team decisions stored in the Decision Ledger Forge app (Confluence + Jira) through its Atlassian MCP tools. Use before proposing architecture, process or policy changes, or when asked what the team decided about something.
---

# Decision Ledger (MCP)

The Decision Ledger app exposes these tools through the Atlassian MCP server
(`https://mcp.atlassian.com/forge/<appId>`, enabled by a site admin under
Atlassian Administration > Apps > Sites > Connected apps):

| Tool | Use it to |
| --- | --- |
| `find-decisions` | Find what was decided about a topic (`query`, optional `includeSuperseded`). |
| `check-conflicts` | Check a plan/RFC (`text`) or a Jira issue (`issueKey`) for contradictions with recorded decisions. |
| `issue-decisions` | List decisions related to a Jira issue (`issueKey`). |
| `record-decision` | Record a decision (`decision`, `rationale`, `owner`, `labels`, `issueKey`, `sourceUrl`). Confirm wording with the user first. |
| `decision-stakeholders` | Who to involve before changing a decision (`decisionId`), via Teamwork Graph. |

## Workflow
1. Before writing a design doc, plan or ticket, call `check-conflicts` with the proposal text.
2. If a conflict comes back, quote the decision, its rationale and source link, and ask the user whether to adjust the plan or change the decision.
3. To change a decision, call `decision-stakeholders` and tell the user who to consult; the change itself is made in Rovo or the Confluence "Decision Ledger" page.
4. After a meeting or discussion that reached a conclusion, offer to `record-decision` with a one-sentence decision and its rationale.

Results are rule-based (keyword/TF-IDF + stance analysis); describe conflicts as "possible" and show the confidence.
