# Decision Ledger

**Your team's memory of what it decided, and a warning when new work contradicts it.**

Decision Ledger is a Forge app for **Confluence + Jira** with a **Rovo agent**, a reusable **Rovo skill**, **Atlassian MCP tools** (`rovo:mcp`) and **Teamwork Graph** lookups. It collects decisions (what, why, who, when, link) from Confluence pages and Jira comments into one ledger. It shows related decisions on every Jira issue and flags issues, comments and proposals that appear to contradict an active decision.

Matching is fully deterministic: TF-IDF relevance over normalised terms (Postgres = PostgreSQL, k8s = Kubernetes, "turn off" = disable), plus rule-based stance, choice and number/threshold analysis. Every flag says why. It makes **no Forge LLM calls**, so the app runs entirely inside Forge's free usage allowance. All the language understanding happens in Rovo, and Rovo usage is billed to the customer's Rovo credits, not to the app developer.

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
5. **Antonyms on the same topic.** For example sync/async, mandatory/optional, weekly/monthly, public/private, enable/disable, allow/deny or raise/lower.
6. **A different number for the same thing** (`src/lib/numeric.js`). Quantities are parsed with their unit (ms/s/min/h/days, %, $/€/£, KB–TB, counts such as approvals or retries) and their comparator (*under*, *at most*, *at least*, *or more*). "Timeout is 30 seconds" vs "raise the timeout to 60s" is flagged, and so is "coverage at least 80%" vs "lower the gate to 70%". "Latency under 300ms" vs "p95 is now 240ms" is not, because 240 ms is within the limit. Two numbers are only compared when they use the same unit and the words around them share a topic.

Before any rule runs, both texts are normalised (`src/lib/text.js`):

- **Phrasal decision verbs** map to stance words. *turn/switch off* becomes **disable**, *turn on* becomes **enable**, *phase out / move away from / migrate off / get rid of* becomes **drop**, *stay on / stick with* becomes **keep**, and *roll back* becomes **revert**.
- **Entity aliases and synonyms** map to one term: Postgres/psql/pg → PostgreSQL, Mongo → MongoDB, k8s → Kubernetes, 2FA/MFA/two-factor → mfa, PR/MR/pull request → pull-request, feature toggle → feature-flag, db/datastore → database, prod → production, send/dispatch → deliver, and others.
- **Negation is clause-scoped.** "Deploy to production on Friday; no need to wait for Monday" is read as *deploying on Friday*. The "no" belongs to the other clause. Only the clauses that talk about the decision's topic count for stance.
- **Generic scope words don't make two scopes the same.** "Adopt Kubernetes for all new services" is not a rival choice to "Use PostgreSQL for the ledger service".

Each flag comes with a plain-English reason and a confidence score. When normalisation lined the texts up, the reason says so (for example *Read "turn off" as "disable", "2fa" as "mfa"*). Users can dismiss a flag on an issue. Superseded decisions never raise flags.

## Before / after: one team's year of decisions

The fictional payments team "Harbor Pay" has 18 decisions from two Confluence pages and six Jira comments, made between January and September 2026. In October and November it files 12 Jira issues. A human reviewer marks 7 of those issues as contradicting an earlier decision and 5 as fine. The dataset is in [`demo/impact-dataset.js`](demo/impact-dataset.js), and `node scripts/impact-report.mjs` reproduces the run. The raw outputs are in [`docs/impact/`](docs/impact/).

| Issue | What it says | Decision it contradicts | v1 (TF-IDF + 5 rules) | v2 |
|---|---|---|---|---|
| HP-104 | Raise the payment gateway timeout to 60s | Payment gateway timeout is 30 seconds (Mar 2) | missed | **caught**: *Decision sets 30 seconds; this text says 60s. Same subject: payment gateway timeout.* |
| HP-109 | Turn off 2FA for admin accounts during the SSO migration | Enable two-factor authentication for all admin accounts (Jan 26, SOC 2) | missed | **caught**: *opposing terms enable vs disable; read "turn off" as "disable", "2fa" as "mfa"* |
| HP-112 | Refund hotfix: deploy to production on Friday; no need to wait for the Monday window | No production deploys on Fridays (Jan 19) | missed | **caught**: the "no" belongs to the other clause |
| HP-115 | Lower the coverage gate to 70% for the legacy ledger module | Coverage must stay at or above 80% on the ledger service (HP-57) | missed | **caught**: *requires at least 80%; this text proposes 70%* |
| HP-124 | Send webhooks synchronously from the payment request handler | Webhooks are delivered asynchronously via the outbox queue (Mar 16) | missed | **caught** (send = deliver, sync vs async) |
| HP-117 | Switch to MongoDB for the ledger service | Use PostgreSQL for the ledger service | caught | caught |
| HP-121 | Add a REST endpoint for partners | GraphQL over REST for the partner API | caught | caught |
| HP-126 | Use Postgres for the ledger service read replica | (consistent) | **false flag**: *"chose postgresql; this proposes postgres instead"* | quiet |

