import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectConflict, findConflicts, parseChoice, polarity, related, searchLedger } from '../src/lib/match.js';
import { ledger } from './fixtures.js';

test('related: issue text finds the right decision first', () => {
  const r = related('Set up database schema for billing service invoices', ledger, { labels: ['billing'] });
  assert.ok(r.length >= 2);
  assert.match(r[0].decision.text, /PostgreSQL|Invoices/);
  assert.ok(r[0].matchedTerms.length > 0);
  assert.ok(r.every((x) => x.score >= 0.12));
});

test('related: unrelated text returns nothing; superseded excluded by default', () => {
  assert.deepEqual(related('Plan the team offsite in Lisbon', ledger), []);
  const r = related('analytics warehouse', ledger);
  assert.ok(!r.some((x) => x.decision.text.includes('Snowflake')));
  const r2 = related('analytics warehouse', ledger, { includeSuperseded: true });
  assert.ok(r2.some((x) => x.decision.text.includes('Snowflake')));
});

test('polarity', () => {
  assert.equal(polarity('Use PostgreSQL for billing'), 1);
  assert.equal(polarity('Stop using PostgreSQL'), -1);
  assert.equal(polarity('We should not use PostgreSQL'), -1);
  assert.equal(polarity("Don't adopt Figma"), -1);
  assert.equal(polarity('No deploys to production on Fridays'), -1);
  assert.equal(polarity('Invoices are generated in the queue'), 0);
});

test('parseChoice', () => {
  assert.deepEqual(parseChoice('Use PostgreSQL for the billing service'), {
    choice: 'postgresql', scope: 'billing service', rejected: [],
  });
  const c = parseChoice('GraphQL over REST for the public API');
  assert.ok(c.rejected.includes('rest'), JSON.stringify(c));
  const m = parseChoice('Switch to MongoDB for billing service because schemas change a lot');
  assert.equal(m.choice, 'mongodb');
  assert.equal(m.scope, 'billing service');
});

test('conflict: different choice for same scope', () => {
  const r = detectConflict('Switch to MongoDB for the billing service', ledger[0]);
  assert.equal(r.conflict, true);
  assert.match(r.reasons.join(' '), /postgresql/i);
});

test('conflict: opposite stance (Friday deploys)', () => {
  const r = detectConflict('Schedule the production deploy for Friday evening, enable deploys on Fridays', ledger[1]);
  assert.equal(r.conflict, true, JSON.stringify(r));
});

test('conflict: antonym on same topic (sync vs async invoices)', () => {
  const r = detectConflict('Generate invoices synchronously during checkout', ledger[2]);
  assert.equal(r.conflict, true, JSON.stringify(r));
});

test('conflict: reviving a rejected alternative', () => {
  const r = detectConflict('Build a new REST endpoint for the public API', ledger[3]);
  assert.equal(r.conflict, true, JSON.stringify(r));
  assert.match(r.reasons.join(' '), /ruled out "rest"/);
});

test('conflict: mandatory vs optional', () => {
  const r = detectConflict('Make feature flags optional for small checkout changes', ledger[4]);
  assert.equal(r.conflict, true, JSON.stringify(r));
});

test('no conflict: consistent or unrelated text', () => {
  assert.equal(detectConflict('Add an index to the PostgreSQL billing tables', ledger[0]).conflict, false);
  assert.equal(detectConflict('Write the Q4 marketing newsletter', ledger[0]).conflict, false);
  assert.equal(detectConflict('Deploy to staging on Friday', ledger[5]).conflict, false);
  assert.equal(detectConflict('Use feature flags for the checkout redesign', ledger[4]).conflict, false);
});

test('findConflicts scans the ledger and ranks', () => {
  const r = findConflicts('Proposal: move the billing service to MongoDB and stop using PostgreSQL', ledger);
  assert.ok(r.length >= 1);
  assert.match(r[0].decision.text, /PostgreSQL/);
  assert.deepEqual(findConflicts('', ledger), []);
  assert.deepEqual(findConflicts('Plan the offsite agenda', ledger), []);
});

test('findConflicts ignores superseded decisions', () => {
  const r = findConflicts('Use BigQuery for the analytics warehouse', ledger);
  assert.ok(!r.some((x) => x.decision.text.includes('Snowflake')));
});

test('searchLedger filters and query', () => {
  assert.equal(searchLedger(ledger, { status: 'all' }).length, ledger.length);
  assert.equal(searchLedger(ledger).length, ledger.length - 1);
  assert.equal(searchLedger(ledger, { label: 'billing' }).length, 2);
  const q = searchLedger(ledger, { query: 'design tool', status: 'all' });
  assert.match(q[0].decision.text, /Figma/);
});

test('parseChoice keeps summary and description sentences apart', () => {
  const c = parseChoice('Migrate user store to MongoDB\nMove the user store from PostgreSQL to MongoDB so we can iterate.');
  assert.equal(c.choice, 'mongodb');
});

test('conflict: ruled-out option requested without a stance verb', () => {
  const d = { id: 'g', text: 'GraphQL over REST for the public partner API', status: 'active' };
  assert.equal(detectConflict('Partners need a REST endpoint to fetch order status', d).conflict, true);
  assert.equal(detectConflict('Add GraphQL resolvers for partner order status instead of REST', d).conflict, false);
});

test('related() reports matched terms as written, search falls back to substrings', () => {
  const ds = [{ id: 'p', text: 'Use PostgreSQL for the orders database', status: 'active' }];
  assert.deepEqual(related('orders database', ds)[0].matchedTerms.sort(), ['database', 'orders']);
  assert.equal(searchLedger(ds, { query: 'postg' }).length, 1);
});
