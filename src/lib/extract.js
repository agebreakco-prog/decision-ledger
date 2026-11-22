// Decision extraction from Confluence (ADF or storage XHTML), Jira comments
// (ADF) and plain text. Deterministic rules only:
//   1. Native Confluence decision items (/decision in the editor) -> ADF decisionItem
//   2. Everything under a heading called "Decision(s)" / "Outcome" / "Resolution"
//   3. Lines like "Decision: ...", "Decided: ...", "Agreed: ...", "We decided to ..."
// Each decision captures what, why (rationale), who (owner) and when.

import { clean, hash, topicTokens } from './text.js';

const PREFIX_RE =
  /^\s*(?:\*\*)?\s*(?:final\s+)?(?:decision|decided|agreed|resolution|resolved|ruling|verdict|outcome)\s*(?:\*\*)?\s*[:\-–—]\s*(.{6,})$/i;
const SENTENCE_RE =
  /\b(?:we|the team|team|leadership|management|i|they|it was|it's been|it has been)\s+(?:have\s+|has\s+)?(?:decided|agreed|resolved|chose|chosen|committed)\s+(?:to|that|on|upon)\s+(.{6,})/i;
const HEADING_RE = /^\s*(?:key\s+|final\s+)?(?:decisions?|decision\s+log|outcomes?|resolutions?|what we decided|agreements?)\b/i;
const RATIONALE_SPLIT_RE = /\s*(?:\bbecause\b|\bsince\b|\bdue to\b|\bso that\b|\bas it\b|\bgiven that\b|[—–]\s*why:|\(why:)\s*/i;
const RATIONALE_LINE_RE = /^\s*(?:why|rationale|reason|reasoning|because)\s*[:\-–]?\s*(.{4,})$/i;
const OWNER_RE = /\b(?:[Oo]wner|[Dd]ecided by|[Aa]pprover|DRI|dri|[Dd]river)\s*[:\-–]\s*@?([A-Z][\w.\-]*(?:\s+[A-Z][\w.\-]*)?)/;
const MENTION_RE = /@([A-Z][\w.\-]+(?:\s[A-Z][\w.\-]+)?)/;

/** Split "Use X because Y" into { text: 'Use X', rationale: 'Y' }. */
export function splitRationale(sentence) {
  const s = clean(sentence).replace(/[.;]+$/, '');
  const m = s.match(RATIONALE_SPLIT_RE);
  if (m && m.index > 8) {
    const text = s.slice(0, m.index).replace(/[,;:]+$/, '').trim();
    const rationale = clean(s.slice(m.index + m[0].length)).replace(/\)$/, '');
    return { text, rationale };
  }
  return { text: s, rationale: '' };
}

// Trailing "@Name" mentions (decision owners) and "Owner: X" suffixes are metadata, not decision text.
const TRAILING_MENTION_RE = /(?:\s*[,;(]?\s*@[\w.\-]+(?:\s[A-Z][\w.\-]*)?\)?)+\s*$/;
export const MENTION_MARK = '\u2063';
const TRAILING_SPAN_RE = new RegExp(`(?:[\\s,;(]*${MENTION_MARK}[^${MENTION_MARK}]*${MENTION_MARK}\\)?)+\\s*$`);
const SPAN_RE = new RegExp(`${MENTION_MARK}([^${MENTION_MARK}]*)${MENTION_MARK}`, 'g');
/** Remove owner metadata (trailing @mentions, "Owner: X") from decision text; keep inline mentions as plain names. */
const stripMeta = (s) =>
  clean(
    String(s || '')
      .replace(TRAILING_SPAN_RE, '')
      .replace(SPAN_RE, '$1')
      .replace(/\s*[(,;\-–—]?\s*\b(?:owner|decided by|dri)\s*[:\-–]\s*@?[^,;()]*\)?\s*$/i, '')
      .replace(TRAILING_MENTION_RE, '')
  ).replace(/[,;:\s\-–—]+$/, '');
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function makeDecision(raw, meta, extra = {}) {
  const split = splitRationale(stripMeta(raw));
  const text = capitalize(stripMeta(split.text));
  const rationale = stripMeta(split.rationale);
  if (!text || text.length < 6 || topicTokens(text).length === 0) return null;
  const ownerMatch = raw.match(OWNER_RE) || raw.match(MENTION_RE);
  const src = meta.source || { type: 'manual' };
  return {
    id: `${src.type || 'manual'}-${hash(`${src.id || ''}|${text.toLowerCase()}`)}`,
    text,
    rationale: stripMeta(extra.rationale) || rationale,
    owner: extra.owner || meta.owner || (ownerMatch ? { name: ownerMatch[1] } : null),
    decidedAt: meta.decidedAt || new Date().toISOString(),
    source: src,
    labels: meta.labels || [],
    status: 'active',
    method: extra.method || 'pattern',
  };
}

/** Decide whether a line states a decision; returns the decision text or null. */
export function matchDecisionLine(line) {
  const l = clean(line);
  if (!l) return null;
  let m = l.match(PREFIX_RE);
  if (m) return m[1];
  m = l.match(SENTENCE_RE);
  if (m) return m[1];
  return null;
}

/** Extract decisions from plain text (Jira comment, Rovo input, pasted notes). */
export function extractFromText(text, meta = {}) {
  const lines = String(text || '')
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  let underHeading = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^#+\s*/, '');
    if (/^#+\s/.test(lines[i]) || (line.length < 40 && /:$/.test(line))) {
      underHeading = HEADING_RE.test(line);
      continue;
    }
    let body = matchDecisionLine(line);
    let method = 'pattern';
    if (!body && underHeading && /^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[i])) {
      body = lines[i].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '');
      method = 'heading';
    }
    if (!body) continue;
    const next = lines[i + 1] && lines[i + 1].match(RATIONALE_LINE_RE);
    const d = makeDecision(body, meta, { method, rationale: next ? clean(next[1]) : undefined });
    if (d) out.push(d);
  }
  return dedupe(out);
}

