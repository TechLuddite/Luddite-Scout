// S3. Characters that change how text displays, or hide it, without being visible.
import { codePoint, lineAt, lineText, truncate } from '../lib/text.js';

const PATTERN = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

export function classify(ch) {
  const cp = ch.codePointAt(0);
  if ((cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069)) {
    return { kind: 'Bidirectional control', severity: 'high' };
  }
  if (cp >= 0xE0000 && cp <= 0xE007F) return { kind: 'Tag character', severity: 'high' };
  if (cp >= 0xE0100 && cp <= 0xE01EF) return { kind: 'Variation selector supplement', severity: 'high' };
  if (cp === 0x200E || cp === 0x200F || cp === 0x061C) return { kind: 'Direction mark', severity: 'medium' };
  if (cp === 0x200C || cp === 0x200D) return { kind: 'Zero-width joiner', severity: 'low' };
  if (cp === 0x00AD) return { kind: 'Soft hyphen', severity: 'low' };
  return { kind: 'Zero-width or invisible character', severity: 'medium' };
}

const RANK = { info: 0, low: 1, medium: 2, high: 3 };

// Joiners between emoji are normal ("family" emoji, flags), so they are dropped.
function isEmojiJoin(text, index, ch) {
  if (ch !== '\u200D') return false;
  const before = text.slice(Math.max(0, index - 2), index);
  const after = text.slice(index + 1, index + 3);
  return /\p{Extended_Pictographic}/u.test(before) && /\p{Extended_Pictographic}/u.test(after);
}

// Renders invisible characters as visible markers for display.
export function reveal(s) {
  return s.replace(PATTERN, (ch) => `⟦${codePoint(ch)}⟧`);
}

export function scanText(text, { maxSamples = 10 } = {}) {
  const counts = new Map();
  const samples = [];
  let severity = null;
  PATTERN.lastIndex = 0;
  for (const m of text.matchAll(PATTERN)) {
    const ch = m[0];
    if (ch === '\uFEFF' && m.index === 0) continue; // byte order mark
    if (isEmojiJoin(text, m.index, ch)) continue;
    const { kind, severity: sev } = classify(ch);
    counts.set(kind, (counts.get(kind) || 0) + 1);
    if (!severity || RANK[sev] > RANK[severity]) severity = sev;
    if (samples.length < maxSamples) {
      const pos = lineAt(text, m.index);
      const full = lineText(text, pos.start);
      const from = Math.max(0, pos.column - 60);
      samples.push({
        line: pos.line,
        column: pos.column,
        codePoint: codePoint(ch),
        kind,
        excerpt: truncate(reveal(full.slice(from, from + 160)), 220),
      });
    }
  }
  return severity ? { severity, counts: Object.fromEntries(counts), samples } : null;
}

export async function runUnicode(ctx, { maxFiles = 4000, maxBytes = 60_000_000 } = {}) {
  const findings = [];
  const notes = [];

  for (const entry of ctx.entries) {
    const hit = scanText(entry.path, { maxSamples: 1 });
    if (hit) {
      findings.push({
        severity: hit.severity,
        title: 'Hidden character in a file or folder name',
        path: entry.path,
        detail: `Name with markers: ${reveal(entry.path)}`,
      });
    }
  }

  const candidates = ctx.textBlobs();
  let budget = maxBytes;
  const selected = [];
  for (const b of candidates) {
    if (selected.length >= maxFiles || b.size > budget) break;
    selected.push(b);
    budget -= b.size;
  }
  const notCovered = candidates.length - selected.length;

  let scanned = 0;
  let skipped = 0;
  const texts = await ctx.fetchMany(selected.map((b) => b.path), (done) => {
    ctx.progress(`S3: reading files ${done} of ${selected.length}`);
  });
  for (const [path, res] of texts) {
    if (!res.text) { skipped++; continue; }
    scanned++;
    const hit = scanText(res.text);
    if (!hit) continue;
    const summary = Object.entries(hit.counts).map(([k, n]) => `${n} × ${k}`).join(', ');
    findings.push({
      severity: hit.severity,
      title: summary,
      path,
      line: hit.samples[0]?.line,
      samples: hit.samples.map((s) => ({ line: s.line, text: `${s.codePoint} col ${s.column}: ${s.excerpt}` })),
    });
  }

  notes.push(`Scanned ${scanned} text files and ${ctx.entries.length} names.`);
  if (skipped) notes.push(`${skipped} files could not be read as text (binary, too large, or not served).`);
  if (notCovered) notes.push(`${notCovered} files not read because of the size or count cap.`);
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some files were never listed.');

  return {
    status: notCovered || ctx.truncated ? 'partial' : 'ran',
    notes,
    findings,
  };
}
