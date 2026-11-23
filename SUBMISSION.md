# Devpost submission draft: Decision Ledger

**Hackathon:** Codegeist 2026 ("Build with context. Ship with confidence.")
**Deadline:** Dec 22, 2026, 12:00 PM PST
**Category:** Apps for Software Teams (it also works for business teams: refund policies, on-call rotations, pricing)
**Bonus prizes:** Best Agents (Rovo / assignable agents) · Best app with Atlassian MCP · Best apps with Teamwork Graph integration
*(Only one bonus prize can be won. Eligibility is by module: `rovo:agent`/`rovo:skill`/`action`, `rovo:mcp`, and Teamwork Graph API use are all in the manifest. **Honest status:** the agent and MCP tools are tested in code, not live in Rovo; see "Bonus prize materials". **Teamwork Graph is the one bonus shown working on a live site**, so it is the safest bonus to emphasise unless a Rovo clip is recorded.)*

---

## Tagline
Your team's memory of what it decided, and a warning before new work quietly contradicts it.

## Inspiration
Every team has had this conversation: "Wait, didn't we decide *not* to do that?" The decision was made in a meeting, written into a Confluence page, and agreed in a Jira comment. Six weeks later a new ticket reopens it, nobody connects the two, and the team pays twice.

Codegeist asks for apps that use "what's already been decided". We built the piece that makes that concrete: a ledger of decisions that stays up to date by itself and shows up exactly where new work starts.

## The problem, in one team's numbers
"Harbor Pay" is a fictional 8-person payments team, and its dataset ships with the app (`demo/impact-dataset.js`). It made 18 decisions in 2026, in two Confluence pages and six Jira comments. In October and November it filed 12 Jira issues, and 7 of them quietly contradicted an earlier decision. Here are two of them:

- **HP-109** *"Turn off 2FA for admin accounts during the Okta SSO migration"* would have switched off a SOC 2 control the team had decided on in January.
- **HP-104** *"Raise the payment gateway timeout to 60s"* reverses the March decision to keep it at 30 seconds, which the team made because card networks retry after 30 s and a longer wait double-charges.

Neither issue shares wording with the decision it breaks. Our first, purely keyword-based version caught **2 of the 7** and wrongly flagged "Use Postgres for the read replica" as contradicting "Use PostgreSQL". The current engine catches **7 of 7 with no false flags**. Each flag comes with a reason, for example *"Decision sets 30 seconds; this text says 60s. Same subject: payment gateway timeout."*, and it appears on the Jira issue the moment the issue is filed, before sprint planning.

## What it does
- **Captures decisions automatically** from Confluence pages: native `/decision` items, "Decisions" sections, decision-log tables, and `Decision:` / `Agreed:` lines. Jira comments are captured too. Each entry records **what** was decided, **why**, **who** decided and **when**, with a link back to the source.
- **Jira "Related decisions" panel.** Every issue shows the decisions that apply to it, matched on topic, labels and components. Any decision the issue or its latest comment appears to **contradict** is listed first, with the reason and a confidence score (for example: *"Decision chose postgresql for billing service; this proposes mongodb instead"*). It catches reworded contradictions too: "turn off 2FA" vs "enable two-factor authentication", "move away from k8s" vs "adopt Kubernetes", and "timeout 60s" vs "timeout is 30 seconds".
- **Proactive warnings.** When a new issue or comment contradicts an active decision, the app posts one short warning comment that links to the decision. The flag is shown once and can be dismissed.
- **Confluence "Decision Ledger" page.** Search and filter the whole ledger, paste an RFC into **Check a proposal**, backfill a space, **Supersede** a decision so the history stays linked, and see **Who to involve** before changing one. People and teams come from the **Teamwork Graph**.
- **Rovo agent "Decision Ledger".** Ask *"What did we decide about the billing database?"*, *"Does PAY-12 contradict anything?"*, *"Record that we're moving support to a follow-the-sun rotation"*, or *"Who should weigh in before we change the Friday deploy rule?"*.
- **Reusable Rovo skill + MCP server.** The `decision-conflict-review` skill and five MCP tools let *any* agent run a decision check before it writes a plan. That includes Rovo Studio agents and external MCP clients through the Atlassian MCP server.

## How we built it
- **Forge** app with multi-app compatibility (Confluence required, Jira optional). The two products share one installation and one storage.
- **UI Kit** (`@forge/react`) for the Confluence global page, the page byline item and the Jira issue panel.
- **Triggers** on `avi:confluence:created/updated:page`, `avi:jira:created:issue` and `avi:jira:commented:issue`.
- **Forge KVS** (`@forge/kvs`) as the ledger store.
- **Rovo:** `rovo:agent` (prompt stored as a resource), 7 `action`s, a `rovo:skill` with tool dependencies, and a `rovo:mcp` module that exposes 5 of the actions as MCP tools. We also wrote an open-source `SKILL.md` for third-party agents.
- **Teamwork Graph API** curated queries (`confluencePageOwners`, `confluencePageContributors`, `atlassianUserInTeams`) answer "who should weigh in". If a scope isn't granted, the app falls back to the recorded owner.
- **A deterministic engine with no LLM:** an Atlassian Document Format (ADF) walker for extraction and TF-IDF cosine for relevance. On top of that, a normalisation layer handles phrasal decision verbs ("turn off" → disable, "move away from" → drop), entity aliases (Postgres = PostgreSQL, k8s = Kubernetes, PR = pull request) and clause-scoped negation. Then six explainable contradiction rules run: a different choice for the same scope, a rejected alternative coming back, dropping what the decision chose, opposite stance, antonyms on the same topic, and a **different number or threshold for the same setting** (units and *under / at least* bounds are understood). Rovo provides the conversation layer, and the app returns hard evidence it can cite.
- **Tests:** 76 `node:test` tests cover extraction (ADF, storage XHTML, plain text), matching, reworded and numeric contradictions (including a held-out set written after the rules), the Harbor Pay before/after dataset, the exact demo scenario, the service layer, and all 7 Rovo/MCP action handlers with mocked Forge APIs.

