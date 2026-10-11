// S2. Files that an AI agent, editor or dev container reads as instructions or
// executes on open. Contents are shown as text for a human to judge.
import { parseJsonc, truncate } from '../lib/text.js';

const KINDS = [
  [/(^|\/)CLAUDE(\.local)?\.md$/i, 'Claude Code instructions', 'markdown'],
  [/(^|\/)AGENTS\.md$/i, 'Agent instructions (AGENTS.md)', 'markdown'],
  [/(^|\/)GEMINI\.md$/i, 'Gemini CLI instructions', 'markdown'],
  [/(^|\/)\.github\/copilot-instructions\.md$/, 'Copilot instructions', 'markdown'],
  [/(^|\/)\.github\/instructions\/.+\.md$/, 'Copilot instructions', 'markdown'],
  [/(^|\/)\.cursorrules$/, 'Cursor rules', 'markdown'],
  [/(^|\/)\.cursor\/rules\//, 'Cursor rules', 'markdown'],
  [/(^|\/)\.windsurfrules$/, 'Windsurf rules', 'markdown'],
  [/(^|\/)\.clinerules(\/|$)/, 'Cline rules', 'markdown'],
  [/(^|\/)\.claude\/settings(\.local)?\.json$/, 'Claude Code project settings', 'claude-settings'],
  [/(^|\/)\.claude\/(agents|commands|skills|output-styles|rules)\//, 'Claude Code agents, commands, skills or rules', 'markdown'],
  [/(^|\/)\.claude\//, 'Claude Code project files', 'other'],
  [/(^|\/)\.agents\//, 'Agent skills and files shared between tools', 'markdown'],
  [/(^|\/)\.gemini\/settings\.json$/, 'Gemini CLI project settings', 'gemini-settings'],
  [/(^|\/)\.gemini\//, 'Gemini CLI project files', 'other'],
  [/(^|\/)\.mcp\.json$/, 'MCP server config', 'mcp'],
  [/(^|\/)\.cursor\/mcp\.json$/, 'Cursor MCP server config', 'mcp'],
  [/(^|\/)\.vscode\/mcp\.json$/, 'VS Code MCP server config', 'mcp'],
  [/(^|\/)\.vscode\/tasks\.json$/, 'VS Code tasks', 'vscode-tasks'],
  [/(^|\/)\.vscode\/settings\.json$/, 'VS Code workspace settings', 'vscode-settings'],
  [/(^|\/)\.devcontainer(\.json$|\/.*devcontainer\.json$)/, 'Dev container config', 'devcontainer'],
];

export function classifyAgentPath(path) {
  for (const [re, label, kind] of KINDS) if (re.test(path)) return { label, kind };
  return null;
}

const SUSPICIOUS = [
  [/ignore (all |any )?(of )?(the )?(previous|prior|above|earlier) (instructions|rules)/i, 'Tries to override earlier instructions'],
  [/do not (tell|inform|mention|show|reveal)[^.\n]{0,40}(user|human|reviewer)/i, 'Asks the agent to hide something from the user'],
  [/(curl|wget)[^\n|]{0,200}\|\s*(ba|z)?sh\b/i, 'Pipes a download into a shell'],
  [/base64\s+(-d|--decode)/i, 'Decodes base64, a common way to hide a payload'],
  [/(exfiltrat|send (it|them|the [^.\n]{0,30}) to https?:)/i, 'Mentions sending data out'],
  [/(\.ssh\/|id_rsa|id_ed25519|\.aws\/credentials|\.netrc|\.npmrc|GITHUB_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY)/, 'Mentions credentials or key files'],
  [/(--dangerously-skip-permissions|bypassPermissions|--yolo\b|auto-?approve)/i, 'Mentions disabling agent permission checks'],
];

function suspiciousLines(text) {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => {
    for (const [re, why] of SUSPICIOUS) {
      if (re.test(l)) out.push({ line: i + 1, why, text: truncate(l.trim(), 200) });
    }
  });
  return out;
}

export function hasSuspicious(text) {
  return suspiciousLines(text).length > 0;
}

// A path an agent file refers to, resolved from the file's own folder.
// Returns { outside: true } for home, absolute or climbing paths.
export function resolveRef(fromPath, target) {
  if (/^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(target)) return { outside: true };
  const parts = fromPath.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (!parts.length) return { outside: true };
      parts.pop();
    } else parts.push(p);
  }
  return { path: parts.join('/') };
}

const IMPORT = /(?:^|\s)@((?:\\ |[^\s`'"()<>[\],;])+)/g;
const LINK = /\]\(\s*<?([^)\s>]+)/g;
const MENTION = /(?:^|[\s(`"'])((?:\.{1,2}\/)?[\w.\/-]*\w\.(?:md|mdc|txt))(?![\w\/])/gi;
const URL_RE = /https?:\/\/[^\s)>\]"'`]+/g;
const URL_CONTEXT = /(instruction|rules|guideline|prompt|fetch|follow|load|read)/i;

// What a markdown instruction file points an agent at. Imports follow the
// Claude Code and Gemini CLI rule: code spans and fenced blocks are skipped.
export function agentRefs(text) {
  const out = { imports: [], remote: [], links: [], urls: [], comments: [] };
  let fence = null;
  let inComment = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const fm = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
      return;
    }
    if (fm) { fence = fm[1]; return; }
    if (inComment) {
      if (raw.includes('-->')) inComment = false;
    } else if (raw.includes('<!--')) {
      out.comments.push({ line, text: truncate(raw.trim(), 200) });
      inComment = !raw.slice(raw.lastIndexOf('<!--')).includes('-->');
    }
    const plain = raw.replace(/`[^`]*`/g, ' ');
    for (const m of plain.matchAll(IMPORT)) {
      const target = m[1].replace(/\\ /g, ' ').replace(/[.:!?]+$/, '');
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) out.remote.push({ line, text: truncate(`@${target}`, 200) });
      else if (target) out.imports.push({ line, target });
    }
    for (const m of raw.matchAll(LINK)) {
      const target = m[1].replace(/[#?].*$/, '');
      if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) out.links.push({ line, target });
    }
    for (const m of raw.matchAll(MENTION)) out.links.push({ line, target: m[1] });
    if (URL_CONTEXT.test(raw)) for (const m of raw.matchAll(URL_RE)) out.urls.push({ line, text: truncate(m[0], 200) });
  });
  return out;
}

function isOutsidePath(p) {
  return resolveRef('x', String(p)).outside === true;
}

function refFindings(text, followedByMention = false) {
  const refs = agentRefs(text);
  const out = [];
  if (refs.remote.length) {
    out.push({
      severity: 'medium',
      title: 'Imports instructions from a web address, which can change after this review',
      samples: refs.remote.slice(0, 10),
    });
  }
  if (followedByMention) return out;
  const outside = refs.imports.filter((r) => resolveRef('x', r.target).outside);
  if (outside.length) {
    out.push({
      severity: 'high',
      title: 'Imports a file from outside the repository, such as your home folder',
      samples: outside.slice(0, 10).map((r) => ({ line: r.line, text: truncate(`@${r.target}`, 200) })),
    });
  }
  if (refs.urls.length) {
    out.push({
      severity: 'low',
      title: 'Points the agent to instructions on the web, which can change after this review',
      samples: refs.urls.slice(0, 10),
    });
  }
  if (refs.comments.length) {
    const n = refs.comments.length;
    out.push({
      severity: 'low',
      title: `Has ${n} HTML comment${n > 1 ? 's' : ''}, which GitHub hides when it shows the file. Some agents still read HTML comments.`,
      samples: refs.comments.slice(0, 10),
    });
  }
  return out;
}

function mcpFindings(servers) {
  const out = [];
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg?.command) {
      out.push({
        severity: 'high',
        title: `MCP server "${truncate(name, 60)}" launches a local program`,
        detail: truncate(`${cfg.command} ${commandText(cfg.args || [])}`, 240),
      });
    } else if (cfg?.url || cfg?.httpUrl) {
      out.push({ severity: 'medium', title: `MCP server "${truncate(name, 60)}" connects to a remote URL`, detail: truncate(String(cfg.url || cfg.httpUrl), 200) });
    }
  }
  return out;
}

const REDIRECT_ENV = /(_BASE_URL|_API_URL|_ENDPOINT|_PROXY|^NODE_OPTIONS|^NODE_TLS_REJECT_UNAUTHORIZED)$/i;

function directoryFindings(dirs, tool) {
  const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d) => typeof d === 'string');
  const outside = list.filter(isOutsidePath);
  if (!list.length) return [];
  return [{
    severity: outside.length ? 'high' : 'low',
    title: outside.length
      ? `Gives ${tool} access to ${outside.length} folder${outside.length > 1 ? 's' : ''} outside the repository`
      : `Adds ${list.length} folder${list.length > 1 ? 's' : ''} to what ${tool} reads`,
    samples: (outside.length ? outside : list).slice(0, 10).map((d) => ({ text: truncate(d, 200) })),
  }];
}

function commandText(v) {
  if (Array.isArray(v)) return v.join(' ');
  if (v && typeof v === 'object') return Object.values(v).map(commandText).join(' ; ');
  return String(v);
}

function collectHookCommands(hooks) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.command === 'string') out.push(v.command);
      Object.values(v).forEach(walk);
    }
  };
  walk(hooks);
  return out;
}

// Gemini CLI lets a project rename its instruction file. Older versions used
// contextFileName at the top level.
export function contextFileNames(data) {
  const v = data?.context?.fileName ?? data?.contextFileName;
  return (Array.isArray(v) ? v : [v]).filter((n) => typeof n === 'string' && /^[\w.-]{1,100}$/.test(n));
}

export function analyzeAgentFile(path, text) {
  const info = classifyAgentPath(path);
  if (!info) return [];
  const findings = [];
  let data = null;
  if (path.endsWith('.json')) {
    try { data = parseJsonc(text); } catch { /* shown as text below */ }
  }

  switch (info.kind) {
    case 'markdown':
      findings.push({ severity: 'info', title: `${info.label}: an agent reads this as guidance` });
      findings.push(...refFindings(text));
      break;
    case 'other':
      findings.push({ severity: 'info', title: `${info.label}: an agent reads this as guidance` });
      break;
    case 'claude-settings':
      if (data?.hooks) {
        const cmds = collectHookCommands(data.hooks);
        findings.push({
          severity: 'high',
          title: 'Defines Claude Code hooks, which run shell commands automatically',
          samples: cmds.slice(0, 10).map((c) => ({ text: truncate(c, 200) })),
        });
      }
      if (data?.enableAllProjectMcpServers === true) {
        findings.push({ severity: 'high', title: 'Turns on every MCP server in the project without asking' });
      }
      if (data?.apiKeyHelper) {
        findings.push({ severity: 'high', title: 'Sets apiKeyHelper, a command that runs to produce an API key', detail: truncate(String(data.apiKeyHelper), 200) });
      }
      if (data?.statusLine?.command) {
        findings.push({ severity: 'medium', title: 'Sets a status line command that runs repeatedly', detail: truncate(String(data.statusLine.command), 200) });
      }
      if (Array.isArray(data?.permissions?.allow) && data.permissions.allow.length) {
        const bash = data.permissions.allow.filter((p) => /^Bash/.test(p));
        findings.push({
          severity: bash.length ? 'medium' : 'low',
          title: `Pre-approves ${data.permissions.allow.length} tool permission${data.permissions.allow.length > 1 ? 's' : ''}${bash.length ? `, ${bash.length} for shell commands` : ''}`,
          samples: data.permissions.allow.slice(0, 10).map((p) => ({ text: truncate(String(p), 200) })),
        });
      }
      if (data?.permissions?.additionalDirectories) {
        findings.push(...directoryFindings(data.permissions.additionalDirectories, 'Claude Code'));
      }
      if (data?.env && typeof data.env === 'object') {
        const keys = Object.keys(data.env).filter((k) => REDIRECT_ENV.test(k));
        if (keys.length) {
          findings.push({
            severity: 'high',
            title: 'Sets environment variables that change where Claude Code sends requests or how it runs',
            samples: keys.slice(0, 10).map((k) => ({ text: truncate(`${k}=${commandText(data.env[k])}`, 200) })),
          });
        }
      }
      if (data?.permissions?.defaultMode && data.permissions.defaultMode !== 'default') {
        findings.push({ severity: 'high', title: `Sets the default permission mode to ${truncate(String(data.permissions.defaultMode), 40)}` });
      }
      if (!data) findings.push({ severity: 'medium', title: 'Claude Code settings file that could not be parsed. Review it by hand.' });
      break;
    case 'mcp': {
      const servers = data?.mcpServers || data?.servers || {};
      findings.push(...mcpFindings(servers));
      if (!data) findings.push({ severity: 'medium', title: 'MCP config that could not be parsed. Review it by hand.' });
      else if (!Object.keys(servers).length) findings.push({ severity: 'info', title: 'MCP config with no servers listed' });
      break;
    }
    case 'gemini-settings': {
      const names = contextFileNames(data);
      if (names.length) {
        findings.push({
          severity: 'low',
          title: `Tells Gemini CLI to read ${names.join(', ')} as its instructions`,
        });
      }
      const dirs = data?.context?.includeDirectories ?? data?.includeDirectories;
      if (dirs) findings.push(...directoryFindings(dirs, 'Gemini CLI'));
      findings.push(...mcpFindings(data?.mcpServers || {}));
      if (!data) findings.push({ severity: 'medium', title: 'Gemini CLI settings file that could not be parsed. Review it by hand.' });
      break;
    }
    case 'vscode-tasks': {
      const tasks = data?.tasks || [];
      const onOpen = tasks.filter((t) => t?.runOptions?.runOn === 'folderOpen');
      for (const t of onOpen) {
        findings.push({
          severity: 'high',
          title: 'VS Code task runs automatically when the folder is opened',
          detail: truncate(`${t.label || ''}: ${commandText(t.command || '')} ${commandText(t.args || [])}`, 240),
        });
      }
      if (!onOpen.length) findings.push({ severity: 'info', title: `${tasks.length} VS Code task${tasks.length === 1 ? '' : 's'} defined, none run on open` });
      break;
    }
    case 'vscode-settings': {
      const keys = data ? Object.keys(data).filter((k) => /(path|executable|command|shell|interpreter)/i.test(k)) : [];
      if (keys.length) {
        findings.push({
          severity: 'medium',
          title: 'Workspace settings point tools at programs or paths',
          samples: keys.slice(0, 10).map((k) => ({ text: truncate(`${k}: ${commandText(data[k])}`, 200) })),
        });
      }
      break;
    }
    case 'devcontainer': {
      if (data?.initializeCommand) {
        findings.push({ severity: 'high', title: 'initializeCommand runs on your machine, outside the container', detail: truncate(commandText(data.initializeCommand), 240) });
      }
      for (const key of ['onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand', 'postAttachCommand']) {
        if (data?.[key]) {
          findings.push({ severity: 'medium', title: `${key} runs inside the container`, detail: truncate(commandText(data[key]), 240) });
        }
      }
      break;
    }
  }

  for (const s of suspiciousLines(text)) {
    findings.push({ severity: 'medium', title: s.why, line: s.line, snippet: s.text });
  }
  return findings;
}

const TEXT_REF = /\.(md|mdc|txt)$/i;
const MAX_FOLLOW = 50;
const MAX_IMPORT_DEPTH = 4;

function isSymlink(e) {
  return e?.mode === '120000';
}

// Files an agent is sent to by one instruction file: its imports and the
// instruction files it links or mentions, or the target of a symbolic link.
export function followTargets(byPath, path, text, isLink) {
  const out = [];
  const add = (p, via) => {
    const e = byPath.get(p);
    if (e?.type === 'blob') out.push({ path: p, via });
    else if (e?.type === 'tree') {
      for (const [q, f] of byPath) if (f.type === 'blob' && q.startsWith(`${p}/`) && out.length < MAX_FOLLOW) out.push({ path: q, via });
    }
  };
  if (isLink) {
    const r = resolveRef(path, text.trim());
    if (r.path) add(r.path, 'link');
    return out;
  }
  const refs = agentRefs(text);
  for (const r of refs.imports) {
    const t = resolveRef(path, r.target);
    if (t.path) add(t.path, 'import');
  }
  for (const r of refs.links) {
    if (!TEXT_REF.test(r.target)) continue;
    const near = resolveRef(path, r.target);
    const root = resolveRef('x', r.target);
    if (near.path && byPath.has(near.path)) add(near.path, 'mention');
    else if (root.path) add(root.path, 'mention');
  }
  return out;
}

function baseName(p) {
  return p.slice(p.lastIndexOf('/') + 1);
}

function pairDir(p) {
  const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  if (d === '.claude') return '';
  return d.endsWith('/.claude') ? d.slice(0, -8) : d;
}

function lineSet(text) {
  return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
}

function onlyIn(a, b) {
  let n = 0;
  for (const l of a) if (!b.has(l)) n++;
  return n;
}

function refersTo(byPath, from, text, to) {
  return followTargets(byPath, from, text, false).some((t) => t.path === to);
}

// Checks across instruction files: symbolic links, imports of files that are
// missing, and CLAUDE.md, AGENTS.md and GEMINI.md in one folder that differ.
// texts maps each file read to its text, and links maps each symbolic link to
// its target.
export function crossCheckAgents(entries, texts, links, extraNames = []) {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const findings = [];

  for (const [path, target] of links) {
    const r = resolveRef(path, target);
    const e = r.path ? byPath.get(r.path) : null;
    if (r.outside) {
      findings.push({ severity: 'high', title: `Is a link to ${truncate(target, 200)}, outside the repository`, path });
    } else if (e) {
      findings.push({ severity: 'info', title: `Is a link to ${e.type === 'tree' ? 'the folder ' : ''}${r.path}`, path });
    } else {
      findings.push({ severity: 'low', title: `Is a link to ${truncate(r.path, 200)}, which is not in the repository`, path });
    }
  }

  for (const [path, text] of texts) {
    if (links.has(path)) continue;
    const missing = agentRefs(text).imports
      .map((r) => ({ ...r, to: resolveRef(path, r.target) }))
      .filter((r) => r.to.path && !byPath.has(r.to.path) && /\.\w{1,8}$/.test(r.to.path));
    if (missing.length) {
      findings.push({
        severity: 'low',
        title: missing.length > 1
          ? `Imports ${missing.length} files that are not in the repository, so something else must create them`
          : 'Imports a file that is not in the repository, so something else must create it',
        path,
        samples: missing.slice(0, 10).map((r) => ({ line: r.line, text: truncate(`@${r.target}`, 200) })),
      });
    }
  }

  const names = new Set(['claude.md', 'agents.md', 'gemini.md', ...extraNames.map((n) => n.toLowerCase())]);
  const groups = new Map();
  for (const path of texts.keys()) {
    if (!names.has(baseName(path).toLowerCase())) continue;
    const d = pairDir(path);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(path);
  }
  const effective = (p) => {
    if (!links.has(p)) return { path: p, text: texts.get(p) };
    const r = resolveRef(p, links.get(p));
    return r.path && texts.has(r.path) ? { path: r.path, text: texts.get(r.path) } : null;
  };
  for (const group of groups.values()) {
    group.sort();
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        const ea = effective(a);
        const eb = effective(b);
        if (!ea || !eb || ea.path === eb.path) continue;
        const la = lineSet(ea.text);
        const lb = lineSet(eb.text);
        const aOnly = onlyIn(la, lb);
        const bOnly = onlyIn(lb, la);
        const sa = hasSuspicious(ea.text);
        const sb = hasSuspicious(eb.text);
        if (sa !== sb) {
          const [flagged, clean] = sa ? [a, b] : [b, a];
          findings.push({
            severity: 'medium',
            title: `Only ${flagged} has lines flagged by this check, so an agent that reads ${clean} instead is given different instructions`,
            path: flagged,
          });
        }
        const ab = refersTo(byPath, ea.path, ea.text, eb.path);
        const ba = refersTo(byPath, eb.path, eb.text, ea.path);
        // When each names the other, the shorter one is the pointer.
        const aFirst = ab && (!ba || la.size <= lb.size);
        if (!aOnly && !bOnly) {
          findings.push({ severity: 'info', title: `${a} and ${b} give the same instructions`, path: a });
        } else if (ab || ba) {
          const [from, to, lf, lt] = aFirst ? [a, b, la, lb] : [b, a, lb, la];
          const toName = baseName(aFirst ? eb.path : ea.path);
          const own = [...lf].filter((l) => !lt.has(l) && !l.includes(toName)).length;
          findings.push({
            severity: 'info',
            title: `${from} points to ${to}${own > 1 ? `, and adds ${own} lines of its own` : ''}`,
            path: from,
          });
        } else {
          findings.push({
            severity: 'low',
            title: `${a} and ${b} differ, and neither points to the other. Different agents read different files, so review both.`,
            path: a,
            detail: `${aOnly} line${aOnly === 1 ? '' : 's'} only in ${a}, ${bOnly} only in ${b}.`,
          });
        }
      }
    }
  }
  return findings;
}

export async function runAgents(ctx) {
  const byPath = new Map(ctx.entries.map((e) => [e.path, e]));
  const files = ctx.entries.filter((e) => e.type === 'blob' && classifyAgentPath(e.path));
  if (!files.length) {
    return {
      status: ctx.truncated ? 'partial' : 'ran',
      notes: ['No agent instruction, editor task or dev container files found.'],
      findings: [],
    };
  }
  const findings = [];
  const contents = [];
  const texts = new Map();
  const links = new Map();
  const extraNames = [];
  let queue = [];
  let unread = 0;
  const read = await ctx.fetchMany(files.slice(0, 200).map((f) => f.path));
  for (const [path, res] of read) {
    const { label, kind } = classifyAgentPath(path);
    if (!res.text) {
      unread++;
      findings.push({ severity: 'medium', title: `${label}: could not be read (${res.skipped}). Review it by hand.`, path });
      continue;
    }
    if (isSymlink(byPath.get(path))) {
      links.set(path, res.text.trim());
      queue.push(...followTargets(byPath, path, res.text, true).map((t) => ({ ...t, from: path, depth: 1 })));
      continue;
    }
    texts.set(path, res.text);
    for (const f of analyzeAgentFile(path, res.text)) findings.push({ ...f, path });
    contents.push({ path, label, text: res.text });
    if (kind === 'markdown') {
      queue.push(...followTargets(byPath, path, res.text, false).map((t) => ({ ...t, from: path, depth: 1 })));
    }
    if (kind === 'gemini-settings') {
      try { extraNames.push(...contextFileNames(parseJsonc(res.text))); } catch { /* reported above */ }
    }
  }

  // Files the instruction files send an agent to are instructions as well.
  const followed = new Set();
  let capped = false;
  while (queue.length) {
    const batch = [];
    for (const q of queue) {
      if (texts.has(q.path) || links.has(q.path) || followed.has(q.path) || classifyAgentPath(q.path)) continue;
      if (followed.size >= MAX_FOLLOW) { capped = true; break; }
      followed.add(q.path);
      batch.push(q);
    }
    queue = [];
    const got = new Map(await ctx.fetchMany(batch.map((q) => q.path)));
    for (const q of batch) {
      const res = got.get(q.path);
      const how = { import: 'an import', link: 'a symbolic link', mention: 'a mention' }[q.via];
      if (!res?.text) {
        unread++;
        findings.push({ severity: 'medium', title: `Read by agents through ${how} in ${q.from}, but could not be read (${res?.skipped}). Review it by hand.`, path: q.path });
        continue;
      }
      if (isSymlink(byPath.get(q.path))) {
        links.set(q.path, res.text.trim());
        queue.push(...followTargets(byPath, q.path, res.text, true).map((t) => ({ ...t, from: q.path, depth: q.depth + 1 })));
        continue;
      }
      texts.set(q.path, res.text);
      findings.push({ severity: 'info', title: `Read by agents through ${how} in ${q.from}`, path: q.path });
      for (const s of suspiciousLines(res.text)) findings.push({ severity: 'medium', title: s.why, line: s.line, snippet: s.text, path: q.path });
      for (const f of refFindings(res.text, q.via === 'mention')) findings.push({ ...f, path: q.path });
      contents.push({ path: q.path, label: `read through ${how} in ${q.from}`, text: res.text });
      if (q.via !== 'mention' && q.depth < MAX_IMPORT_DEPTH) {
        queue.push(...followTargets(byPath, q.path, res.text, false)
          .filter((t) => t.via === 'import')
          .map((t) => ({ ...t, from: q.path, depth: q.depth + 1 })));
      }
    }
  }

  for (const f of crossCheckAgents(ctx.entries, texts, links, extraNames)) findings.push(f);

  const notes = [`Found ${files.length} file${files.length > 1 ? 's' : ''}.`];
  if (followed.size) notes.push(`Followed ${followed.size} more file${followed.size > 1 ? 's' : ''} that instruction files import, link or mention.`);
  if (capped) notes.push(`Stopped following references after ${MAX_FOLLOW} files.`);
  if (files.length > 200) notes.push('Only the first 200 were read.');
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some files may be missing.');
  return {
    status: unread || capped || files.length > 200 || ctx.truncated ? 'partial' : 'ran',
    notes,
    findings,
    contents,
  };
}
