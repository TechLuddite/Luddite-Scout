// S8: text and files aimed at a coding agent to make it stop, to send it
// the wrong way, or to stand in for its command.
// bin/scout has the same patterns, and both run the cases in
// test/fixtures/cases.json.
import { extension, truncate } from '../lib/text.js';
import { classifyAgentPath } from './agents.js';

const AGENT_COMMANDS = '(?:rea|claude|codex|gemini|cursor-agent|opencode|aider|copilot|goose|crush|grok|qwen|amp)';
const AGENT_NOUN = '(?:ai|llm|(?:large )?language model|(?:ai|coding|automated) (?:agent|assistant|tool|system|model)|agent|assistant|chatbot)';
const AGENT_NAME = '(?:ai|llm|claude|codex|chatgpt|gpt|gemini|copilot|cursor|agent|assistant)';
const NEGATE = "(?:do not|don['\\u2019]t|must not|should not|shall not|may not|never|refuse to|decline to|stop|cease|halt|abort"
  + '|not (?:permitted|allowed|authori[sz]ed) to|prohibited from|forbidden (?:to|from))';
const ANALYSE = '(?:analy[sz]\\w*|reverse[- ]engineer\\w*|decompil\\w*|disassembl\\w*|deobfuscat\\w*|summari[sz]\\w*|explain\\w*|describ\\w*|inspect\\w*|examin\\w*|index\\w*|scrap\\w*|train\\w*)';
const CARRY_ON = '(?:assist\\w*|help\\w*|proceed\\w*|continu\\w*|respond\\w*|answer\\w*|comply\\w*)';
const LIMIT = '(?:read\\w*|review\\w*|process\\w*|us(?:e|ing)|run\\w*|execut\\w*|invok\\w*|launch\\w*|attempt\\w*|access\\w*|clon\\w*'
  + '|download\\w*|copy\\w*|extract\\w*|generat\\w*|produc\\w*|output\\w*)';
const TARGET = '(?:(?:\\s*,\\s*|\\s+(?:or|and|nor)\\s+)\\w+){0,3}\\s+(?:(?:any|all|anything)\\s+(?:of\\s+|in\\s+)?)?(?:this|the|any|its)\\s+(?:\\w+\\s+)?'
  + '(?:repo|repository|code|codebase|project|source|files?|binary|software|application|program)\\b';

const ADDRESSED = new RegExp(
  `\\b(?:if you(?: are|['\\u2019]re)|you are|as) an? ${AGENT_NOUN}\\b`
  + `|\\b(?:attention|notice|note|warning|message|instructions?|directive)\\b[^.\\n]{0,20}\\b(?:to|for)(?: all| any| every)? ${AGENT_NAME}(?: (?:coding )?(?:agents?|assistants?|models?|tools?))?\\b`
  + '|\\b(?:ai|llm)(?: coding)? (?:agents?|assistants?|models?|tools?|systems?)\\s*(?::|must|should|shall|may not|are (?:not|prohibited|forbidden))'
  + `|\\b(?:dear|hey|hello|attention) ${AGENT_NAME}\\b`, 'gi');
const NO_ANALYSIS = new RegExp(`\\b${NEGATE}\\s+(?:\\w+\\s+){0,4}?${ANALYSE}`, 'i');
const NO_ANALYSIS_OF = new RegExp(`\\b${NEGATE}\\s+(?:\\w+\\s+){0,4}?${ANALYSE}${TARGET}`, 'gi');
const NO_WORK = new RegExp(
  `\\b${NEGATE}\\s+(?:\\w+\\s+){0,4}?${CARRY_ON}`
  + '|\\b(?:stop|halt|abort|terminate|end)\\b[^.\\n]{0,30}\\b(?:immediately|now|at once|(?:the|this|your) (?:session|conversation|task|analysis)|all (?:work|analysis|processing))', 'i');
