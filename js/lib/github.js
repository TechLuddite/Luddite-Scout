import { looksBinary } from './text.js';

export class RateLimitError extends Error {
  constructor(reset) {
    const when = reset ? new Date(reset * 1000).toLocaleTimeString() : 'later';
    super(`GitHub API rate limit reached. It resets at ${when}. A token raises the limit.`);
    this.name = 'RateLimitError';
  }
}

export class GitHubClient {
  constructor({ token = null } = {}) {
    this.token = token;
    this.limit = null;
    this.remaining = null;
    this.reset = null;
    this.calls = 0;
    this.listeners = new Set();
  }

  onRateChange(fn) { this.listeners.add(fn); }

  #recordRate(res) {
    const limit = res.headers.get('x-ratelimit-limit');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (limit !== null) this.limit = Number(limit);
    if (remaining !== null) this.remaining = Number(remaining);
    if (reset !== null) this.reset = Number(reset);
    for (const fn of this.listeners) fn(this);
  }

  // Returns parsed JSON, or null for 404. Throws RateLimitError when exhausted.
  async api(path) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`https://api.github.com${path}`, { headers, credentials: 'omit' });
    this.calls++;
    this.#recordRate(res);
    if (res.status === 404) return null;
    if ((res.status === 403 || res.status === 429) && this.remaining === 0) {
      throw new RateLimitError(this.reset);
    }
    if (res.status === 401) throw new Error('GitHub rejected the token. Check it, or clear it to scan without one.');
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${path}.`);
    return res.json();
  }

  // File contents from the raw host, pinned to a ref. Does not count against
  // the API limit. Returns { text } or { skipped: reason }, never throws for 404.
  async raw(owner, repo, ref, path, { maxBytes = 1_000_000 } = {}) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodePath(path)}`;
    let res;
    try {
      res = await fetch(url, { credentials: 'omit' });
    } catch {
      return { skipped: 'network error' };
    }
    if (res.status === 404) return { skipped: 'not found' };
    if (res.status === 429) return { skipped: 'throttled by raw.githubusercontent.com' };
    if (!res.ok) return { skipped: `HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxBytes) return { skipped: 'over size limit' };
    if (looksBinary(bytes)) return { skipped: 'binary' };
    return { text: new TextDecoder('utf-8').decode(bytes) };
  }
}

export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function blobUrl(owner, repo, sha, path, line) {
  const base = `https://github.com/${owner}/${repo}/blob/${sha}/${encodePath(path)}`;
  return line ? `${base}#L${line}` : base;
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
