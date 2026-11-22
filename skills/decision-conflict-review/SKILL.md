---
name: decision-conflict-review
description: Review a proposal, plan or Jira issue against the team's recorded decisions before work starts. Use when someone asks whether a change is consistent with past decisions, wants a pre-flight check of an RFC or ticket, or wants to change an existing decision safely.
allowed-tools: check-conflicts find-decisions decision-stakeholders supersede-decision
---

# Decision conflict review

Use this playbook when the user wants to know whether some work contradicts what the team already decided, or wants to change a decision.

## 1. Check
- If the user gave text (an RFC paragraph, a plan, a ticket description), call `check-conflicts` with `text`.
- If the user referenced a Jira issue, call `check-conflicts` with `issueKey`. Inside a Jira issue you can omit both.

## 2. Explain
For each conflict returned:
- Quote the decision text exactly and link the source.
- Give the reason string returned by the tool (for example "Decision chose postgresql for billing service; this proposes mongodb instead").
- Show the confidence as a percentage. Below 60% call it "worth a look", at 60% or above call it "likely contradiction".
If there are no conflicts, say so and list up to three related decisions from the response so the user still sees the context.

## 3. Context
If the user needs more background on a topic, call `find-decisions` with two to four topic keywords, including superseded decisions when history matters.

## 4. Resolve
Offer three outcomes and let the user choose:
1. **Adjust the work** to respect the decision (no tool call).
2. **Change the decision**: first call `decision-stakeholders` with the decision id and list the people and teams to consult. Only after the user confirms the new wording, call `supersede-decision` with the old id, the new decision text and the rationale.
3. **Not a conflict**: acknowledge; the user can dismiss the flag in the Jira "Related decisions" panel.

Never call `supersede-decision` without explicit confirmation. Conflict detection is deterministic and rule-based; present results as possible contradictions, not facts.