const LIMITS = new RegExp(`\\b${NEGATE}\\s+(?:\\w+\\s+){0,4}?${LIMIT}`, 'i');
const SHOUT = /\b(?:STOP|HALT|ABORT|REFUSE|DO NOT PROCEED|DO NOT CONTINUE)\b/;
const SHIM = new RegExp(
  `^[ \\t]*(?:function\\s+${AGENT_COMMANDS}\\b(?![-.\\w])|${AGENT_COMMANDS}\\s*\\(\\s*\\)|alias\\s+(?:-g\\s+)?${AGENT_COMMANDS}=`
  + `|Set-Alias\\s+(?:-Name\\s+)?${AGENT_COMMANDS}\\b(?![-.\\w])|doskey\\s+${AGENT_COMMANDS}=)`, 'gim');
const STARTUP = /(?:>>|\btee\s+-a\b|\bAdd-Content\b|\bOut-File\b[^\n]{0,40}-Append)[^\n]{0,80}(?:\.bashrc|\.zshrc|\.zshenv|\.bash_profile|\.profile\b|config\.fish|\$PROFILE)/gi;
const MISLEAD = new RegExp(
  '\\b(?:mislead\\w*|confus\\w*|poison\\w*|trap\\w*|derail\\w*|sabotag\\w*|deceiv\\w*|trick\\w*|blind\\w*|exhaust\\w*|wast\\w*|drain\\w*|flood\\w*|overwhelm\\w*|stall\\w*|bait\\w*)\\b[^.\\n]{0,60}\\b(?:ai|llm)s?\\b(?: (?:coding )?(?:agents?|assistants?|models?|tools?|analysis|scrapers?|crawlers?))?'
  + '|\\b(?:ai|llm)s?(?: (?:coding )?(?:agents?|assistants?|models?|tools?))?\\b[^.\\n]{0,40}\\b(?:rabbit holes?|context (?:window )?(?:exhaustion|flooding|poisoning|pollution)|token (?:burn\\w*|drain\\w*|wast\\w*))'
  + '|\\b(?:anti[- ]?(?:ai|llm|agent)\\b|(?:agent|llm|ai)[- ]traps?\\b|context[- ]poison\\w*)', 'gi');
const TOOL = /\banti[-_ ]?rea\b|\bblind\s+llm\s+agents\b/gi;
const NAME = /(?:^|[/._-])(?:decoys?|honeypots?|honeytokens?|canary[-_]?tokens?|rabbit[-_]?holes?|(?:agent|llm|ai)[-_]?traps?)(?:[/._-]|$)/i;
const SHIM_FILE = new RegExp(`(?:^|/)${AGENT_COMMANDS}(?:\\.(?:sh|bash|zsh|fish|bat|cmd|ps1|exe))?$`, 'i');
const SHELL_TEXT_EXT = new Set(['', 'sh', 'bash', 'zsh', 'fish', 'ksh', 'ps1', 'psm1', 'bat', 'cmd', 'md', 'mdc', 'txt', 'tmpl', 'template', 'envrc']);
const MAX_SAMPLES = 5;
const MISLEAD_MANY = 3;

const DECOY_NAME = { severity: 'low', title: 'Name suggests decoy or bait content' };

const lineStart = (text, i) => text.lastIndexOf('\n', i - 1) + 1;

function lineTextAt(text, i) {
  const end = text.indexOf('\n', i);
  return text.slice(lineStart(text, i), end === -1 ? text.length : end);
}

// The line before offset i, the line holding it and the n - 1 lines after.
function linesAround(text, i, n = 3, cap = 800) {
  let end = lineStart(text, i);
  const start = end ? lineStart(text, end - 1) : 0;
  for (let k = 0; k < n; k++) {
    const nl = text.indexOf('\n', end);
    if (nl === -1) { end = text.length; break; }
    end = nl + 1;
  }
  return text.slice(start, Math.min(end, start + cap));
}

