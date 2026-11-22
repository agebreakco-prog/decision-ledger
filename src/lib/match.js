// Deterministic relevance + contradiction detection over the decision ledger.
//   relevance : TF-IDF cosine on topic tokens, boosted by shared labels/components
//   conflict  : topic overlap AND one of
//                 - opposite stance ("use X" vs "stop using X")
//                 - same scope, different choice ("use Postgres for billing" vs "use Mongo for billing")
//                 - reviving a rejected alternative ("X over Y" / "instead of Y" vs "use Y")
//                 - antonyms on the same topic (sync vs async, public vs private, ...)
// Every flag carries a human-readable reason so users can see *why*.

import {
  ANTONYM_PAIRS, NEGATIONS, NEGATIVE_STANCE, POSITIVE_STANCE, rawTokens, stem, topicTokens, truncate,
} from './text.js';

export function decisionDocText(d) {
  return [d.text, d.rationale, (d.labels || []).join(' '), d.source?.title || ''].filter(Boolean).join(' ');
}

export function buildIndex(decisions) {
  const df = new Map();
  const docs = decisions.map((d) => {
    const toks = topicTokens(decisionDocText(d));
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
    return { d, toks };
  });
  const N = docs.length;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  for (const doc of docs) doc.vec = vectorize(doc.toks, idf);
  return { docs, idf, N };
}

export function vectorize(tokens, idf) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Map();
  let norm = 0;
  for (const [t, c] of tf) {
    const w = (1 + Math.log(c)) * idf(t);
    vec.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}

export function cosine(a, b) {
  let s = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) if (big.has(t)) s += w * big.get(t);
  return s;
}

function sharedTerms(a, b, limit = 6, surface) {
  return [...a.keys()]
    .filter((t) => b.has(t))
    .sort((x, y) => a.get(y) * b.get(y) - a.get(x) * b.get(x))
    .slice(0, limit)
    .map((t) => (surface && surface.get(t)) || t);
}

/** Map stems back to the words the user actually wrote, so the UI shows "database" rather than "databas". */
function surfaceForms(...texts) {
  const m = new Map();
  for (const text of texts) {
    for (const w of rawTokens(text)) {
      const st = stem(w);
      if (!m.has(st)) m.set(st, w);
    }
  }
  return m;
}

/**
 * Rank decisions related to a piece of text (issue summary + description, a question...).
 * opts: { labels: string[], limit, minScore, includeSuperseded }
 */
