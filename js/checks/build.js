// S6. Code that runs when the project is installed, built, or entered,
// as opposed to when someone deliberately runs it.

const SKIP_DIRS = /(^|\/)(node_modules|vendor|third_party|\.git)\//;

const RULES = [
  [/(^|\/)build\.rs$/, 'medium', 'Cargo build script, runs on every cargo build or check'],
  [/(^|\/)\.envrc$/, 'medium', 'direnv script, runs when you enter the folder if direnv is allowed'],
  [/(^|\/)setup\.py$/, 'medium', 'Python setup script, runs on install from source'],
  [/(^|\/)binding\.gyp$/, 'medium', 'Native addon build, runs during npm install'],
  [/(^|\/)(gradlew|mvnw)$/, 'low', 'Build tool wrapper script'],
  [/(^|\/)gradle\/wrapper\/gradle-wrapper\.jar$/, 'low', 'Gradle wrapper binary, runs on build'],
  [/(^|\/)\.mvn\/wrapper\/maven-wrapper\.jar$/, 'low', 'Maven wrapper binary, runs on build'],
  [/(^|\/)build\.gradle(\.kts)?$/, 'info', 'Gradle build script'],
  [/(^|\/)(GNUmakefile|[Mm]akefile)$/, 'info', 'Makefile'],
  [/(^|\/)CMakeLists\.txt$/, 'info', 'CMake build script'],
  [/(^|\/)meson\.build$/, 'info', 'Meson build script'],
  [/(^|\/)[Jj]ustfile$|(^|\/)\.justfile$/, 'info', 'just recipes'],
  [/(^|\/)Taskfile\.ya?ml$/, 'info', 'Task runner file'],
  [/(^|\/)Rakefile$/, 'info', 'Rake tasks'],
  [/(^|\/)\.pre-commit-config\.yaml$/, 'info', 'pre-commit hooks, run on git commit once installed'],
  [/(^|\/)lefthook\.ya?ml$/, 'info', 'Lefthook git hooks'],
  [/(^|\/)\.husky\/[^/]+$/, 'info', 'Husky git hook, installed by npm install via the prepare script'],
  [/(^|\/)\.githooks\/[^/]+$/, 'info', 'Git hook script'],
  [/(^|\/)(Dockerfile|Containerfile)(\.[^/]+)?$/, 'info', 'Container build file'],
];

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preprepare', 'postprepare'];

export function classifyBuildPath(path) {
  if (SKIP_DIRS.test(path)) return null;
  for (const [re, severity, label] of RULES) if (re.test(path)) return { severity, label };
  return null;
}

export function installScripts(packageJsonText) {
  let data;
  try { data = JSON.parse(packageJsonText); } catch { return null; }
  const scripts = data?.scripts || {};
  return INSTALL_SCRIPTS.filter((k) => typeof scripts[k] === 'string').map((k) => ({ name: k, command: scripts[k] }));
}

export async function runBuild(ctx) {
  const findings = [];
  const blobs = ctx.entries.filter((e) => e.type === 'blob');

  for (const e of blobs) {
    const c = classifyBuildPath(e.path);
    if (c) findings.push({ severity: c.severity, title: c.label, path: e.path });
  }

  const pkgs = blobs.filter((e) => /(^|\/)package\.json$/.test(e.path) && !SKIP_DIRS.test(e.path)).slice(0, 100);
  let unread = 0;
  const texts = await ctx.fetchMany(pkgs.map((p) => p.path));
  for (const [path, res] of texts) {
    if (!res.text) { unread++; continue; }
    const scripts = installScripts(res.text);
    if (scripts === null) { unread++; continue; }
    for (const s of scripts) {
      findings.push({
        severity: 'medium',
        title: `npm "${s.name}" script, runs automatically on install`,
        path,
        snippet: s.command.slice(0, 240),
      });
    }
  }

  const notes = [`Checked ${blobs.length} file paths and ${pkgs.length - unread} package.json files.`];
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some files may be missing.');
  return { status: unread || ctx.truncated ? 'partial' : 'ran', notes, findings };
}
