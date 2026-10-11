import { parseRepoInput } from './lib/repo-url.js';
import { GitHubClient, RateLimitError, blobUrl, mapLimit } from './lib/github.js';
import { isLikelyBinaryPath, truncate } from './lib/text.js';
import { reveal } from './checks/unicode.js';
import { runSetup } from './checks/setup.js';
import { runAgents } from './checks/agents.js';
import { runUnicode } from './checks/unicode.js';
import { runWorkflows } from './checks/workflows.js';
import { runDeps } from './checks/deps.js';
import { runBuild } from './checks/build.js';

const CHECKS = [
  { id: 'S1', name: 'Repository setup', run: runSetup },
  { id: 'S2', name: 'Agent instruction files', run: runAgents },
  { id: 'S3', name: 'Hidden Unicode', run: runUnicode },
  { id: 'S4', name: 'GitHub Actions', run: runWorkflows },
  { id: 'S5', name: 'Dependencies', run: runDeps },
  { id: 'S6', name: 'Build-time code', run: runBuild },
];
// S3 reads every text file, so it goes last.
const RUN_ORDER = ['S1', 'S2', 'S4', 'S6', 'S5', 'S3'];
const SEVERITIES = ['high', 'medium', 'low', 'info'];
const SHOWN = 8;
const STATUS_TEXT ={ ran: 'Ran', partial: 'Partial', skipped: 'Skipped', waiting: 'Waiting', running: 'Running' };

// Every string from the repository reaches the page through text nodes only.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'href') {
      if (/^#[\w-]+$/.test(v)) el.setAttribute('href', v);
      else if (/^https:\/\//.test(v)) {
        el.setAttribute('href', v);
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
    } else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (id) => document.getElementById(id);

function setStatus(text, kind = 'info') {
  const el = $('status');
  el.hidden = !text;
  el.className = `status status-${kind}`;
  el.textContent = text || '';
}

function makeContext({ owner, repo, meta, sha, tree, client }) {
  const cache = new Map();
  const ctx = {
    owner, repo, meta, sha, client,
    entries: tree.tree,
    truncated: Boolean(tree.truncated),
    progress: (msg) => setStatus(msg),
    textBlobs: () => ctx.entries.filter((e) => e.type === 'blob' && !isLikelyBinaryPath(e.path) && e.size <= 1_000_000),
    fetchText(path, opts = {}) {
      const key = `${path}|${opts.maxBytes || ''}`;
      if (!cache.has(key)) cache.set(key, client.raw(owner, repo, sha, path, opts));
      return cache.get(key);
    },
    async fetchMany(paths, onProgress, opts) {
      let done = 0;
      return mapLimit(paths, 12, async (p) => {
        const res = await ctx.fetchText(p, opts);
        done++;
        if (onProgress && (done % 25 === 0 || done === paths.length)) onProgress(done);
        return [p, res];
      });
    },
  };
  return ctx;
}

function badge(sev) {
  return h('span', { class: `sev sev-${sev}` }, sev);
}

function fileLink(ctx, path, line) {
  return h('a', { class: 'path', href: blobUrl(ctx.owner, ctx.repo, ctx.sha, path, line) }, line ? `${path}:${line}` : path);
}

function renderFinding(ctx, f) {
  return h('li', { class: `finding finding-${f.severity}` },
    h('div', { class: 'finding-head' }, badge(f.severity), h('span', { class: 'finding-title' }, reveal(f.title))),
    f.path ? h('div', {}, fileLink(ctx, f.path, f.line)) : null,
    f.detail ? h('p', { class: 'detail' }, reveal(f.detail)) : null,
    f.snippet ? h('pre', { class: 'snippet' }, reveal(truncate(f.snippet, 400))) : null,
    f.samples?.length ? h('ul', { class: 'samples' }, f.samples.map((s) => h('li', {},
      s.line ? h('a', { class: 'path', href: blobUrl(ctx.owner, ctx.repo, ctx.sha, f.path, s.line) }, `line ${s.line}`) : null,
      s.line ? ' ' : null,
      s.osv ? h('a', { href: `https://osv.dev/vulnerability/${encodeURIComponent(s.osv)}` }, s.osv) : null,
      s.osv ? reveal(s.text.slice(s.osv.length)) : reveal(s.text),
    ))) : null,
  );
}

function numbered(text, max = 30_000) {
  const body = text.length > max ? text.slice(0, max) + '\n… truncated for display' : text;
  return reveal(body).split('\n').map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join('\n');
}

function renderContents(title, text) {
  return h('details', { class: 'contents' },
    h('summary', {}, title),
    h('pre', { class: 'file' }, numbered(text)),
  );
}

function renderExtras(ctx, id, result) {
  const out = [];
  if (id === 'S1') {
    out.push(h('dl', { class: 'facts' }, result.facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, reveal(String(v ?? 'Unknown')))])));
    if (result.policy?.text) out.push(renderContents(`Security policy: ${result.policy.path}`, result.policy.text));
  }
  if (id === 'S2' && result.contents?.length) {
    out.push(h('div', { class: 'contents-group' }, result.contents.map((c) => renderContents(`${c.path} (${c.label})`, c.text))));
  }
  if (id === 'S5' && result.scorecard?.state === 'ok') {
    const sc = result.scorecard;
    out.push(h('details', { class: 'contents' },
      h('summary', {}, `OpenSSF Scorecard: ${sc.score} / 10 (${String(sc.date).slice(0, 10)})`),
      h('table', { class: 'scorecard' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Check'), h('th', {}, 'Score'), h('th', {}, 'Reason'))),
        h('tbody', {}, sc.checks.map((c) => h('tr', {}, h('td', {}, c.name), h('td', {}, c.score < 0 ? 'n/a' : c.score), h('td', {}, c.reason || '')))),
      ),
    ));
  }
  return out;
}

