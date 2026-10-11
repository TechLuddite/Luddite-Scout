// S1. How the repository is set up and how it takes security reports.
import { RateLimitError } from '../lib/github.js';

const POLICY = /^(\.github\/|docs\/)?security\.(md|markdown|txt|rst)$/i;

export function findSecurityPolicy(entries) {
  const found = entries.filter((e) => e.type === 'blob' && POLICY.test(e.path)).map((e) => e.path);
  const order = (p) => (p.startsWith('.github/') ? 0 : p.includes('/') ? 2 : 1);
  return found.sort((a, b) => order(a) - order(b));
}

function days(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export async function runSetup(ctx) {
  const m = ctx.meta;
  const findings = [];
  const notes = [];
  const facts = [];
  let partial = false;

  facts.push(['Description', m.description || 'None']);
  facts.push(['Default branch', `${m.default_branch} at ${ctx.sha.slice(0, 12)}`]);
  facts.push(['Licence', m.license?.spdx_id && m.license.spdx_id !== 'NOASSERTION' ? m.license.spdx_id : m.license ? 'Present, not recognised' : 'None detected']);
  facts.push(['Created', m.created_at?.slice(0, 10)]);
  facts.push(['Last push', `${m.pushed_at?.slice(0, 10)} (${days(m.pushed_at)} days ago)`]);
  facts.push(['Stars / forks', `${m.stargazers_count} / ${m.forks_count}`]);

  if (m.archived) findings.push({ severity: 'info', title: 'Archived. The owner no longer accepts changes.' });
  if (m.fork) findings.push({ severity: 'info', title: `Fork of ${m.parent?.full_name || 'another repository'}. Security reports may belong upstream.` });
  if (!m.license) findings.push({ severity: 'low', title: 'No licence detected. Reuse rights are unclear.' });
  if (days(m.pushed_at) > 365) findings.push({ severity: 'low', title: 'No pushes in over a year' });

  // Security policy: repo files first, then the owner's .github repository.
  const policies = findSecurityPolicy(ctx.entries);
  let policy = null;
  if (policies.length) {
    const res = await ctx.fetchText(policies[0]);
    policy = { path: policies[0], text: res.text || null, source: 'repo' };
    facts.push(['Security policy', policies.join(', ')]);
  } else {
    const res = await ctx.client.raw(ctx.owner, '.github', 'HEAD', 'SECURITY.md');
    if (res.text) {
      policy = { path: `${ctx.owner}/.github/SECURITY.md`, text: res.text, source: 'owner' };
      facts.push(['Security policy', `Inherited from ${ctx.owner}/.github`]);
    } else {
      facts.push(['Security policy', 'None found']);
      findings.push({ severity: 'medium', title: 'No security policy (SECURITY.md) in the repository or the owner\'s .github repository' });
    }
  }

  try {
    const pvr = await ctx.client.api(`/repos/${ctx.owner}/${ctx.repo}/private-vulnerability-reporting`);
    if (pvr === null) {
      facts.push(['Private vulnerability reporting', 'Unknown']);
      partial = true;
      notes.push('GitHub did not return the private vulnerability reporting status.');
    } else {
      facts.push(['Private vulnerability reporting', pvr.enabled ? 'Enabled' : 'Disabled']);
      if (!pvr.enabled) {
        findings.push({ severity: policy ? 'low' : 'medium', title: 'GitHub private vulnerability reporting is off. Check the security policy for another private route.' });
      }
    }
  } catch (e) {
    if (!(e instanceof RateLimitError)) throw e;
    facts.push(['Private vulnerability reporting', 'Not checked (rate limit)']);
    partial = true;
    notes.push(e.message);
  }

  const prPolicy = m.pull_request_creation_policy;
  facts.push(['Pull requests', m.has_pull_requests === false ? 'Disabled' : prPolicy ? `Open to: ${prPolicy}` : 'Enabled']);

  try {
    const pulls = await ctx.client.api(`/repos/${ctx.owner}/${ctx.repo}/pulls?state=open&per_page=100&sort=created&direction=asc`);
    if (Array.isArray(pulls)) {
      const count = pulls.length === 100 ? '100 or more' : String(pulls.length);
      const oldest = pulls[0] ? `, oldest opened ${days(pulls[0].created_at)} days ago` : '';
      facts.push(['Open pull requests', count + oldest]);
    }
  } catch (e) {
    if (!(e instanceof RateLimitError)) throw e;
    facts.push(['Open pull requests', 'Not checked (rate limit)']);
    partial = true;
  }

  return { status: partial ? 'partial' : 'ran', notes, findings, facts, policy };
}
