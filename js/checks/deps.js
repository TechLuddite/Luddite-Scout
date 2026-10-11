// S5. Known advisories for locked dependencies (OSV), plus OpenSSF Scorecard.
import { lockfileParser } from './lockfiles.js';
import { mapLimit } from '../lib/github.js';

const OSV_BATCH = 1000;
const MAX_DETAILS = 60;

async function osvBatch(queries) {
  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`OSV returned ${res.status}`);
  return (await res.json()).results || [];
}

async function osvVuln(id) {
  const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { credentials: 'omit' });
  return res.ok ? res.json() : null;
}

// The record's own severity, or null when it does not give one.
function severityOf(vuln) {
  const s = String(vuln?.database_specific?.severity || '').toLowerCase();
  if (s === 'critical' || s === 'high') return 'high';
  if (s === 'moderate' || s === 'medium') return 'medium';
  if (s === 'low') return 'low';
  return null;
}

const ORDER = ['high', 'medium', 'low'];

// One finding per package. IDs that alias each other (either record lists the
// other) are one advisory: counted once, shown once, scored as the worst
// severity any member states, or medium when none states one. An ID without
// fetched details joins a group only when a fetched member lists it. `details`
// maps an ID to its OSV record.
export function advisoryFindings(hits, details) {
  const findings = [];
  for (const h of hits) {
    const parent = new Map(h.ids.map((id) => [id, id]));
    const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)));
    for (const id of h.ids) {
      for (const a of details.get(id)?.aliases || []) {
        if (parent.has(a)) parent.set(find(a), find(id));
      }
    }
    const groups = new Map();
    for (const id of h.ids) {
      const root = find(id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(id);
    }
    const advisories = [...groups.values()].map((members) => {
      const id = members.find((m) => m.startsWith('GHSA-')) || members[0];
      const v = details.get(id);
      const aliases = [...new Set([...members, ...(v?.aliases || [])])].filter((a) => a !== id);
      const known = members.map((m) => severityOf(details.get(m))).filter(Boolean);
      const severity = known.length ? known.reduce((a, b) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a)) : 'medium';
      const summary = v?.summary || members.map((m) => details.get(m)?.summary).find(Boolean);
      return { id, aliases, severity, summary };
    });
    const worst = advisories.reduce((acc, a) => (ORDER.indexOf(a.severity) < ORDER.indexOf(acc) ? a.severity : acc), 'low');
    const n = advisories.length;
    findings.push({
      severity: worst,
      title: `${h.pkg.name} ${h.pkg.version} (${h.pkg.ecosystem}): ${n}${h.more ? '+' : ''} known advisor${n === 1 ? 'y' : 'ies'}`,
      path: [...h.pkg.paths][0],
      samples: advisories.slice(0, 8).map((a) => ({
        text: `${a.id}${a.aliases.length ? ` (${a.aliases.slice(0, 3).join(', ')})` : ''}${a.summary ? `: ${a.summary}` : ''}`,
        osv: a.id,
      })),
    });
  }
  return findings;
}

export async function fetchScorecard(owner, repo) {
  let res;
  try {
    res = await fetch(`https://api.securityscorecards.dev/projects/github.com/${owner}/${repo}`, { credentials: 'omit' });
  } catch {
    return { state: 'error', message: 'Scorecard could not be reached.' };
  }
  if (res.status === 404) return { state: 'not-scanned' };
  if (!res.ok) return { state: 'error', message: `Scorecard returned ${res.status}.` };
  const data = await res.json();
  return {
    state: 'ok',
    score: data.score,
    date: data.date,
    checks: (data.checks || []).map((c) => ({ name: c.name, score: c.score, reason: c.reason })),
  };
}

export async function runDeps(ctx) {
  const notes = [];
  const findings = [];

  const scorecard = await fetchScorecard(ctx.owner, ctx.repo);
  if (scorecard.state === 'not-scanned') notes.push('Not scanned by OpenSSF Scorecard. That is common and is not a failure.');
  if (scorecard.state === 'error') notes.push(scorecard.message);

  const lockfiles = ctx.entries.filter((e) => e.type === 'blob' && lockfileParser(e.path));
  if (!lockfiles.length) {
    notes.unshift('No supported lockfiles found (Cargo, npm, pnpm, Yarn, Poetry, uv, PDM, pip requirements, Go, Bundler, Composer).');
    return { status: ctx.truncated ? 'partial' : 'ran', notes, findings, scorecard };
  }

  const packages = new Map();
  let unreadable = 0;
  const texts = await ctx.fetchMany(lockfiles.map((l) => l.path), null, { maxBytes: 20_000_000 });
  for (const [path, res] of texts) {
    if (!res.text) { unreadable++; continue; }
    try {
      for (const p of lockfileParser(path)(res.text)) {
        const key = `${p.ecosystem}|${p.name}|${p.version}`;
        if (!packages.has(key)) packages.set(key, { ...p, paths: new Set() });
        packages.get(key).paths.add(path);
      }
    } catch {
      unreadable++;
    }
  }
  notes.unshift(`Read ${lockfiles.length - unreadable} of ${lockfiles.length} lockfiles, ${packages.size} unique package versions.`);

  const list = [...packages.values()];
  let osvFailed = false;
  const hits = [];
  try {
    for (let i = 0; i < list.length; i += OSV_BATCH) {
      ctx.progress(`S5: checking advisories ${Math.min(i + OSV_BATCH, list.length)} of ${list.length}`);
      const chunk = list.slice(i, i + OSV_BATCH);
      const results = await osvBatch(chunk.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })));
      results.forEach((r, j) => {
        if (r?.vulns?.length) hits.push({ pkg: chunk[j], ids: r.vulns.map((v) => v.id), more: Boolean(r.next_page_token) });
      });
    }
  } catch (e) {
    osvFailed = true;
    notes.push(`Advisory lookup failed: ${e.message}. Lockfiles were read but not checked.`);
  }

  const ids = [...new Set(hits.flatMap((h) => h.ids))];
  const details = new Map();
  await mapLimit(ids.slice(0, MAX_DETAILS), 6, async (id) => details.set(id, await osvVuln(id)));
  if (ids.length > MAX_DETAILS) notes.push(`${ids.length} advisories matched. Details were fetched for the first ${MAX_DETAILS}.`);

  findings.push(...advisoryFindings(hits, details));

  const partial = osvFailed || unreadable || ctx.truncated;
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some lockfiles may be missing.');
  return { status: partial ? 'partial' : 'ran', notes, findings, scorecard };
}
