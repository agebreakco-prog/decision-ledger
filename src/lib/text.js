// Text utilities shared by extraction and matching. Pure, dependency-free and
// deterministic so the whole pipeline is unit-testable and costs no LLM credits.

export const STOPWORDS = new Set(
  (
    'a an and are as at be been being but by can could did do does doing for from had has have having he her ' +
    'here hers him his how i if in into is it its itself just me more most my of off on once only or other ' +
    'our ours out over own same she should so some such than that the their theirs them then there these they ' +
    'this those through to too under until up very was we were what when where which while who whom why will ' +
    'with would you your yours also all any each few both now per via about after again against before below ' +
    'between during further above down let lets us one two get got make made going go goes went team teams ' +
    'decided decide decision decisions agreed agree agreement resolution resolved outcome final call going ' +
    'need needs needed want wants today tomorrow yesterday week weeks month months quarter q1 q2 q3 q4 etc ie eg'
  ).split(/\s+/)
);

// Words that express a stance (do / don't) rather than a topic. They are
// excluded from topic vectors but drive polarity detection.
export const POSITIVE_STANCE = new Set([
  'use', 'adopt', 'keep', 'enable', 'allow', 'require', 'choose', 'chose', 'pick', 'select', 'switch', 'migrate',
  'approve', 'introduce', 'add', 'standardize', 'standardise', 'mandate', 'continue', 'support', 'build',
  'buy', 'start', 'launch', 'ship', 'move', 'prefer', 'retain', 'include', 'accept', 'permit', 'go', 'proceed',
]);
export const NEGATIVE_STANCE = new Set([
  'avoid', 'stop', 'drop', 'deprecate', 'remove', 'ban', 'forbid', 'disallow', 'reject', 'abandon', 'sunset',
  'disable', 'postpone', 'defer', 'cancel', 'against', 'freeze', 'pause', 'retire', 'exclude', 'block',
  'prohibit', 'discontinue', 'decline', 'skip', 'halt', 'kill', 'shelve',
]);
export const NEGATIONS = new Set(['not', 'no', 'never', 'without', 'nor', 'neither', 'none', 'cannot']);

// Mutually exclusive pairs: if one decision says A and the new text says B on
// the same topic, that's a likely contradiction.
export const ANTONYM_PAIRS = [
  ['enable', 'disable'], ['allow', 'forbid'], ['allow', 'block'], ['allow', 'disallow'], ['sync', 'async'],
  ['synchronous', 'asynchronous'], ['public', 'private'], ['include', 'exclude'], ['manual', 'automat'], ['manually', 'automat'],
  ['mandatory', 'optional'], ['require', 'optional'], ['increase', 'decrease'], ['increasing', 'decreasing'], ['monolith', 'microservic'],
  ['build', 'buy'], ['remote', 'onsite'], ['remote', 'in-office'], ['weekly', 'monthly'], ['daily', 'weekly'], ['open', 'closed'],
  ['centraliz', 'decentraliz'], ['centralis', 'decentralis'], ['upgrad', 'downgrad'], ['hiring', 'freez'], ['in-house', 'outsourc'],
  ['internal', 'external'], ['opt-in', 'opt-out'],
];

const CONTRACTIONS = [
  [/\b(can)'?t\b/gi, 'can not'], [/\bwon'?t\b/gi, 'will not'], [/\bshan'?t\b/gi, 'shall not'],
  [/n['’]t\b/gi, ' not'],
];

export function normalize(text) {
  let t = String(text || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  return t;
}

/** Very small suffix stripper (Porter-lite). Stable and good enough for matching. */
export function stem(word) {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  const rules = [
    [/ies$/, 'y'], [/sses$/, 'ss'], [/ization$/, 'iz'], [/isation$/, 'iz'], [/ational$/, 'at'],
    [/(\w{3})ings?$/, '$1'], [/(\w{3})edly$/, '$1'], [/(\w{3})ed$/, '$1'], [/(\w{3})ers?$/, '$1'],
    [/(\w{3})ly$/, '$1'], [/(\w{3})ment$/, '$1'], [/(\w{3})es$/, '$1'], [/([^s])s$/, '$1'], [/(\w{4})e$/, '$1'],
  ];
  for (const [re, rep] of rules) {
    if (re.test(w)) {
      w = w.replace(re, rep);
      break;
    }
  }
  return w;
}

/** All lowercase word tokens (no filtering), contractions expanded. */
export function rawTokens(text) {
  return (normalize(text).toLowerCase().match(/[a-z0-9][a-z0-9+#.\-]*[a-z0-9+#]|[a-z0-9]/g) || []).map((t) =>
    t.replace(/\.+$/, '')
  );
}

/** Topic tokens: stopwords, stance words and negations removed, then stemmed. */
export function topicTokens(text) {
  return rawTokens(text)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !NEGATIONS.has(t))
    .filter((t) => !POSITIVE_STANCE.has(t) && !NEGATIVE_STANCE.has(t))
    .filter((t) => !/^\d+$/.test(t))
    .map(stem);
}

/** FNV-1a 32-bit hash -> base36 string, for stable ids. */
export function hash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function clean(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—*•:]+/, '')
    .trim();
}

export function truncate(text, n = 280) {
  const t = clean(text);
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}
