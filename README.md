# Decision Ledger

**Your team's memory of what it decided, and a warning when new work contradicts it.**

Decision Ledger is a Forge app for **Confluence + Jira** with a **Rovo agent**, a reusable **Rovo skill**, **Atlassian MCP tools** (`rovo:mcp`) and **Teamwork Graph** lookups. It collects decisions (what, why, who, when, link) from Confluence pages and Jira comments into one ledger. It shows related decisions on every Jira issue and flags issues, comments and proposals that appear to contradict an active decision.

Matching is fully deterministic: keyword and TF-IDF relevance, plus rule-based stance and choice analysis. It makes **no Forge LLM calls**, so the app runs entirely inside Forge's free usage allowance. All the language understanding happens in Rovo, and Rovo usage is billed to the customer's Rovo credits, not to the app developer.

## What it does

| Surface | Module | What the user gets |
| --- | --- | --- |
| Confluence **Apps → Decision Ledger** | `confluence:globalPage` | The whole ledger with search and filters (status, source, label), stat tiles, a **Check a proposal** box, a space **backfill** scanner, manual recording, an activity feed, settings, and **Supersede** / **Retire** / **Who to involve** actions on each decision |
| Confluence page byline: **Decisions** | `confluence:contentBylineItem` | The decisions captured from the page you're on, possible conflicts, and a **Scan this page now** button |
| Jira issue **Related decisions** panel | `jira:issuePanel` | Conflicts (with reason and confidence) at the top, then related decisions with the matched terms, decisions made in this issue's comments, **Not a conflict** dismissal, and a **Record a decision** form |
| Automatic capture | `trigger` on `avi:confluence:created/updated:page` | Every published page is scanned for decisions |
| Automatic checks | `trigger` on `avi:jira:created:issue`, `avi:jira:commented:issue` | New issues and comments are checked against the ledger. `Decision: …` comments are captured. A likely conflict gets one short warning comment (you can turn this off) |
| Rovo agent **Decision Ledger** | `rovo:agent` + 7 `action`s | "What did we decide about X?", "Does this issue contradict anything?", record, supersede, who to involve, capture a page |
| Rovo skill **decision-conflict-review** | `rovo:skill` | A reusable playbook (check → explain → context → resolve) that any agent can load |
| MCP server **Decision Ledger MCP** | `rovo:mcp` | `find-decisions`, `check-conflicts`, `record-decision`, `issue-decisions` and `decision-stakeholders` as tools for Rovo Studio agents and external MCP clients. Open-source [`mcp/SKILL.md`](mcp/SKILL.md) for third-party agents |
| Teamwork Graph | `requestTeamworkGraph` curated queries | **Who to involve**: owners and contributors of the source page (`confluencePageOwners`, `confluencePageContributors`) and their teams (`atlassianUserInTeams`) |

### What counts as a decision

- Native Confluence **decision items** (`/decision` in the editor). Only items in the `DECIDED` state count; the first @mention becomes the owner.
- Anything under a heading such as **Decisions**, **Decision log**, **Outcomes**, **Resolutions** or **What we decided**, up to the next heading at the same level.
- **Decision-log tables** with a *Decision / Outcome* column, plus optional *Why/Rationale* and *Owner* columns.
- Lines such as `Decision: …`, `Decided: …`, `Agreed: …`, `Resolution: …`, and sentences such as "We decided to …" or "The team agreed that …".
- Rationale is taken from `because / since / due to / so that …` in the same sentence, or from a `Why:` / `Rationale:` line right after it.

### How contradictions are detected (`src/lib/match.js`)

A proposal is flagged against an active decision when they share a topic (TF-IDF cosine on stemmed topic terms, with stance words removed) **and** at least one of these holds:

1. **Different choice, same scope.** The decision says "Use **PostgreSQL** for the billing service" and the proposal says "Switch to **MongoDB** for the billing service".
2. **A rejected alternative comes back.** The decision says "GraphQL **over REST**" and the proposal says "Add a REST endpoint".
3. **What the decision chose is dropped.** The proposal says "stop using PostgreSQL".
4. **Opposite stance.** For example "Refunds over $500 require approval" vs "Auto-approve refunds … without review", or "No production deploys on Fridays" vs "Deploy … to production on Friday".
5. **Antonyms on the same topic.** For example sync/async, mandatory/optional, weekly/monthly, public/private or enable/disable.

