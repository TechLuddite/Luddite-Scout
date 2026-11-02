// S4. Line-based checks over GitHub, Gitea and Forgejo workflow files and
// composite action.yml files. This is not a YAML
// parser. It looks for the patterns behind most real Actions compromises.

const UNTRUSTED = /(?:github|gitea|forgejo|forge)\.event\.(issue\.(title|body)|pull_request\.(title|body|head\.(ref|label|repo\.default_branch))|comment\.body|review\.body|review_comment\.body|pages\.[^.\s}]*\.page_name|commits\.[^.\s}]*\.(message|author\.(email|name))|head_commit\.(message|author\.(email|name))|discussion\.(title|body)|workflow_run\.(head_branch|display_title|head_commit\.(message|author\.(email|name))))|(?:github|gitea|forgejo|forge)\.head_ref/;
const PR_HEAD_REF = /(?:github|gitea|forgejo|forge)\.event\.pull_request\.head\.(sha|ref)|(?:github|gitea|forgejo|forge)\.head_ref|refs\/pull\/|(?:github|gitea|forgejo|forge)\.event\.workflow_run\.head_(sha|branch)/;
const SHA = /^[0-9a-f]{40}$/;
const SKIP_DIRS = /(^|\/)(node_modules|vendor|third_party|\.git)\//;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Yields { line, text } for every line that is shell or script source:
// "run:" and github-script "script:" values, inline or block.
function* scriptLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(-\s+)?(run|script):\s*(.*)$/);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? m[2].length : 0);
    const rest = m[4];
    if (/^[|>][+-]?\d*\s*(#.*)?$/.test(rest)) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        if (indentOf(lines[j]) <= keyIndent) break;
        yield { line: j + 1, text: lines[j] };
      }
    } else if (rest) {
      yield { line: i + 1, text: rest };
    }
  }
}

function scriptFindings(lines) {
  const findings = [];
  for (const { line, text: src } of scriptLines(lines)) {
    for (const m of src.matchAll(/\$\{\{([^}]*)\}\}/g)) {
      const expr = m[1].trim();
      if (UNTRUSTED.test(expr)) {
        findings.push({
          severity: 'high',
          title: 'Untrusted input expanded directly into a script',
          detail: `\${{ ${expr} }} is controlled by whoever opens the issue, pull request or comment, and is pasted into the script before it runs.`,
          line,
          snippet: src.trim(),
        });
      } else if (/(?:github|gitea|forgejo|forge)\.event\.|inputs\./.test(expr)) {
        findings.push({
          severity: 'low',
          title: 'Event or input value expanded directly into a script',
          detail: `\${{ ${expr} }}. Safer to pass it through an environment variable.`,
          line,
          snippet: src.trim(),
        });
      }
    }
  }
  return findings;
}

function unpinnedFindings(lines) {
  const findings = [];
  const unpinned = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(-\s+)?uses:\s*['"]?([^@\s'"]+)@([^\s'"#]+)/);
    if (!m) return;
    const [, , action, ref] = m;
    if (action.startsWith('./') || action.startsWith('docker://')) return;
    if (!SHA.test(ref)) unpinned.push({ line: i + 1, text: `${action}@${ref}` });
  });
  if (unpinned.length) {
    findings.push({
      severity: 'low',
      title: `${unpinned.length} action${unpinned.length > 1 ? 's' : ''} pinned to a tag or branch rather than a commit SHA`,
      detail: 'A tag can be moved to different code after you review it.',
      line: unpinned[0].line,
      samples: unpinned.slice(0, 10),
    });
  }
  return findings;
}

// kind is 'workflow' or 'action' (a composite action.yml). An action has no
// triggers, permissions or runner of its own, so only the script and pinning
// checks apply to it.
export function analyzeWorkflow(text, kind = 'workflow') {
  const lines = text.split(/\r?\n/);
  if (kind === 'action') return [...scriptFindings(lines), ...unpinnedFindings(lines)];
  const findings = [];
  const privileged = /^\s*-?\s*['"]?(pull_request_target|workflow_run)['"]?\s*:?/m.test(text) ||
    /\bon:\s*\[?[^\n]*\b(pull_request_target|workflow_run)\b/.test(text);
  const prTarget = /\bpull_request_target\b/.test(text);
  const onPullRequest = /\bpull_request(_target)?\b/.test(text);

  if (prTarget) {
    findings.push({
      severity: 'info',
      title: 'Uses pull_request_target, which runs with repository secrets on pull requests from forks',
      line: lines.findIndex((l) => /pull_request_target/.test(l)) + 1,
    });
  }

  lines.forEach((l, i) => {
    if (/^\s*ref:/.test(l) && PR_HEAD_REF.test(l) && privileged) {
      findings.push({
        severity: 'high',
        title: 'Privileged workflow checks out pull request code',
        detail: 'A pull_request_target or workflow_run job that checks out the contributor\'s code can let that code run with secrets.',
        line: i + 1,
        snippet: l.trim(),
      });
    }
  });

  findings.push(...scriptFindings(lines), ...unpinnedFindings(lines));

  const perm = lines.findIndex((l) => /^\s*permissions:\s*write-all\b/.test(l));
  if (perm !== -1) {
    findings.push({ severity: 'medium', title: 'Grants write-all permissions to the workflow token', line: perm + 1 });
  } else if (!lines.some((l) => /^permissions:/.test(l))) {
    findings.push({
      severity: 'info',
      title: 'No top-level permissions block, so jobs get the repository default token permissions',
    });
  }

  const selfHosted = lines.findIndex((l) => /runs-on:.*self-hosted/.test(l));
  if (selfHosted !== -1 && onPullRequest) {
    findings.push({
      severity: 'medium',
      title: 'Self-hosted runner used by a workflow that pull requests can trigger',
      line: selfHosted + 1,
    });
  }

  const inherit = lines.findIndex((l) => /^\s*secrets:\s*inherit\b/.test(l));
  if (inherit !== -1) {
    findings.push({ severity: 'info', title: 'Passes all secrets to a reusable workflow (secrets: inherit)', line: inherit + 1 });
  }

  return findings;
}

// 'workflow' for a GitHub, Gitea or Forgejo workflow file, 'action' for a
// composite action.yml, or null.
export function classifyWorkflowPath(path) {
  if (/^\.(github|gitea|forgejo)\/workflows\/[^/]+\.ya?ml$/i.test(path)) return 'workflow';
  if (/(^|\/)action\.ya?ml$/i.test(path) && !SKIP_DIRS.test(path)) return 'action';
  return null;
}

export async function runWorkflows(ctx) {
  const files = ctx.entries.filter((e) => e.type === 'blob' && classifyWorkflowPath(e.path));
  if (!files.length) {
    return { status: ctx.truncated ? 'partial' : 'ran', notes: ['No workflow files (.github, .gitea or .forgejo) and no action.yml files.'], findings: [] };
  }
  const findings = [];
  let unread = 0;
  const texts = await ctx.fetchMany(files.map((f) => f.path));
  for (const [path, res] of texts) {
    if (!res.text) { unread++; continue; }
    for (const f of analyzeWorkflow(res.text, classifyWorkflowPath(path))) findings.push({ ...f, path });
  }
  const notes = [`Read ${files.length - unread} of ${files.length} workflow and action files.`];
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some workflows may be missing.');
  return { status: unread || ctx.truncated ? 'partial' : 'ran', notes, findings };
}