export function related(text, decisions, opts = {}) {
  const { labels = [], limit = 5, minScore = 0.12, includeSuperseded = false } = opts;
  const pool = includeSuperseded ? decisions : decisions.filter((d) => d.status !== 'superseded');
  if (!pool.length) return [];
  const index = buildIndex(pool);
  const q = vectorize(topicTokens(`${text} ${labels.join(' ')}`), index.idf);
  const labelSet = new Set(labels.map((l) => stem(String(l).toLowerCase())));
  const surface = surfaceForms(text, labels.join(' '));
  return index.docs
    .map(({ d, vec }) => {
      let score = cosine(q, vec);
      const shared = (d.labels || []).filter((l) => labelSet.has(stem(String(l).toLowerCase())));
      if (score > 0 && shared.length) score = Math.min(1, score + 0.1 * shared.length);
      return { decision: d, score: round(score), matchedTerms: sharedTerms(q, vec, 6, surface), sharedLabels: shared };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------- stance / choice analysis ----------

/** +1 = affirmative ("use X"), -1 = negative ("stop X", "do not use X"), 0 = unknown. */
export function polarity(text) {
  const toks = rawTokens(text);
  let score = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    let p = 0;
    if (POSITIVE_STANCE.has(t)) p = 1;
    else if (NEGATIVE_STANCE.has(t)) p = -1;
    else if (NEGATIONS.has(t) && (i === 0 || !['will', 'shall', 'do', 'does', 'should', 'must', 'can', 'not'].includes(toks[i + 1]))) {
      // bare negation like "no Mongo" / "never deploy on Fridays"
      if (!toks.slice(i + 1, i + 4).some((x) => POSITIVE_STANCE.has(x) || NEGATIVE_STANCE.has(x))) p = -1;
    }
    if (!p) continue;
    if (POSITIVE_STANCE.has(t) || NEGATIVE_STANCE.has(t)) {
      const window = toks.slice(Math.max(0, i - 3), i);
      if (window.some((w) => NEGATIONS.has(w))) p = -p;
    }
    score += p;
  }
  return Math.sign(score);
}

const CHOICE_VERBS =
  '(?:use|using|adopt|choose|chose|pick|select|go with|going with|switch to|switching to|migrate to|move to|standardi[sz]e on|stick with|keep|build|run|host)';

/** Parse "use X for Y", "X over Y", "X instead of Y" style choices. */
export function parseChoice(text) {
  // Parse each sentence / line on its own so "Migrate X to Y\nMove the ..." does not bleed across sentences.
  const sentences = String(text || '').split(/[\n\r]+|[.!?;]+(?:\s+|$)/).filter((x) => x.trim());
  const res = { choice: null, scope: null, rejected: [] };
  for (const sentence of sentences.length ? sentences : ['']) {
    const r = parseSentenceChoice(sentence);
    if (!res.choice && r.choice) {
      res.choice = r.choice;
      res.scope = r.scope;
    } else if (res.choice && !res.scope && r.choice && r.scope && overlap(tokenSet(r.choice), tokenSet(res.choice)) > 0) {
      res.scope = r.scope;
    }
    for (const x of r.rejected) if (!res.rejected.includes(x)) res.rejected.push(x);
  }
  return res;
}

function parseSentenceChoice(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[.,;!?()]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const res = { choice: null, scope: null, rejected: [] };
  // Negated choices ("stop using X", "do not use X") are rejections, not choices.
  const positive = t.replace(
    /\b(?:stop|not|never|avoid|no longer|quit)\s+(?:using\s+|use\s+|adopting\s+|adopt\s+|choosing\s+)?[a-z0-9+#.\-]+/g,
    ' '
  );
  const moveRe =
    /\b(?:move|migrate|switch|port|convert|rewrite)\s+(?:the\s+|our\s+|all\s+)?([a-z0-9+#.\- ]{2,40}?)\s+(?:to|onto|into|in)\s+([a-z0-9+#.\-]+(?:\s(?!and\b|because\b|since\b|for\b)[a-z0-9+#.\-]+)?)/;
  const m = positive.match(new RegExp(`${CHOICE_VERBS}\\s+([a-z0-9+#.\\- ]{2,40}?)\\s+(?:for|as|in|on|to handle|to power)\\s+(?:the\\s+|our\\s+|all\\s+)?([a-z0-9+#.\\- ]{2,40}?)(?=\\s+(?:because|since|due|so|and|but|instead|over|rather|until|from|starting|by|with)\\s|\\s*$)`));
  if (m) {
    res.choice = m[1].trim();
    res.scope = m[2].trim();
  } else if (moveRe.test(positive)) {
    const m3 = positive.match(moveRe);
    res.scope = m3[1].trim();
    res.choice = m3[2].trim();
  } else {
    const m2 = positive.match(new RegExp(`${CHOICE_VERBS}\\s+([a-z0-9+#.\\- ]{2,40}?)(?=\\s+(?:because|since|due|over|instead|rather|and|but|for)\\s|\\s*$)`));
    if (m2) res.choice = m2[1].trim();
  }
  const rej = [
    /\b(?:over|instead of|rather than|not)\s+([a-z0-9+#.\-]+(?:\s[a-z0-9+#.\-]+)?)/g,
    /\b(?:reject(?:ed)?|drop(?:ped)?|avoid|ban(?:ned)?|stop using)\s+([a-z0-9+#.\-]+(?:\s[a-z0-9+#.\-]+)?)/g,
  ];
  for (const re of rej) {
    let mm;
    while ((mm = re.exec(t))) {
      const v = mm[1].trim().replace(/\s+(?:for|as|in|on|because|since)$/, '');
      if (v && !['to', 'the', 'a', 'be', 'use', 'using'].includes(v)) res.rejected.push(v);
    }
  }
  if (res.choice) res.choice = res.choice.replace(/^(?:the|a|an|our)\s+/, '');
  return res;
}

function tokenSet(s) {
  return new Set(topicTokens(s || ''));
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}

function antonymHit(aText, bText) {
  const a = rawTokens(aText).join(' ');
  const b = rawTokens(bText).join(' ');
  for (const [x, y] of ANTONYM_PAIRS) {
    const has = (s, w) => new RegExp(`(^|\\s)${w}`).test(s);
    if ((has(a, x) && has(b, y) && !has(a, y)) || (has(a, y) && has(b, x) && !has(a, x))) return [x, y];
  }
  return null;
}

/**
 * Does `text` contradict decision `d`? Returns { conflict, confidence, similarity, reasons[] }.
 * idf is optional; when absent a flat weighting is used.
 */
export function detectConflict(text, d, idf = () => 1) {
  const qv = vectorize(topicTokens(text), idf);
  const dv = vectorize(topicTokens(`${d.text} ${(d.labels || []).join(' ')}`), idf);
  const similarity = cosine(qv, dv);
  const reasons = [];
  let confidence = 0;

  const pa = polarity(d.text);
  const pb = polarity(text);
  const ca = parseChoice(d.text);
  const cb = parseChoice(text);
  const choiceA = tokenSet(ca.choice);
  const choiceB = tokenSet(cb.choice);

  // 1. Different choice for the same scope.
  if (ca.choice && cb.choice && ca.scope && cb.scope) {
    const scopeOverlap = overlap(tokenSet(ca.scope), tokenSet(cb.scope));
    if (scopeOverlap >= 0.5 && overlap(choiceA, choiceB) === 0) {
      reasons.push(`Decision chose "${ca.choice}" for ${ca.scope}; this proposes "${cb.choice}" instead.`);
      confidence = Math.max(confidence, 0.6 + 0.3 * scopeOverlap);
    }
  }
  // 2. Reviving a rejected alternative.
  const textTokens = tokenSet(text);
  const preferred = String(d.text).toLowerCase().match(/([a-z0-9+#.\-]+)\s+(?:over|instead of|rather than)\s/);
  const preferredTokens = tokenSet(preferred ? preferred[1] : '');
  for (const r of ca.rejected) {
    const rs = tokenSet(r);
    if (!rs.size || cb.rejected.some((x) => overlap(tokenSet(x), rs) > 0)) continue;
    if (overlap(rs, choiceB) > 0 || (pb > 0 && overlap(rs, textTokens) === 1 && similarity > 0.15)) {
      reasons.push(`Decision explicitly ruled out "${r}".`);
      confidence = Math.max(confidence, 0.75);
      break;
    }
    // The text asks for the ruled-out option without naming any stance verb ("Partners need a REST endpoint").
    if (pb >= 0 && overlap(rs, textTokens) === 1 && similarity >= 0.25 && ca.choice == null) {
      if (!preferredTokens.size || overlap(preferredTokens, textTokens) === 0) {
        reasons.push(`Decision ruled out "${r}"; this text brings it back.`);
        confidence = Math.max(confidence, 0.6);
        break;
      }
    }
  }
  // 2b. Rejecting what the decision chose.
  if (ca.choice && cb.rejected.some((r) => overlap(tokenSet(r), choiceA) > 0)) {
    reasons.push(`This text drops "${ca.choice}", which the decision chose.`);
    confidence = Math.max(confidence, Math.min(0.9, 0.55 + similarity / 2));
  }
  // 3. Opposite stance on the same topic.
  if (pa && pb && pa !== pb && similarity >= 0.3) {
    reasons.push(
      pa > 0
        ? `Decision is in favour ("${truncate(d.text, 80)}"); this text argues against it.`
        : `Decision rules this out ("${truncate(d.text, 80)}"); this text argues for it.`
    );
    confidence = Math.max(confidence, Math.min(0.95, 0.35 + similarity));
  }
  // 3b. The decision bans something ("No production deploys on Fridays") and the
  //     text proposes doing it, without any negation of its own.
  if (pa < 0 && pb >= 0 && similarity >= 0.35 && !rawTokens(text).some((t) => NEGATIONS.has(t)) && !reasons.length) {
    reasons.push(`Decision rules this out ("${truncate(d.text, 80)}"); this text proposes doing it.`);
    confidence = Math.max(confidence, Math.min(0.9, 0.25 + similarity));
  }
  // 4. Antonyms on the same topic.
  // Gate on the larger of the IDF-weighted and the plain term overlap: IDF shifts as the ledger grows,
  // and a few shared words ("order confirmation email") are enough context for an antonym clash.
  const flat = () => 1;
  const plainSimilarity = cosine(vectorize(topicTokens(text), flat), vectorize(topicTokens(d.text), flat));
  const ant = Math.max(similarity, plainSimilarity) >= 0.25 ? antonymHit(d.text, text) : null;
  if (ant) {
    reasons.push(`Opposing terms on the same topic: "${ant[0]}…" vs "${ant[1]}…".`);
    confidence = Math.max(confidence, Math.min(0.9, 0.3 + Math.max(similarity, plainSimilarity)));
  }
  // Gate: everything except an exact choice/scope clash needs some topical overlap.
  if (similarity < 0.12 && confidence < 0.6) confidence = 0;
  return {
    conflict: confidence >= 0.45,
    confidence: round(confidence),
    similarity: round(similarity),
    reasons,
  };
}

/** Check text against the whole ledger. Returns conflicts sorted by confidence. */
export function findConflicts(text, decisions, opts = {}) {
  const { limit = 5, excludeIds = [] } = opts;
  const pool = decisions.filter((d) => d.status !== 'superseded' && !excludeIds.includes(d.id));
  if (!pool.length || !String(text || '').trim()) return [];
  const { idf } = buildIndex(pool);
  return pool
    .map((d) => ({ decision: d, ...detectConflict(text, d, idf) }))
    .filter((r) => r.conflict)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/** Simple ledger search with filters, used by the global page and the Rovo agent. */
export function searchLedger(decisions, { query = '', status = 'active', source = 'all', label = '', limit = 50 } = {}) {
  let pool = decisions;
  if (status && status !== 'all') pool = pool.filter((d) => (d.status || 'active') === status);
  if (source && source !== 'all') pool = pool.filter((d) => d.source?.type === source);
  if (label) pool = pool.filter((d) => (d.labels || []).some((l) => l.toLowerCase() === label.toLowerCase()));
  if (!query.trim()) {
    return pool
      .slice()
      .sort((a, b) => (Date.parse(b.decidedAt) || 0) - (Date.parse(a.decidedAt) || 0))
      .slice(0, limit)
      .map((d) => ({ decision: d, score: null, matchedTerms: [] }));
  }
  const ranked = related(query, pool, { limit, minScore: 0.05, includeSuperseded: true });
  // Partial words ("datab", "postg") still find something: fall back to a plain substring match.
  const q = query.trim().toLowerCase();
  const seen = new Set(ranked.map((r) => r.decision.id));
  const partial = pool
    .filter((d) => !seen.has(d.id) && decisionDocText(d).toLowerCase().includes(q))
    .map((d) => ({ decision: d, score: 0.05, matchedTerms: [q], sharedLabels: [] }));
  return [...ranked, ...partial].slice(0, limit);
}

function round(x) {
  return Math.round(x * 100) / 100;
}
