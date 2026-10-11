// Small text helpers shared by the checks. No DOM access here, so the
// checks can be tested under Node.

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'icns', 'bmp', 'tif', 'tiff', 'psd',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'm4a', 'wav', 'ogg', 'webm', 'mov', 'avi', 'flac',
  'zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'tar', 'jar', 'war',
  'pdf', 'wasm', 'exe', 'dll', 'so', 'dylib', 'a', 'o', 'lib', 'bin', 'class', 'pyc',
  'node', 'dmg', 'pkg', 'deb', 'rpm', 'msi', 'apk', 'ipa', 'sqlite', 'db',
]);

export function extension(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isLikelyBinaryPath(path) {
  return BINARY_EXT.has(extension(path));
}

// A NUL byte in the first 8 KB is the same test git uses.
export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function lineAt(text, index) {
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: index - start + 1, start };
}

export function lineText(text, start) {
  const end = text.indexOf('\n', start);
  return text.slice(start, end === -1 ? text.length : end);
}

export function codePoint(ch) {
  return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
}

export function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// JSON with comments and trailing commas, as used by VS Code and dev containers.
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[++i] ?? ''; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
