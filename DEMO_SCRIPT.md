# Demo video script: Decision Ledger (target 2:45, hard limit under 3:00)

Record at 1920×1080 with browser zoom at 110%. Use a dark-free default theme and hide bookmarks. All typed text below is exact. Paste it from this file rather than typing live.

## Before recording (not on camera)
1. Install the app on the demo site, in Confluence and in Jira (see README → Deploy). Confirm Rovo is on.
2. Create a Jira project **PAY** ("Payments"). Create issue **PAY-14** "Checkout coupon rounding hotfix" with label `checkout`.
3. Create a Confluence space **PAY**. Prepare a draft page titled **"Payments architecture sync — Nov 2026"**, unpublished, with this body:
   - Line 1: insert a native decision with `/decision` and type **Use PostgreSQL for the billing service because we need ACID transactions for invoices**, then @mention yourself.
   - Then paste the rest of `DEMO_PAGE_TEXT` from `demo/demo-data.js`: the `## Decisions` bullets, the `Agreed:` line, and the two `Decision:` lines.
4. Open the Confluence **Apps → Decision Ledger** page once, so the ledger is empty and **Settings → Post a heads-up comment** is ON.
5. Open tabs in this order: (1) the Confluence draft, (2) Confluence Apps → Decision Ledger, (3) Jira board PAY, (4) Jira issue PAY-14.

---

## 0:00–0:15 · Hook (title card over the Confluence draft)
**Voice-over:** "Six weeks after a decision, someone opens a ticket that quietly reverses it. Nobody connects the two, and the team pays for it twice. Decision Ledger is your team's memory of what it decided, and it warns you before new work contradicts it."

## 0:15–0:40 · Capture: decisions are captured from the way you already write
- **Screen:** tab 1. Scroll slowly through the draft: the native decision item, the "Decisions" bullets, the "Agreed:" line. Click **Publish**.
- Click the **Decisions** byline item under the title, then **Scan this page now**. The automatic trigger can take a few minutes, so the button keeps the demo live.
- The panel shows **7 decisions**. Each has its rationale ("Why: we need ACID transactions for invoices"), the owner avatar and the date.
- **Voice-over:** "No new template. Native decision items, a Decisions heading, decision tables, or just 'Decision:' in a sentence. What, why, who and when, captured on publish."

## 0:40–1:05 · The ledger
- **Screen:** tab 2 (Apps → Decision Ledger). Point at the stat tiles (Active 7, From Confluence 7).
- Type `billing` in **Search decisions**. The PostgreSQL decision is on top, with "Relevance … · matched: billing".
- Click the **Check a proposal** tab and paste: `Generate invoices synchronously during checkout so customers get the PDF immediately` → **Check against ledger**.
- A warning card appears: "Invoices are generated asynchronously via the job queue" with the reason *Opposing terms on the same topic: "sync…" vs "async…"* and a confidence lozenge.
- **Voice-over:** "Every flag says *why*. It's explainable, rule-based matching with no LLM cost, so it stays inside Forge's free tier."

## 1:05–1:40 · Jira: the conflict comes to the work
- **Screen:** tab 3. Click **Create**. Summary: `Migrate billing service to MongoDB`. Description: `Switch to MongoDB for the billing service so we can iterate on the invoice schema faster.` Label: `billing`. Create, then open the new issue (PAY-15).
- Open the **Related decisions** panel from the issue's app button. A yellow banner reads "This work may contradict a team decision". The card shows **Use PostgreSQL for the billing service** · *Likely conflict · 90%* · "Decision chose 'postgresql' for billing service; this proposes 'mongodb' instead."
- Scroll the activity: the **Decision Ledger warning comment** linking to the Confluence page. Cut here if the trigger takes longer and show it in a second take.
- **Voice-over:** "The moment someone files work that reverses a decision, the ledger flags it in the issue, with a link to where and why it was decided."

## 1:40–2:00 · Comments count too
- **Screen:** tab 4 (PAY-14). Add the comment `Deploy the checkout hotfix to production on Friday evening to hit the deadline.` and save.
- Open **Related decisions** → **Re-check**. The flag reads "No production deploys on Fridays … this text proposes doing it".
- Add a second comment: `Decision: round coupon discounts half-up` and on a new line `Why: matches finance reports`. Click **Re-check**. The decision appears under **Decided in this issue**.
- **Voice-over:** "Decisions made in Jira land in the same ledger."

## 2:00–2:35 · Rovo agent, skill and MCP
- **Screen:** stay in PAY-15. Open **Rovo chat** → select the **Decision Ledger** agent.
- Type: `What did we decide about the billing database?` The agent answers with the PostgreSQL decision, its rationale and the source link.
- Type: `Who should weigh in before we change it?` The agent calls *decision-stakeholders* and lists the page owner and contributors and their team, from the **Teamwork Graph**.
- Type: `Supersede it with: Use PostgreSQL for billing, with MongoDB allowed for the invoice archive only`. The agent asks for confirmation. Reply `yes`. It confirms the old decision is superseded.
- Quick cut (3 s): `manifest.yml` showing `rovo:mcp` "Decision Ledger MCP" with 5 tools, and the `rovo:skill` `decision-conflict-review`.
- **Voice-over:** "The same engine is a Rovo agent, a reusable Rovo skill, and MCP tools, so any agent, including external ones, can check decisions before it writes a plan."

## 2:35–2:50 · Close
- **Screen:** tab 2, refresh. The superseded decision shows the grey **Superseded** lozenge and the history is kept. The Activity tab lists scan, conflict, record and status events.
- **Voice-over:** "Decision Ledger: what your team decided, why, and who decided it, right where the next decision is being made. Built on Forge with Confluence, Jira, Rovo, MCP and the Teamwork Graph."
- End card: app name · "Codegeist 2026 · Apps for Software Teams".

---

### Fallbacks while recording
- **The trigger hasn't fired yet** (event delivery can take up to 3 minutes): use **Scan this page now** in the byline, or **Re-check** in the panel. Both run the same code path synchronously.
- **The Rovo agent doesn't appear:** confirm Rovo is enabled on the site and the app is installed in both Confluence and Jira. Run `forge deploy` again and wait about 5 minutes for the manifest to propagate.
- **Who to involve shows only the owner:** the site admin hasn't granted the Teamwork Graph scopes (`read:graph:*`). The app falls back to the decision owner by design. Grant the scopes and retake.
