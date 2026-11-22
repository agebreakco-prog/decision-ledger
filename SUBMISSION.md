# Devpost submission draft: Decision Ledger

**Hackathon:** Codegeist 2026 ("Build with context. Ship with confidence.")
**Deadline:** Dec 22, 2026, 12:00 PM PST
**Category:** Apps for Software Teams (it also works for business teams: refund policies, on-call rotations, pricing)
**Bonus prizes:** Best Agents (Rovo / assignable agents) · Best app with Atlassian MCP · Best apps with Teamwork Graph integration
*(Only one bonus prize can be won. All three are listed; the Rovo agent + skill is the strongest fit.)*

---

## Tagline
Your team's memory of what it decided, and a warning before new work quietly contradicts it.

## Inspiration
Every team has had this conversation: "Wait, didn't we decide *not* to do that?" The decision was made in a meeting, written into a Confluence page, and agreed in a Jira comment. Six weeks later a new ticket reopens it, nobody connects the two, and the team pays twice.

Codegeist asks for apps that use "what's already been decided". We built the piece that makes that concrete: a ledger of decisions that stays up to date by itself and shows up exactly where new work starts.

## What it does
- **Captures decisions automatically** from Confluence pages: native `/decision` items, "Decisions" sections, decision-log tables, and `Decision:` / `Agreed:` lines. Jira comments are captured too. Each entry records **what** was decided, **why**, **who** decided and **when**, with a link back to the source.
- **Jira "Related decisions" panel.** Every issue shows the decisions that apply to it, matched on topic, labels and components. Any decision the issue or its latest comment appears to **contradict** is listed first, with the reason and a confidence score (for example: *"Decision chose postgresql for billing service; this proposes mongodb instead"*).
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
- **A deterministic engine with no LLM:** an Atlassian Document Format (ADF) walker for extraction, TF-IDF cosine for relevance, and five explainable contradiction rules: different choice for the same scope, a rejected alternative coming back, dropping what the decision chose, opposite stance, and antonyms on the same topic. Rovo provides the conversation layer, and the app returns hard evidence it can cite.
- **Tests:** 46 `node:test` tests cover extraction (ADF, storage XHTML, plain text), matching, the exact demo scenario, and the service layer with mocked Forge APIs.

## Challenges we ran into
- **Making contradiction detection trustworthy without an LLM.** Pure similarity flags everything on the same topic. We separated *topic* words from *stance* words ("use", "stop", "no", "never") and parsed choices ("use X for Y", "X over Y") so each flag comes with a reason a human can check in two seconds.
- **Staying in Forge's free tier.** There are no Forge LLM calls, decisions are small KVS records, and functions run at 256 MB on arm64. AI conversation runs in Rovo, which customers already pay for.
- **One app across two products.** Multi-app compatibility lets one installation serve Confluence and Jira and share one ledger.

## Accomplishments that we're proud of
- Every flag explains itself, and nothing is a black box.
- The same capabilities show up as a UI, a Rovo agent, a Rovo skill and MCP tools, all backed by one service layer.
- It works with how teams already write: no new template or macro is required. The native `/decision` element just works.

## What we learned
Context is valuable only when it shows up at the moment of action. That means inside the Jira issue, inside the Rovo conversation, and inside the external agent's plan, not on a page nobody opens.

## What's next for Decision Ledger
- Synonym and paraphrase handling, with an optional Rovo-assisted second opinion for borderline matches.
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
5. In Rovo chat, pick the **Decision Ledger** agent and ask: *"What did we decide about the billing database?"* and *"Does this contradict anything: generate invoices synchronously during checkout?"*.
6. MCP (optional): an admin enables the tools under Atlassian Administration → Apps → Sites → Connected apps. Then add `https://mcp.atlassian.com/forge/<appId>` to an MCP client.

## Bonus prize materials
- **Best Agents:** the `rovo:agent` "Decision Ledger" with 7 actions and the reusable `rovo:skill` `decision-conflict-review` (see `manifest.yml`, `resource/agent/prompt.txt`, `skills/`).
- **Best app with Atlassian MCP:** the `rovo:mcp` module "Decision Ledger MCP" exposes `find-decisions`, `check-conflicts`, `record-decision`, `issue-decisions` and `decision-stakeholders`. The open-source `mcp/SKILL.md` is for third-party agents.
- **Teamwork Graph:** `src/twg.js` reads page owners and contributors and their teams through curated queries (`confluencePageOwners`, `confluencePageContributors`, `atlassianUserInTeams`) and shows them in **Who to involve** and in the agent's `decision-stakeholders` action.

## Links
- Video: **<YouTube URL, public>**
- Code: **<public repo URL>** (MIT)
- Installation link: **<link>**
Video: https://youtu.be/w9mOL597N-s
