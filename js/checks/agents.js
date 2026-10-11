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
  [/(^|\/)\.claude\/(agents|commands|skills|output-styles)\//, 'Claude Code agents, commands or skills', 'markdown'],
  [/(^|\/)\.claude\//, 'Claude Code project files', 'other'],
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
      if (data?.permissions?.defaultMode && data.permissions.defaultMode !== 'default') {
        findings.push({ severity: 'high', title: `Sets the default permission mode to ${truncate(String(data.permissions.defaultMode), 40)}` });
      }
      if (!data) findings.push({ severity: 'medium', title: 'Claude Code settings file that could not be parsed. Review it by hand.' });
      break;
    case 'mcp': {
      const servers = data?.mcpServers || data?.servers || {};
      for (const [name, cfg] of Object.entries(servers)) {
        if (cfg?.command) {
          findings.push({
            severity: 'high',
            title: `MCP server "${truncate(name, 60)}" launches a local program`,
            detail: truncate(`${cfg.command} ${commandText(cfg.args || [])}`, 240),
          });
        } else if (cfg?.url) {
          findings.push({ severity: 'medium', title: `MCP server "${truncate(name, 60)}" connects to a remote URL`, detail: truncate(String(cfg.url), 200) });
        }
      }
      if (!data) findings.push({ severity: 'medium', title: 'MCP config that could not be parsed. Review it by hand.' });
      else if (!Object.keys(servers).length) findings.push({ severity: 'info', title: 'MCP config with no servers listed' });
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

export async function runAgents(ctx) {
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
  let unread = 0;
  const texts = await ctx.fetchMany(files.slice(0, 200).map((f) => f.path));
  for (const [path, res] of texts) {
    const { label } = classifyAgentPath(path);
    if (!res.text) {
      unread++;
      findings.push({ severity: 'medium', title: `${label}: could not be read (${res.skipped}). Review it by hand.`, path });
      continue;
    }
    for (const f of analyzeAgentFile(path, res.text)) findings.push({ ...f, path });
    contents.push({ path, label, text: res.text });
  }
  const notes = [`Found ${files.length} file${files.length > 1 ? 's' : ''}.`];
  if (files.length > 200) notes.push('Only the first 200 were read.');
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some files may be missing.');
  return {
    status: unread || files.length > 200 || ctx.truncated ? 'partial' : 'ran',
    notes,
    findings,
    contents,
  };
}