// ---------- ADF (Atlassian Document Format) ----------

/** Flatten an ADF node to text, collecting mentions. */
export function adfText(node, mentions = []) {
  if (!node) return '';
  if (Array.isArray(node)) return node.map((n) => adfText(n, mentions)).join('');
  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'mention':
      if (node.attrs) mentions.push({ accountId: node.attrs.id, name: String(node.attrs.text || '').replace(/^@/, '') });
      // Wrapped in invisible separators so mentions can be stripped from decision text later.
      return `${MENTION_MARK}@${String(node.attrs?.text || 'user').replace(/^@/, '')}${MENTION_MARK}`;
    case 'hardBreak':
      return '\n';
    case 'emoji':
      return node.attrs?.text || '';
    case 'date':
      return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : '';
    case 'status':
      return node.attrs?.text || '';
    case 'inlineCard':
      return node.attrs?.url || '';
    default: {
      const inner = adfText(node.content || [], mentions);
      const block = /^(paragraph|heading|listItem|decisionItem|taskItem|blockquote|codeBlock|tableCell|tableHeader)$/.test(
        node.type
      );
      return block ? inner + '\n' : inner;
    }
  }
}

/** Extract decisions from an ADF document (Confluence page or Jira comment body). */
export function extractFromAdf(doc, meta = {}) {
  const out = [];
  if (!doc || typeof doc !== 'object') return out;

  // Pass 1: native decision items anywhere in the tree.
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'decisionItem') {
      const state = node.attrs?.state;
      if (!state || state === 'DECIDED') {
        const mentions = [];
        const txt = adfText(node.content || [], mentions);
        const owner = mentions[0] || meta.owner || null;
        const d = makeDecision(txt, meta, { method: 'decision-macro', owner });
        if (d) out.push(d);
      }
      return;
    }
    if (node.content) walk(node.content);
  };
  walk(doc);

  // Pass 2: sections under a "Decisions" heading + inline "Decision:" lines.
  const top = Array.isArray(doc.content) ? doc.content : [];
  let headingLevel = 0;
  let inSection = false;
  const visitBlock = (block) => {
    if (block.type === 'decisionList') return; // handled in pass 1
    if (block.type === 'heading') {
      const level = block.attrs?.level || 1;
      const title = adfText(block.content || []).trim();
      if (HEADING_RE.test(title)) {
        inSection = true;
        headingLevel = level;
      } else if (inSection && level <= headingLevel) {
        inSection = false;
      }
      return;
    }
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      for (const item of block.content || []) {
        const mentions = [];
        const txt = adfText(item.content || [], mentions).trim();
        const firstLine = txt.split('\n')[0];
        const rest = txt.split('\n').slice(1).join(' ');
        const rationaleMatch = rest.match(RATIONALE_LINE_RE);
        const owner = mentions[0] || null;
        const lineBody = matchDecisionLine(firstLine);
        if (lineBody || inSection) {
          const d = makeDecision(lineBody || firstLine, meta, {
            method: lineBody ? 'pattern' : 'heading',
            owner,
            rationale: rationaleMatch ? clean(rationaleMatch[1]) : undefined,
          });
          if (d) out.push(d);
        }
      }
      return;
    }
    if (block.type === 'table') {
      // Decision-log tables: | Decision | Rationale | Owner | ... first column is the decision.
      const rows = block.content || [];
      const header = rows[0] ? (rows[0].content || []).map((c) => adfText(c.content || []).trim().toLowerCase()) : [];
      const dIdx = header.findIndex((h) => /decision|outcome|what/.test(h));
      if (dIdx >= 0) {
        const rIdx = header.findIndex((h) => /why|rationale|reason/.test(h));
        const oIdx = header.findIndex((h) => /owner|who|decided by|dri/.test(h));
        for (const row of rows.slice(1)) {
          const cells = row.content || [];
          const mentions = [];
          const what = adfText(cells[dIdx]?.content || []).trim();
          const why = rIdx >= 0 ? adfText(cells[rIdx]?.content || []).trim() : '';
          const who = oIdx >= 0 ? adfText(cells[oIdx]?.content || [], mentions).trim() : '';
          const d = makeDecision(what, meta, {
            method: 'table',
            rationale: clean(why),
            owner: mentions[0] || (who ? { name: who.replace(/^@/, '') } : null),
          });
          if (d) out.push(d);
        }
      }
      return;
    }
    if (block.type === 'paragraph' || block.type === 'blockquote' || block.type === 'panel') {
      const mentions = [];
      const txt = adfText(block.content || [], mentions);
      const lines = txt.split('\n').filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        const body = matchDecisionLine(lines[i]);
        const asSection = !body && inSection && block.type === 'paragraph' && lines[i].trim().length > 12;
        if (body || asSection) {
          const nxt = lines[i + 1] && lines[i + 1].match(RATIONALE_LINE_RE);
          const d = makeDecision(body || lines[i], meta, {
            method: body ? 'pattern' : 'heading',
            owner: mentions[0] || null,
            rationale: nxt ? clean(nxt[1]) : undefined,
          });
          if (d) out.push(d);
        }
      }
      return;
    }
    if (block.type === 'layoutSection' || block.type === 'layoutColumn' || block.type === 'expand' || block.type === 'nestedExpand') {
      (block.content || []).forEach(visitBlock);
    }
  };
  top.forEach(visitBlock);
  return dedupe(out);
}

