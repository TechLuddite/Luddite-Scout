// Lockfile parsers for S5. Each returns [{ ecosystem, name, version }].
// These are deliberately small text parsers, not full TOML or YAML.

const SKIP_DIRS = /(^|\/)(node_modules|vendor|third_party|\.git)\//;

const PARSERS = [
  [/(^|\/)Cargo\.lock$/, parseCargoLock],
  [/(^|\/)package-lock\.json$/, parsePackageLock],
  [/(^|\/)npm-shrinkwrap\.json$/, parsePackageLock],
  [/(^|\/)pnpm-lock\.yaml$/, parsePnpmLock],
  [/(^|\/)yarn\.lock$/, parseYarnLock],
  [/(^|\/)(poetry|uv|pdm)\.lock$/, parsePythonTomlLock],
  [/(^|\/)requirements[^/]*\.txt$/, parseRequirements],
  [/(^|\/)go\.sum$/, parseGoSum],
  [/(^|\/)Gemfile\.lock$/, parseGemfileLock],
  [/(^|\/)composer\.lock$/, parseComposerLock],
];

export function lockfileParser(path) {
  if (SKIP_DIRS.test(path)) return null;
  for (const [re, fn] of PARSERS) if (re.test(path)) return fn;
  return null;
}

function tomlBlocks(text, header) {
  return text.split(header).slice(1).map((block) => {
    const end = block.search(/^\[/m);
    return end === -1 ? block : block.slice(0, end);
  });
}

function tomlValue(block, key) {
  const m = block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m ? m[1] : null;
}

export function parseCargoLock(text) {
  const out = [];
  for (const block of tomlBlocks(text, /^\[\[package\]\]\s*$/m)) {
    const source = tomlValue(block, 'source');
    if (!source || !source.startsWith('registry+')) continue;
    const name = tomlValue(block, 'name');
    const version = tomlValue(block, 'version');
    if (name && version) out.push({ ecosystem: 'crates.io', name, version });
  }
  return out;
}

export function parsePythonTomlLock(text) {
  const out = [];
  for (const block of tomlBlocks(text, /^\[\[package\]\]\s*$/m)) {
    if (/^source\s*=\s*\{\s*(editable|virtual|path|directory)\s*=/m.test(block)) continue;
    const name = tomlValue(block, 'name');
    const version = tomlValue(block, 'version');
    if (name && version) out.push({ ecosystem: 'PyPI', name, version });
  }
  return out;
}

export function parsePackageLock(text) {
  const data = JSON.parse(text);
  const out = [];
  if (data.packages) {
    for (const [key, pkg] of Object.entries(data.packages)) {
      if (!key || pkg.link || !pkg.version) continue;
      const idx = key.lastIndexOf('node_modules/');
      const name = pkg.name || (idx === -1 ? null : key.slice(idx + 'node_modules/'.length));
      if (name) out.push({ ecosystem: 'npm', name, version: pkg.version });
    }
  } else if (data.dependencies) {
    const walk = (deps) => {
      for (const [name, pkg] of Object.entries(deps || {})) {
        if (pkg.version && !/^(file|link|git)/.test(pkg.version)) out.push({ ecosystem: 'npm', name, version: pkg.version });
        walk(pkg.dependencies);
      }
    };
    walk(data.dependencies);
  }
  return out;
}

function splitNameVersion(spec) {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return null;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

export function parsePnpmLock(text) {
  const out = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inPackages = /^(packages|snapshots):/.test(line); continue; }
    if (!inPackages) continue;
    const m = line.match(/^ {2}(['"]?)(\/?[^\s'"]+)\1:\s*$/);
    if (!m) continue;
    let spec = m[2].replace(/^\//, '').replace(/\(.*$/, '');
    let nv = splitNameVersion(spec);
    if (!nv) {
      const slash = spec.lastIndexOf('/');
      if (slash > 0) nv = { name: spec.slice(0, slash), version: spec.slice(slash + 1) };
    }
    if (nv && /^\d/.test(nv.version)) out.push({ ecosystem: 'npm', name: nv.name, version: nv.version.replace(/_.*$/, '') });
  }
  return out;
}

export function parseYarnLock(text) {
  const out = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line) && line.trimEnd().endsWith(':') && !line.startsWith('#') && !line.startsWith('__metadata')) {
      const first = line.slice(0, -1).split(',')[0].trim().replace(/^"|"$/g, '');
      const nv = splitNameVersion(first);
      current = nv ? nv.name : null;
      continue;
    }
    const v = line.match(/^\s+version:?\s+"?([^"\s]+)"?\s*$/);
    if (v && current) {
      out.push({ ecosystem: 'npm', name: current, version: v[1] });
      current = null;
    }
  }
  return out;
}

export function parseRequirements(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*==\s*([A-Za-z0-9._+!-]+)/);
    if (m) out.push({ ecosystem: 'PyPI', name: m[1], version: m[3] });
  }
  return out;
}

export function parseGoSum(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(v[^\s/]+)\s+h1:/);
    if (m) out.push({ ecosystem: 'Go', name: m[1], version: m[2].replace(/\+incompatible$/, '') });
  }
  return out;
}

export function parseGemfileLock(text) {
  const out = [];
  let inSpecs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s{2}specs:\s*$/.test(line)) { inSpecs = true; continue; }
    if (/^\S/.test(line)) inSpecs = false;
    if (!inSpecs) continue;
    const m = line.match(/^ {4}([A-Za-z0-9._-]+) \(([^)\s-]+)(-[^)]*)?\)\s*$/);
    if (m) out.push({ ecosystem: 'RubyGems', name: m[1], version: m[2] });
  }
  return out;
}

export function parseComposerLock(text) {
  const data = JSON.parse(text);
  return [...(data.packages || []), ...(data['packages-dev'] || [])]
    .filter((p) => p.name && p.version)
    .map((p) => ({ ecosystem: 'Packagist', name: p.name, version: p.version.replace(/^v/, '') }));
}
