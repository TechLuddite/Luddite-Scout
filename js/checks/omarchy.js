// S7. Omarchy shell plugins. Runs only when the repository root has an Omarchy
// plugin manifest, and reports "not applicable" otherwise. The rules are the
// patterns the Omarchy plugin marketplace review blocks most often.
import { classifyAgentPath } from './agents.js';

const CODE_EXT = /\.(qml|js|mjs|sh|bash|py)$/i;
const SCANNER_FILE_LIMIT = 512 * 1024;
const SCANNER_FILE_COUNT = 1000;
const BINARY_EXT = /\.(so|dylib|dll|exe|node|wasm|pyc|qsb|a|o)$/i;

// [pattern, severity, title, file filter]
const LINE_RULES = [
  [/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, 'high', 'Downloads and runs a script in one step', CODE_EXT],
  [/\b(sudo|pkexec)\b/, 'high', 'Uses sudo or pkexec', CODE_EXT],
  [/\bsetcap\b|\bchmod\s+[0-7]*[46][0-7]{3}\b/, 'high', 'Changes file capabilities or setuid bits', CODE_EXT],
  [/\bStdioCollector\b/, 'medium', 'Collects a child process\'s whole output before checking its size', /\.qml$/i],
  [/["'](ba)?sh["']\s*,\s*["']-l?c["']|\bexecDetached\(\s*["'`]|\bbar\.run\(/, 'medium', 'Runs a shell command string rather than an argument list', /\.(qml|js|mjs)$/i],
  [/\bshell\s*=\s*True\b|\bos\.system\(/, 'medium', 'Runs a shell command string from Python', /\.py$/i],
  [/\bXMLHttpRequest\b/, 'medium', 'Makes network requests from inside the shared shell process', /\.(qml|js|mjs)$/i],
  [/\bcurl\b[^\n]*\s(-L|--location|-k|--insecure)\b|verify\s*=\s*False|CERT_NONE/, 'medium', 'Follows redirects or skips TLS verification', CODE_EXT],
  [/Authorization:\s*Bearer\s*\$|-u\s+["']?\$\w+:|\btoken=\$/, 'medium', 'May put a credential on a command line, where other processes can read it', CODE_EXT],
  [/releases\/latest|\bgit\s+(clone|pull)\b|\b(pip|pipx|npm|cargo|go)\s+install\b|\b(yay|paru)\s+-S|\bpacman\s+-S/, 'medium', 'Installs or fetches code at run time', CODE_EXT],
  [/\bsystemctl\s+(?!--user)(enable|start|restart|disable|stop|mask)\b/, 'medium', 'Changes system services', CODE_EXT],
  [/["'`]\/tmp\/|\$\{XDG_RUNTIME_DIR:-/, 'low', 'Uses a predictable shared temporary path', CODE_EXT],
];

export function readManifest(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  if (data.schemaVersion === undefined || !(data.entryPoints || data.kinds)) return null;
  return data;
}

function isComment(line) {
  return /^\s*(\/\/|#|\*|\/\*)/.test(line);
}

// QML Text-like items without an explicit textFormat render markup, which can
// make the shell fetch remote images named in untrusted strings.
export function textSinksWithoutFormat(src) {
  const lines = [];
  const re = /\b(Text|Label|TextEdit)\s*\{/g;
  for (const m of src.matchAll(re)) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    if (!/\btextFormat\s*:/.test(src.slice(m.index + m[0].length, i))) {
      lines.push(src.slice(0, m.index).split('\n').length);
    }
  }
  return lines;
}

export function analyzePluginFile(path, text) {
  const findings = [];
  const fileLines = text.split(/\r?\n/);
  for (const [re, severity, title, filter] of LINE_RULES) {
    if (!filter.test(path)) continue;
    const hits = [];
    fileLines.forEach((l, i) => {
      if (!isComment(l) && re.test(l)) hits.push({ line: i + 1, text: l.trim().slice(0, 200) });
    });
    if (hits.length) {
      findings.push({ severity, title, path, line: hits[0].line, samples: hits.slice(0, 5), count: hits.length });
    }
  }
  if (/\.qml$/i.test(path)) {
    const missing = textSinksWithoutFormat(text);
    if (missing.length) {
      findings.push({
        severity: 'medium',
        title: `${missing.length} Text item${missing.length > 1 ? 's' : ''} without textFormat: Text.PlainText`,
        detail: 'Without it Qt may render markup, including image tags that make the shell fetch a URL.',
        path,
        line: missing[0],
        samples: missing.slice(0, 5).map((line) => ({ line, text: 'Text without textFormat' })),
        count: missing.length,
      });
    }
  }
  return findings;
}

export function analyzePluginTree(entries, readmeText) {
  const findings = [];
  const blobs = entries.filter((e) => e.type === 'blob');
  if (blobs.length > SCANNER_FILE_COUNT) {
    findings.push({ severity: 'medium', title: `${blobs.length} files, over the marketplace scanner's limit of ${SCANNER_FILE_COUNT}` });
  }
  for (const b of blobs) {
    if (b.size > SCANNER_FILE_LIMIT && b.path !== 'preview.png') {
      findings.push({ severity: 'medium', title: 'File over the marketplace scanner\'s 512 KiB limit', path: b.path });
    }
    if (BINARY_EXT.test(b.path)) {
      findings.push({ severity: 'medium', title: 'Compiled binary in the plugin, which reviewers cannot inspect', path: b.path });
    }
  }
  const agentFiles = blobs.filter((b) => classifyAgentPath(b.path));
  if (agentFiles.length) {
    findings.push({
      severity: 'medium',
      title: 'Agent instruction files are installed with the plugin, into a folder coding agents read automatically',
      samples: agentFiles.slice(0, 10).map((b) => ({ text: b.path })),
    });
  }
  if (!blobs.some((b) => /^preview\.(png|jpe?g|webp|avif)$/i.test(b.path))) {
    findings.push({ severity: 'info', title: 'No preview image at the root' });
  }
  if (readmeText !== null && !/omarchy plugin remove\b/.test(readmeText)) {
    findings.push({ severity: 'low', title: 'README does not explain removal with omarchy plugin remove' });
  }
  return findings;
}

export async function runOmarchy(ctx) {
  const manifestEntry = ctx.entries.find((e) => e.type === 'blob' && e.path === 'manifest.json');
  if (!manifestEntry) {
    return { status: 'not-applicable', notes: ['Not an Omarchy plugin: there is no manifest.json at the root.'], findings: [] };
  }
  const res = await ctx.fetchText('manifest.json');
  const manifest = res.text ? readManifest(res.text) : null;
  if (!manifest) {
    return { status: 'not-applicable', notes: ['manifest.json is not an Omarchy plugin manifest.'], findings: [] };
  }

  const facts = [
    ['Plugin id', String(manifest.id ?? 'missing')],
    ['Name', String(manifest.name ?? 'missing')],
    ['Version', String(manifest.version ?? 'missing')],
    ['Kinds', Array.isArray(manifest.kinds) ? manifest.kinds.join(', ') : 'missing'],
  ];

  const readmeEntry = ctx.entries.find((e) => e.type === 'blob' && /^readme(\.md)?$/i.test(e.path));
  const readme = readmeEntry ? (await ctx.fetchText(readmeEntry.path)).text ?? null : null;
  const findings = analyzePluginTree(ctx.entries, readme);

  const code = ctx.entries.filter((e) => e.type === 'blob' && CODE_EXT.test(e.path) && e.size <= 1_000_000).slice(0, 500);
  let unread = 0;
  const texts = await ctx.fetchMany(code.map((c) => c.path));
  for (const [path, r] of texts) {
    if (!r.text) { unread++; continue; }
    findings.push(...analyzePluginFile(path, r.text));
  }

  const notes = [
    'Omarchy plugin detected. These checks follow the marketplace review rules and are pattern matches, not a review.',
    `Read ${code.length - unread} of ${code.length} code files.`,
  ];
  return { status: unread || ctx.truncated ? 'partial' : 'ran', notes, findings, facts };
}