// ---------- Confluence storage format (XHTML) fallback ----------

function stripTags(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|tr|td|th|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract from Confluence storage format, including <ac:adf-node type="decision-item">. */
export function extractFromStorage(xhtml, meta = {}) {
  const out = [];
  const s = String(xhtml || '');
  const itemRe = /<ac:adf-node type="decision-item">([\s\S]*?)<\/ac:adf-node>/g;
  let m;
  while ((m = itemRe.exec(s))) {
    const inner = m[1];
    const state = (inner.match(/<ac:adf-attribute key="state">([^<]*)</) || [])[1];
    if (state && state !== 'DECIDED') continue;
    const content = (inner.match(/<ac:adf-content>([\s\S]*?)<\/ac:adf-content>/) || [])[1] || '';
    const d = makeDecision(stripTags(content), meta, { method: 'decision-macro' });
    if (d) out.push(d);
  }
  const withoutDecisionNodes = s.replace(/<ac:adf-extension>[\s\S]*?<\/ac:adf-extension>/g, '');
  const md = withoutDecisionNodes
    .replace(/<h[1-6][^>]*>/gi, '\n# ')
    .replace(/<li[^>]*>/gi, '\n- ');
  out.push(...extractFromText(stripTags(md), meta));
  return dedupe(out);
}

export function dedupe(list) {
  const seen = new Map();
  for (const d of list) if (d && !seen.has(d.id)) seen.set(d.id, d);
  return [...seen.values()];
}
