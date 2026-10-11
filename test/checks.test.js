// Runs the shared cases in test/fixtures/cases.json against the browser checks.
// test/test_scout.py runs the same cases against bin/scout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRepoInput } from '../js/lib/repo-url.js';
import { parseJsonc, looksBinary, lineAt } from '../js/lib/text.js';
import { scanText, reveal } from '../js/checks/unicode.js';
import { analyzeWorkflow } from '../js/checks/workflows.js';
import { analyzeAgentFile, classifyAgentPath, resolveRef, followTargets, crossCheckAgents } from '../js/checks/agents.js';
import { classifyBuildPath, installScripts } from '../js/checks/build.js';
import { findSecurityPolicy } from '../js/checks/setup.js';
import { lockfileParser } from '../js/checks/lockfiles.js';
import { advisoryFindings } from '../js/checks/deps.js';
import { readManifest, analyzePluginFile, analyzePluginTree } from '../js/checks/omarchy.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/cases.json', import.meta.url), 'utf8'));
const text = (t) => (Array.isArray(t) ? t.join('') : t);

function assertFindings(findings, c) {
  if (c.has.length === 0) {
    assert.deepEqual(findings.map((f) => f.title), [], `${c.name}: expected no findings`);
  }
  for (const want of c.has) {
    const hit = findings.find((f) => f.severity === want.severity && f.title.includes(want.title));
    assert.ok(hit, `${c.name}: missing ${want.severity} "${want.title}" in ${JSON.stringify(findings.map((f) => [f.severity, f.title]))}`);
    if (want.line) assert.equal(hit.line, want.line, `${c.name}: line for "${want.title}"`);
    if (want.count) assert.equal(hit.count, want.count, `${c.name}: count for "${want.title}"`);
  }
  for (const not of c.lacks || []) {
    assert.ok(!findings.some((f) => f.title.includes(not)), `${c.name}: unexpected "${not}"`);
  }
  if (c.highCount !== undefined) {
    assert.equal(findings.filter((f) => f.severity === 'high').length, c.highCount, `${c.name}: high count`);
  }
}

test('repo input', () => {
  for (const c of cases.repo_input) {
    if (c.expect) assert.deepEqual(parseRepoInput(c.input), c.expect, c.input);
    else assert.throws(() => parseRepoInput(c.input), c.input);
  }
});

test('unicode', () => {
  for (const c of cases.unicode) {
    const hit = scanText(text(c.text));
    assert.equal(hit ? hit.severity : null, c.severity, c.name);
    if (c.firstLine) assert.equal(hit.samples[0].line, c.firstLine, c.name);
  }
  assert.equal(reveal('a\u202Eb'), 'a⟦U+202E⟧b');
});

test('workflows', () => {
  for (const c of cases.workflow) assertFindings(analyzeWorkflow(text(c.text)), c);
});

test('agent files', () => {
  for (const c of cases.agent_path) assert.equal(classifyAgentPath(c.path)?.kind ?? null, c.kind, c.path);
  for (const c of cases.agent_file) assertFindings(analyzeAgentFile(c.path, text(c.text)), c);
});

const treeEntries = (rows) => rows.map(([path, type, mode]) => ({ path, type, ...(mode ? { mode } : {}) }));

test('agent file cross-checks', () => {
  for (const c of cases.agent_resolve) assert.equal(resolveRef(c.from, c.target).path ?? null, c.expect, `${c.from} -> ${c.target}`);
  for (const c of cases.agent_follow) {
    const byPath = new Map(treeEntries(c.entries).map((e) => [e.path, e]));
    assert.deepEqual(followTargets(byPath, c.path, c.text, c.link).map((t) => [t.path, t.via]), c.expect, c.name);
  }
  for (const c of cases.agent_cross) {
    const texts = new Map(Object.entries(c.texts).map(([k, v]) => [k, text(v)]));
    assertFindings(crossCheckAgents(treeEntries(c.entries), texts, new Map(Object.entries(c.links)), c.extraNames || []), c);
  }
});

test('build-time code', () => {
  for (const c of cases.build_path) assert.equal(classifyBuildPath(c.path)?.severity ?? null, c.severity, c.path);
  for (const c of cases.install_scripts) assert.deepEqual(installScripts(c.text), c.expect);
});

test('security policy order', () => {
  for (const c of cases.security_policy) {
    assert.deepEqual(findSecurityPolicy(c.paths.map((path) => ({ type: 'blob', path }))), c.expect);
  }
});

test('lockfiles', () => {
  for (const c of cases.lockfile) {
    const parse = lockfileParser(c.path);
    if (c.expect === null) { assert.equal(parse, null, c.path); continue; }
    assert.deepEqual(parse(text(c.text)).map((p) => `${p.ecosystem}|${p.name}|${p.version}`), c.expect, c.path);
  }
});

test('omarchy plugin', () => {
  for (const c of cases.plugin_manifest) assert.equal(Boolean(readManifest(c.text)), c.plugin, c.text);
  for (const c of cases.plugin_file) assertFindings(analyzePluginFile(c.path, text(c.text)), c);
  for (const c of cases.plugin_tree) {
    const entries = c.entries.map(([path, size]) => ({ type: 'blob', path, size }));
    assertFindings(analyzePluginTree(entries, c.readme), c);
  }
});

test('browser-only helpers', () => {
  assert.deepEqual(parseJsonc('{ // c\n "a": "x//y", /* b */ "b": [1,], }'), { a: 'x//y', b: [1] });
  assert.equal(looksBinary(new Uint8Array([65, 0, 66])), true);
  assert.equal(looksBinary(new Uint8Array([65, 66])), false);
  assert.deepEqual(lineAt('ab\ncd\nef', 7), { line: 3, column: 2, start: 6 });
});

// The repository runs its own S3 on itself: no source file may contain a
// literal invisible or direction-changing character. Write them as escapes.
test('no hidden characters in this repository', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const root = new URL('../', import.meta.url).pathname;
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    if (name === '.git' || name === 'node_modules' || name === '__pycache__') return [];
    const p = dir + name;
    return statSync(p).isDirectory() ? walk(p + '/') : [p];
  });
  const hits = walk(root)
    .filter((p) => !/\.(png|jpe?g|webp|ico)$/i.test(p))
    .filter((p) => scanText(readFileSync(p, 'utf8')))
    .map((p) => p.slice(root.length));
  assert.deepEqual(hits, []);
});

test('advisories', () => {
  for (const c of cases.advisories) {
    const [f] = advisoryFindings([c.hit], new Map(Object.entries(c.details)));
    assert.equal(f.title, c.expect.title, c.name);
    assert.equal(f.severity, c.expect.severity, c.name);
    assert.deepEqual(f.samples.map((s) => s.osv), c.expect.samples, c.name);
    if (c.expect.texts) assert.deepEqual(f.samples.map((s) => s.text), c.expect.texts, c.name);
  }
});
