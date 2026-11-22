// End-to-end check of the exact texts used in DEMO_SCRIPT.md, so the demo can't silently regress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromText } from '../src/lib/extract.js';
import { findConflicts, related } from '../src/lib/match.js';
import { DEMO_PAGE_TEXT, DEMO_CHECKS } from '../demo/demo-data.js';

const ledger = extractFromText(DEMO_PAGE_TEXT, { source: { type: 'confluence-page', id: 'demo', title: 'Payments architecture sync' } });

test('demo page yields the 7 expected decisions', () => {
  assert.equal(ledger.length, 7, ledger.map((d) => d.text).join(' | '));
});

for (const c of DEMO_CHECKS) {
  test(`demo: ${c.text}`, () => {
    const r = findConflicts(c.text, ledger);
    if (c.conflictWith) {
      assert.ok(r.length >= 1, `expected a conflict for: ${c.text}`);
      assert.match(r[0].decision.text, c.conflictWith);
    } else {
      assert.deepEqual(r.map((x) => x.decision.text), []);
    }
  });
}

test('demo: Rovo question "billing database" finds the PostgreSQL decision', () => {
  assert.match(related('What did we decide about the billing database?', ledger)[0].decision.text, /PostgreSQL/);
});
