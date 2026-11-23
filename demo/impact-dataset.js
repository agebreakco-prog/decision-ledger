// Before/after impact dataset: a fictional payments team ("Harbor Pay", Jira project HP) with
// 18 decisions captured from two Confluence pages and six Jira comments over 2026, and the
// 12 Jira issues they filed in Oct-Nov 2026. Used by scripts/impact-report.mjs and test/impact.test.js.
// `expect` is what a human reviewer says: the decision it contradicts, or null when it is fine.

const page = (id, title) => ({ type: 'confluence-page', id, title });
const comment = (issueKey) => ({ type: 'jira-comment', id: issueKey, title: issueKey });

let n = 0;
const d = (text, decidedAt, source, labels = [], rationale = '') => ({
  id: `hp-${++n}`, text, rationale, labels, status: 'active', decidedAt: `${decidedAt}T10:00:00.000Z`, source,
});

const ADR = page('101', 'Payments platform: architecture decisions');
const OPS = page('102', 'Ops handbook: decisions');

export const DECISIONS = [
  d('Use PostgreSQL for the ledger service', '2026-01-12', ADR, ['ledger', 'database'], 'We need ACID transactions for balances'),
  d('No production deploys on Fridays', '2026-01-19', ADR, ['release']),
  d('Enable two-factor authentication for all admin accounts', '2026-01-26', ADR, ['security'], 'SOC 2 control CC6.1'),
  d('Every pull request needs 2 approvals before merge', '2026-02-09', ADR, ['engineering']),
  d('Payment gateway timeout is 30 seconds', '2026-03-02', ADR, ['gateway'], 'Card networks retry after 30 s; longer waits double-charge'),
  d('Webhooks are delivered asynchronously via the outbox queue', '2026-03-16', ADR, ['webhooks']),
  d('GraphQL over REST for the partner API', '2026-04-13', ADR, ['api']),
  d('Retain application logs for 90 days', '2026-05-04', OPS, ['observability'], 'PCI DSS 10.7 audit trail'),
  d('Keep p95 checkout latency under 300ms', '2026-05-18', OPS, ['checkout']),
  d('Adopt Kubernetes for all new services', '2026-06-01', OPS, ['platform']),
  d('Feature flags are mandatory for all checkout changes', '2026-06-15', OPS, ['checkout']),
  d('Keep the support team on a weekly on-call rotation', '2026-06-29', OPS, ['support']),
  d('Refunds over $500 require finance approval', '2026-07-08', comment('HP-41'), ['refunds']),
  d('Code coverage must stay at or above 80% on the ledger service', '2026-07-22', comment('HP-57'), ['ledger', 'quality']),
  d('Do not store raw card numbers in our database; use vault tokens', '2026-08-05', comment('HP-63'), ['security', 'pci']),
  d('Use Terraform for all cloud infrastructure', '2026-08-19', comment('HP-70'), ['platform']),
  d('Customer emails are sent from SendGrid', '2026-09-02', comment('HP-88'), ['email']),
  d('Stay on Node 20 LTS for the API until Q2', '2026-09-16', comment('HP-92'), ['api']),
];

export const INCOMING = [
  // Reworded contradictions: different words, same clash.
  { key: 'HP-104', text: 'Bump gateway timeout. Raise the payment gateway timeout to 60s; Adyen sandbox calls keep failing at the limit.', expect: /gateway timeout/ },
  { key: 'HP-109', text: 'Turn off 2FA for admin accounts during the Okta SSO migration', expect: /two-factor/ },
  { key: 'HP-112', text: 'Refund hotfix: deploy to production on Friday; no need to wait for the Monday window', expect: /Fridays/ },
  { key: 'HP-115', text: 'Lower the coverage gate to 70% for the legacy ledger module so the build goes green', expect: /coverage/ },
  // Plain contradictions both versions catch.
  { key: 'HP-117', text: 'Switch to MongoDB for the ledger service so balances can be stored as documents', expect: /PostgreSQL/ },
  { key: 'HP-121', text: 'Add a REST endpoint for partners to list payouts', expect: /GraphQL/ },
  { key: 'HP-124', text: 'Send webhooks synchronously from the payment request handler', expect: /Webhooks/ },
  // Consistent or unrelated work: must stay quiet.
  { key: 'HP-126', text: 'Use Postgres for the ledger service read replica', expect: null },
  { key: 'HP-127', text: 'Add an index on the Postgres balances table', expect: null },
  { key: 'HP-129', text: 'Checkout p95 latency is now 240ms after the cache change, document it', expect: null },
  { key: 'HP-131', text: 'Write the Terraform module for the new reporting bucket', expect: null },
  { key: 'HP-133', text: 'Update the SendGrid receipt template with the new logo', expect: null },
];