## Challenges we ran into
- **Making contradiction detection trustworthy without an LLM.** Pure similarity flags everything on the same topic. We separated *topic* words from *stance* words ("use", "stop", "no", "never") and parsed choices ("use X for Y", "X over Y") so each flag comes with a reason a human can check in two seconds.
- **Reworded contradictions.** Our first version missed 5 of the 7 contradictions in the Harbor Pay dataset because they used different words. The fixes stay explainable: a small lexicon of decision verbs and tech aliases, negation that stops at the clause boundary, and unit-aware number comparison. Every rewrite is named in the flag's reason. We also kept a held-out set to avoid tuning to our own examples. On it, v2 caught 7 of 8 on the first run against 5 of 8 for v1.
- **Staying in Forge's free tier.** There are no Forge LLM calls, decisions are small KVS records, and functions run at 256 MB on arm64. AI conversation runs in Rovo, which customers already pay for.
- **One app across two products.** Multi-app compatibility lets one installation serve Confluence and Jira and share one ledger.

## Accomplishments that we're proud of
- Every flag explains itself, and nothing is a black box.
- The same capabilities show up as a UI, a Rovo agent, a Rovo skill and MCP tools, all backed by one service layer.
- It works with how teams already write: no new template or macro is required. The native `/decision` element just works.

## What we learned
Context is valuable only when it shows up at the moment of action. That means inside the Jira issue, inside the Rovo conversation, and inside the external agent's plan, not on a page nobody opens.

## What's next for Decision Ledger
- An optional Rovo-assisted second opinion for borderline matches that share no vocabulary at all.
- Decision review dates ("revisit in Q2") with reminders.
- Sending decisions *into* the Teamwork Graph through a connector, so other agents see them as first-class objects.
- Moving to Forge SQL for very large ledgers, and a Marketplace listing.

## Built with
forge, ui-kit, rovo, rovo-agent, rovo-skill, rovo-mcp, mcp, teamwork-graph, confluence, jira, forge-kvs, javascript, react, node.js

---

## Testing instructions for judges
1. Open the installation link: **<INSTALL LINK — Developer console → Distribution → Sharing, Confluence + Jira>**. Install on Confluence first, then Jira, on the same site. Rovo must be enabled on the site to use the agent.
2. In Confluence, create a page and paste the text from `demo/demo-data.js` (`DEMO_PAGE_TEXT`), or use the `/decision` element. Publish. Within about a minute (event delivery can take up to 3 minutes), the **Decisions** byline item lists 7 decisions. **Scan this page now** captures them immediately.
3. Open **Apps → Decision Ledger** in Confluence to browse, filter, and try **Check a proposal** with: *"Switch to MongoDB for the billing service"*.
4. In Jira, create an issue titled *"Migrate billing service to MongoDB"*. A warning comment appears within a few minutes. Open the **Related decisions** panel from the issue's apps button to see the conflict and the reason.
5. *(Needs Rovo on the site. We could not run this step on our own free dev site, so it is untested live.)* In Rovo chat, pick the **Decision Ledger** agent and ask: *"What did we decide about the billing database?"* and *"Does this contradict anything: generate invoices synchronously during checkout?"*.
6. Reworded contradictions: create Jira issues titled *"Turn off 2FA for admin accounts"* (after recording the decision *"Enable two-factor authentication for all admin accounts"*) or *"Raise the payment gateway timeout to 60s"* (after *"Payment gateway timeout is 30 seconds"*). The panel explains how the texts were matched.
7. MCP (optional, untested live): an admin enables the tools under Atlassian Administration → Apps → Sites → Connected apps. Then add `https://mcp.atlassian.com/forge/<appId>` to an MCP client.

## Bonus prize materials
- **Best Agents:** the `rovo:agent` "Decision Ledger" with 7 actions and the reusable `rovo:skill` `decision-conflict-review` (see `manifest.yml`, `resource/agent/prompt.txt`, `skills/`).
- **Best app with Atlassian MCP:** the `rovo:mcp` module "Decision Ledger MCP" exposes `find-decisions`, `check-conflicts`, `record-decision`, `issue-decisions` and `decision-stakeholders`. The open-source `mcp/SKILL.md` is for third-party agents.
- **Teamwork Graph:** `src/twg.js` reads page owners and contributors and their teams through curated queries (`confluencePageOwners`, `confluencePageContributors`, `atlassianUserInTeams`) and shows them in **Who to involve** and in the agent's `decision-stakeholders` action. This is shown working on a live site (screenshot `docs/screenshots/who-to-involve.jpg`).
- **What we could and could not verify.** Our free Atlassian developer site does not have Rovo, so the video does **not** show the agent in Rovo chat or the tools in an MCP client. What we did verify: the Rovo and MCP modules pass Forge validation and deploy, and `test/actions.test.js` calls all 7 action handlers with the payloads Rovo and MCP send, with Forge APIs mocked. The same service layer runs live behind the Confluence and Jira UI shown in the video. Judges with Rovo can try step 5 of the testing instructions.

## Links
- Video: https://youtu.be/w9mOL597N-s
- Code: https://github.com/agebreakco-prog/decision-ledger (MIT)
- Installation link: **<link>**
Video: https://youtu.be/w9mOL597N-s