function countLines(text, upTo) {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < upTo; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

// One hit for each line a pattern matches on, in file order.
function trapHits(rx, text) {
  const out = [];
  let last = -1;
  rx.lastIndex = 0;
  for (const m of text.matchAll(rx)) {
    const start = lineStart(text, m.index);
    if (start === last) continue;
    last = start;
    out.push({ line: countLines(text, start), text: truncate(lineTextAt(text, m.index).trim(), 200), at: m.index });
  }
  return out;
}

function trapFinding(severity, title, hits) {
  return { severity, title, line: hits[0].line, count: hits.length, samples: hits.slice(0, MAX_SAMPLES).map((h) => ({ line: h.line, text: h.text })) };
}

export function analyzeTrapPath(path) {
  const out = [];
  if (NAME.test(path)) out.push({ ...DECOY_NAME });
  if (SHIM_FILE.test(path)) out.push({ severity: 'low', title: 'File named after an agent command. It runs in place of that command if its folder is on PATH.' });
  return out;
}

export function analyzeTrapText(path, text) {
  const agentFile = Boolean(classifyAgentPath(path));
  const out = [];
  let noAnalysis = [];
  const noWork = [];
  const limits = [];
  const addressed = [];
  const seen = new Set();
  // An instruction file addresses an agent as a matter of course, so there
  // the refusal must name the repository or its code.
  const refusal = agentFile ? new RegExp(NO_ANALYSIS_OF.source, 'i') : NO_ANALYSIS;
  for (const h of trapHits(ADDRESSED, text)) {
    const window = linesAround(text, h.at);
    if (refusal.test(window)) noAnalysis.push(h);
    else if (NO_WORK.test(window) || SHOUT.test(window)) noWork.push(h);
    else if (LIMITS.test(window)) limits.push(h);
    else addressed.push(h);
    seen.add(h.line);
  }
  if (agentFile) {
    noAnalysis = noAnalysis.concat(trapHits(NO_ANALYSIS_OF, text).filter((h) => !seen.has(h.line))).sort((a, b) => a.line - b.line);
  }
  if (noAnalysis.length) out.push(trapFinding(agentFile ? 'high' : 'medium', 'Tells an AI agent not to analyse or explain the repository', noAnalysis));
  if (noWork.length) out.push(trapFinding(agentFile ? 'medium' : 'low', 'Tells an AI agent to stop or refuse work', noWork));
  if (limits.length) out.push(trapFinding('low', 'Tells an AI agent to stop or refuse work', limits));
  if (addressed.length && !agentFile) out.push(trapFinding('low', 'Addresses an AI agent from outside the instruction files', addressed));
  if (SHELL_TEXT_EXT.has(extension(path))) {
    const hits = trapHits(SHIM, text);
    if (hits.length) out.push(trapFinding('medium', 'Defines a shell function or alias named after an agent command', hits));
  }
  let hits = trapHits(STARTUP, text);
  if (hits.length) out.push(trapFinding('low', 'Appends to a shell startup file', hits));
  hits = trapHits(MISLEAD, text);
  if (hits.length) {
    const many = agentFile || hits.length >= MISLEAD_MANY;
    out.push(trapFinding(many ? 'medium' : 'low', 'Describes misleading, trapping or exhausting an AI agent', hits));
  }
  hits = trapHits(TOOL, text);
  if (hits.length) out.push(trapFinding('medium', 'Names a tool built to trap or mislead AI agents', hits));
  return out;
}

export function analyzeTrapFile(path, text) {
  return analyzeTrapPath(path).concat(analyzeTrapText(path, text));
}

const RANK = { info: 0, low: 1, medium: 2, high: 3 };

export async function runTraps(ctx, { maxFiles = 4000, maxBytes = 60_000_000 } = {}) {
  let findings = [];
  for (const e of ctx.entries) {
    if (e.type === 'blob') findings.push(...analyzeTrapPath(e.path).map((f) => ({ ...f, path: e.path })));
    else if (e.type === 'tree' && NAME.test(e.path)) findings.push({ ...DECOY_NAME, path: e.path });
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
    ctx.progress(`S8: reading files ${done} of ${selected.length}`);
  });
  for (const [path, res] of texts) {
    if (!res.text) { skipped++; continue; }
    scanned++;
    findings.push(...analyzeTrapText(path, res.text).map((f) => ({ ...f, path })));
  }
  findings = findings.map((f, i) => [f, i]).sort((a, b) => RANK[b[0].severity] - RANK[a[0].severity] || a[1] - b[1]).map(([f]) => f);

  const notes = [`Scanned ${scanned} text files and ${ctx.entries.length} names.`];
  if (skipped) notes.push(`${skipped} files could not be read as text (binary, too large, or not served).`);
  if (notCovered) notes.push(`${notCovered} files not read because of the size or count cap.`);
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some files were never listed.');
  return { status: notCovered || ctx.truncated ? 'partial' : 'ran', notes, findings };
}