Each flag comes with a plain-English reason and a confidence score. Users can dismiss a flag on an issue. Superseded decisions never raise flags.

## Project layout

```
manifest.yml                 modules, actions, MCP, skill, triggers, scopes
src/index.js                 resolver + Rovo action + trigger handlers
src/service.js               ingest, issue insights, record/supersede, conflict comments
src/store.js                 Forge KVS persistence (@forge/kvs)
src/atlassian.js             Confluence v2 / Jira v3 REST adapters
src/twg.js                   Teamwork Graph curated queries
src/lib/extract.js           decision extraction (ADF, storage XHTML, plain text)
src/lib/match.js             TF-IDF relevance, stance/choice/antonym conflict detection
src/lib/text.js              tokenizer, stemmer, lexicons
src/frontend/*.jsx           UI Kit: ledger page, page byline, Jira issue panel
resource/agent/prompt.txt    Rovo agent prompt
skills/decision-conflict-review/SKILL.md   rovo:skill
mcp/SKILL.md                 open-source skill for third-party MCP clients
demo/demo-data.js            exact demo content (also used by tests)
test/*.test.js               50 unit + service tests (node:test)
scripts/offline-lint.cjs     runs the Forge CLI's manifest validator + linters without login
```

## Develop and test

Requires Node 22.12 or later. `forge` CLI 15 needs Node ≥ 22.23.4 or ≥ 24.22.1, so the project pins `@forge/cli@14.2.0` locally.

```bash
npm install
npm test               # 50 tests: extraction, matching, demo scenario, service layer with mocked Forge APIs
npm run lint:offline   # Forge manifest schema validation + Forge client-side linters (no login needed)
npm run check          # both
```

## Deploy (needs an Atlassian account)

```bash
npx forge login                       # email + API token from https://id.atlassian.com/manage-profile/security/api-tokens
npx forge register "Decision Ledger"  # writes the real app.id into manifest.yml
npx forge lint
npx forge deploy -e development
npx forge install --site <your-site>.atlassian.net --product confluence -e development   # required product first
npx forge install --site <your-site>.atlassian.net --product jira -e development
```

Rovo has to be enabled on the site for the agent to appear. To enable external MCP clients, a site admin turns the tools on under **Atlassian Administration → Apps → Sites → Connected apps → Decision Ledger**. The endpoint is `https://mcp.atlassian.com/forge/<appId>`.

To give judges access, run `npx forge deploy -e production`. Then in the developer console, open **Distribution**, choose **Sharing**, and select both **Confluence** and **Jira** to get the installation link.

## Cost and free-tier notes

- **No Forge LLM usage.** There are no `@forge/llm` imports and no `llm` module (the linter checks this). Rovo agent conversations use the customer's Rovo credits. Forge only bills the developer for compute, storage and logs above the free monthly allowance.
- **Functions** use 256 MB on arm64. A page scan or issue check takes well under 1 s, which is about 0.25 GB-s. The free allowance is 200,000 GB-s per month, enough for roughly 800k invocations.
- **KVS.** Each decision is about 0.5 KB. Listing a 200-decision ledger reads about 100 KB, so the free 0.1 GB of reads per month covers about 1,000 full-ledger loads. Writes happen only when decisions change.
- **Logs.** The app logs only `console.warn` on failures.
- **Teamwork Graph and product REST APIs** have no Forge charge.

## Limits and roadmap

- Matching is lexical. Paraphrases with no shared vocabulary ("datastore" vs "database") are missed. A synonym list or optional Rovo-assisted check would fix this.
- KVS reads the whole ledger, which is fine for up to about 1,000 decisions. Larger ledgers should move to the Forge SQL free tier with per-label indexes.
- The Teamwork Graph API is in Preview. If the admin declines the graph scopes, the app falls back to the recorded decision owner.
