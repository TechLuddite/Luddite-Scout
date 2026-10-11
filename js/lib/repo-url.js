// Accepts "owner/repo", "github.com/owner/repo" or a full GitHub URL,
// with or without a trailing ".git" or extra path segments.
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function parseRepoInput(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter a repository URL or owner/repo.');

  s = s.replace(/^git@github\.com:/i, 'https://github.com/');
  if (/^github\.com\//i.test(s)) s = 'https://' + s;

  let parts;
  if (/^https?:\/\//i.test(s)) {
    let url;
    try { url = new URL(s); } catch { throw new Error('That does not look like a valid URL.'); }
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) {
      throw new Error('Only github.com repositories are supported.');
    }
    parts = url.pathname.split('/').filter(Boolean);
  } else {
    parts = s.split('/').filter(Boolean);
  }

  if (parts.length < 2) throw new Error('Expected owner/repo.');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!NAME.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    throw new Error('That owner or repository name is not valid on GitHub.');
  }
  return { owner, repo };
}
