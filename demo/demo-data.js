// Demo content used by DEMO_SCRIPT.md and test/scenario.test.js.
// Paste DEMO_PAGE_TEXT into a Confluence page (the markdown headings/bullets convert automatically),
// or use the /decision element for the first line to show native decision capture.

export const DEMO_PAGE_TEXT = `Decision: Use PostgreSQL for the billing service because we need ACID transactions for invoices
## Decisions
- No production deploys on Fridays
- Invoices are generated asynchronously via the job queue
- Feature flags are mandatory for all checkout changes
Agreed: GraphQL over REST for the public partner API since partners asked for typed schemas
Decision: Refunds over $500 require finance approval
Decision: Keep the support team on a weekly on-call rotation`;

export const DEMO_CHECKS = [
  { text: 'Migrate billing service to MongoDB. Switch to MongoDB for the billing service so we can iterate on the invoice schema faster.', conflictWith: /PostgreSQL/ },
  { text: 'Deploy the checkout hotfix to production on Friday evening to hit the deadline.', conflictWith: /Fridays/ },
  { text: 'Generate invoices synchronously during checkout so customers get the PDF immediately', conflictWith: /asynchronously/ },
  { text: 'Add a REST endpoint for partners to fetch invoices', conflictWith: /GraphQL/ },
  { text: 'Make feature flags optional for small checkout copy changes', conflictWith: /Feature flags/ },
  { text: 'Auto-approve refunds up to $1000 without finance review', conflictWith: /Refunds/ },
  { text: 'Move support to a monthly on-call rotation', conflictWith: /on-call/ },
  { text: 'Add an index on the PostgreSQL invoices table' },
  { text: 'Update the README for the billing service' },
  { text: 'Plan the team offsite agenda for January' },
  { text: 'Use feature flags for the new checkout button' },
];