**Result: v1 caught 2 of 7 contradictions and raised 1 false flag. v2 catches 7 of 7 with no false flags.** The other four consistent issues (index on the Postgres table, latency within the limit, a Terraform module, a SendGrid template) stay quiet in both versions.

What this means for the team: HP-109 would have disabled a SOC 2 control during a migration. HP-104 would have doubled the window in which card networks retry, which is the double-charge risk the March decision was made to prevent. Both are flagged in the Jira panel, and with a warning comment, at the moment the issue is filed, before sprint planning.

**Caveat:** we wrote this dataset while building the v2 rules, and two of its cases (HP-124, HP-126) led to rule fixes. As an honest check, we then wrote 8 fresh paraphrased contradictions and 4 consistent texts that the rules had never seen (`test/reworded.test.js`, "held-out"). On the first run, v1 caught 5 of 8 and v2 caught 7 of 8. The one miss ("retry up to 10 *times*" vs "max 3 retries") was fixed afterwards. One false flag remains in both versions: "Audit which spaces still have public links" against "Disable public sharing links". Rules still miss paraphrases that share no vocabulary at all.

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
src/lib/numeric.js           number/threshold extraction and conflicts
src/lib/text.js              tokenizer, stemmer, lexicons, phrase rewrites, entity aliases
src/frontend/*.jsx           UI Kit: ledger page, page byline, Jira issue panel
resource/agent/prompt.txt    Rovo agent prompt
skills/decision-conflict-review/SKILL.md   rovo:skill
mcp/SKILL.md                 open-source skill for third-party MCP clients
demo/demo-data.js            exact demo content (also used by tests)
demo/impact-dataset.js       Harbor Pay before/after dataset (18 decisions, 12 issues)
scripts/impact-report.mjs    runs the dataset through an engine version and prints what it flags
docs/impact/                 recorded v1 and v2 outputs of that run
test/*.test.js               76 tests (node:test)
scripts/offline-lint.cjs     runs the Forge CLI's manifest validator + linters without login
```

## Develop and test

Requires Node 22.12 or later. `forge` CLI 15 needs Node ≥ 22.23.4 or ≥ 24.22.1, so the project pins `@forge/cli@14.2.0` locally.

```bash
npm install
npm test               # 76 tests: extraction, matching, reworded/numeric conflicts, impact dataset, demo scenario,
                       # service layer and all 7 Rovo/MCP action handlers with mocked Forge APIs
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

Rovo has to be enabled on the site for the agent to appear.

### Rovo and MCP: what has been verified

- **Verified:** the `rovo:agent`, `rovo:skill`, `rovo:mcp` and 7 `action` modules pass Forge manifest validation and deploy. All 7 action handlers (the functions the agent and the MCP tools call) are exercised in `test/actions.test.js` with the payload shapes Rovo and MCP send, using mocked Forge APIs. The UI paths they share are verified on a live site.
- **Not yet verified live:** our free developer site has no Rovo, so we have **not** run the agent in Rovo chat or called the tools from an MCP client. The demo video shows the same engine through the Confluence and Jira UI. To enable external MCP clients, a site admin turns the tools on under **Atlassian Administration → Apps → Sites → Connected apps → Decision Ledger**. The endpoint is `https://mcp.atlassian.com/forge/<appId>`.

To give judges access, run `npx forge deploy -e production`. Then in the developer console, open **Distribution**, choose **Sharing**, and select both **Confluence** and **Jira** to get the installation link.

## Cost and free-tier notes

- **No Forge LLM usage.** There are no `@forge/llm` imports and no `llm` module (the linter checks this). Rovo agent conversations use the customer's Rovo credits. Forge only bills the developer for compute, storage and logs above the free monthly allowance.
- **Functions** use 256 MB on arm64. A page scan or issue check takes well under 1 s, which is about 0.25 GB-s. The free allowance is 200,000 GB-s per month, enough for roughly 800k invocations.
- **KVS.** Each decision is about 0.5 KB. Listing a 200-decision ledger reads about 100 KB, so the free 0.1 GB of reads per month covers about 1,000 full-ledger loads. Writes happen only when decisions change.
- **Logs.** The app logs only `console.warn` on failures.
- **Teamwork Graph and product REST APIs** have no Forge charge.

## Limits and roadmap

- Matching is rule-based. The normalisation lexicon covers common decision verbs and tech terms, but paraphrases that share no vocabulary and no known synonym are still missed. An optional Rovo-assisted second opinion for borderline matches is the next step.
- Numbers are compared only when they use the same unit. A bare number with no unit, such as "Node 20" vs "Node 22", is not treated as a threshold.
- KVS reads the whole ledger, which is fine for up to about 1,000 decisions. Larger ledgers should move to the Forge SQL free tier with per-label indexes.
- The Teamwork Graph API is in Preview. If the admin declines the graph scopes, the app falls back to the recorded decision owner.