function renderCheck(ctx, check, state) {
  const { status, result, error } = state;
  const counts = severityCounts(result?.findings);
  const sorted = [...(result?.findings || [])].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

  return h('article', { class: `check status-${status}`, id: `check-${check.id}` },
    h('header', { class: 'check-head' },
      h('h2', {}, h('span', { class: 'code' }, check.id), ' ', check.name),
      h('span', { class: `state state-${status}` }, STATUS_TEXT[status]),
      result ? h('span', { class: 'counts' }, SEVERITIES.filter((s) => counts[s]).map((s) => h('span', { class: `count sev-${s}` }, `${counts[s]} ${s}`))) : null,
    ),
    error ? h('p', { class: 'note' }, error) : null,
    result?.notes?.length ? h('ul', { class: 'notes' }, result.notes.map((n) => h('li', {}, n))) : null,
    result ? renderExtras(ctx, check.id, result) : null,
    sorted.length ? h('ul', { class: 'findings' }, sorted.slice(0, SHOWN).map((f) => renderFinding(ctx, f))) : null,
    sorted.length > SHOWN ? h('details', { class: 'more' },
      h('summary', {}, `Show ${sorted.length - SHOWN} more`),
      h('ul', { class: 'findings' }, sorted.slice(SHOWN).map((f) => renderFinding(ctx, f))),
    ) : null,
    result && !sorted.length && status === 'ran' ? h('p', { class: 'clean' }, 'Nothing flagged.') : null,
  );
}

function severityCounts(findings = []) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) counts[f.severity]++;
  return counts;
}

// One row per check, so a long dependency list cannot drown out the
// agent-facing checks.
function renderSummary(ctx, states, client) {
  return h('section', { class: 'summary' },
    h('h2', {}, h('a', { href: `https://github.com/${ctx.owner}/${ctx.repo}` }, `${ctx.owner}/${ctx.repo}`)),
    h('p', { class: 'commit' }, 'Reviewed commit ', h('a', { href: `https://github.com/${ctx.owner}/${ctx.repo}/tree/${ctx.sha}` }, h('code', {}, ctx.sha))),
    h('ul', { class: 'overview' }, CHECKS.map((c) => {
      const st = states[c.id];
      const counts = severityCounts(st.result?.findings);
      return h('li', {},
        h('a', { href: `#check-${c.id}` }, h('span', { class: 'code' }, c.id), ' ', c.name),
        h('span', { class: `state state-${st.status}` }, STATUS_TEXT[st.status]),
        h('span', { class: 'counts' }, SEVERITIES.filter((s) => counts[s]).map((s) => h('span', { class: `count sev-${s}` }, `${counts[s]} ${s}`))),
      );
    })),
    h('p', { class: 'muted' }, `GitHub API: ${client.calls} requests used, ${client.remaining ?? '?'} of ${client.limit ?? '?'} left this hour.`),
  );
}

async function scan(input, token) {
  const { owner, repo } = parseRepoInput(input);
  const client = new GitHubClient({ token: token || null });
  const results = $('results');
  results.replaceChildren();

  setStatus(`Fetching ${owner}/${repo}`);
  const meta = await client.api(`/repos/${owner}/${repo}`);
  if (!meta) throw new Error(`${owner}/${repo} was not found. It may be private, renamed, or misspelled.`);
  if (meta.private) throw new Error('This repository is private. Luddite Scout only reviews public repositories.');

  const branch = await client.api(`/repos/${owner}/${repo}/branches/${encodeURIComponent(meta.default_branch)}`);
  if (!branch) throw new Error('The default branch could not be read.');
  const sha = branch.commit.sha;

  setStatus('Fetching the file list');
  const tree = await client.api(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  if (!tree) throw new Error('The file list could not be read.');

  const ctx = makeContext({ owner: meta.owner.login, repo: meta.name, meta, sha, tree, client });
  const states = Object.fromEntries(CHECKS.map((c) => [c.id, { status: 'waiting' }]));
  const summarySlot = h('div');
  const slots = Object.fromEntries(CHECKS.map((c) => [c.id, h('div')]));
  results.append(summarySlot, ...CHECKS.map((c) => slots[c.id]));

  const redraw = (id) => {
    if (id) slots[id].replaceChildren(renderCheck(ctx, CHECKS.find((c) => c.id === id), states[id]));
    summarySlot.replaceChildren(renderSummary(ctx, states, client));
  };
  CHECKS.forEach((c) => redraw(c.id));

  for (const id of RUN_ORDER) {
    const check = CHECKS.find((c) => c.id === id);
    states[id] = { status: 'running' };
    redraw(id);
    setStatus(`${id}: ${check.name}`);
    try {
      const result = await check.run(ctx);
      states[id] = { status: result.status, result };
    } catch (e) {
      const why = e instanceof RateLimitError ? e.message : `This check failed: ${e.message}`;
      states[id] = { status: 'skipped', error: why };
    }
    redraw(id);
  }
  setStatus('');
}

function init() {
  const form = $('scan-form');
  const button = $('scan-button');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    button.disabled = true;
    try {
      await scan($('repo-input').value, $('token-input').value.trim());
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

init();
