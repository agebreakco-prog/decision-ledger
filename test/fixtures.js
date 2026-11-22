// Shared fixtures: a realistic architecture-decision page in ADF plus a small ledger.

export const confluencePageAdf = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Billing platform sync — 2026-11-04' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Attendees: Priya, Marco, Lena' }] },
    {
      type: 'decisionList',
      attrs: { localId: 'dl1' },
      content: [
        {
          type: 'decisionItem',
          attrs: { localId: 'd1', state: 'DECIDED' },
          content: [
            { type: 'text', text: 'Use PostgreSQL for the billing service because we need strong transactional guarantees ' },
            { type: 'mention', attrs: { id: 'acc-priya', text: '@Priya Shah' } },
          ],
        },
        {
          type: 'decisionItem',
          attrs: { localId: 'd2', state: 'UNDECIDED' },
          content: [{ type: 'text', text: 'Maybe move invoices to S3' }],
        },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decisions' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'No deploys to production on Fridays' }] }],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Invoices are generated asynchronously via the job queue' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Rationale: keeps checkout latency under 200ms' }] },
          ],
        },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Action items' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Marco to draft the schema' }] }] },
      ],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Agreed: GraphQL over REST for the public API since partners asked for it' }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Decision' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Owner' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feature flags are mandatory for all checkout changes' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two incidents in Q3' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'acc-lena', text: '@Lena' } }] }] },
          ],
        },
      ],
    },
  ],
};

let n = 0;
export function dec(text, extra = {}) {
  n++;
  return {
    id: `t-${n}`,
    text,
    rationale: '',
    status: 'active',
    labels: [],
    decidedAt: `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`,
    source: { type: 'confluence-page', id: `p${n}`, title: 'ADR' },
    ...extra,
  };
}

export const ledger = [
  dec('Use PostgreSQL for the billing service', { labels: ['billing', 'database'] }),
  dec('No deploys to production on Fridays', { labels: ['release'] }),
  dec('Invoices are generated asynchronously via the job queue', { labels: ['billing'] }),
  dec('GraphQL over REST for the public API', { labels: ['api'] }),
  dec('Feature flags are mandatory for all checkout changes', { labels: ['checkout'] }),
  dec('Adopt Figma as the single design tool for marketing assets', { labels: ['design'] }),
  dec('Keep the support team on a weekly on-call rotation', { labels: ['support'] }),
  dec('Use Snowflake for the analytics warehouse', { labels: ['data'], status: 'superseded' }),
];
