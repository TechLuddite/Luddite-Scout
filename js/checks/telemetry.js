// S9: code and manifests that report usage, errors or machine details to a
// remote service. bin/scout has the same patterns, and both run the cases in
// test/fixtures/cases.json.
import { extension } from '../lib/text.js';
import { trapHits, trapFinding } from './traps.js';

const HOST = new RegExp(
  '(?<![\\w.-])(?:[\\w-]+\\.)*(?:sentry\\.io|posthog\\.com|segment\\.(?:io|com)|mixpanel\\.com|amplitude\\.com|google-analytics\\.com|googletagmanager\\.com'
  + '|analytics\\.google\\.com|app-measurement\\.com|crashlytics\\.com|datadoghq\\.(?:com|eu)|nr-data\\.net|newrelic\\.com|bugsnag\\.com|rollbar\\.com'
  + '|appcenter\\.ms|applicationinsights\\.azure\\.com|services\\.visualstudio\\.com|plausible\\.io|scarf\\.sh|honeycomb\\.io|logrocket\\.com|lr-ingest\\.io'
  + '|hotjar\\.com|clarity\\.ms|fullstory\\.com|heapanalytics\\.com|statsig\\.com|statsigapi\\.net|matomo\\.cloud|cloudflareinsights\\.com'
  + '|telemetry\\.[a-z0-9-]+\\.[a-z]{2,})(?![\\w-])', 'gi');
const PACKAGE = new RegExp(
  '(?<![\\w@/.-])(?:@sentry/[\\w.-]+|sentry[-_]sdk|sentry|raven|posthog(?:[-_](?:js|node|python))?|@posthog/[\\w.-]+|analytics-node|@segment/[\\w.-]+'
  + '|mixpanel(?:[-_]browser)?|amplitude[-_]?(?:js|analytics)?|@amplitude/[\\w.-]+|@datadog/browser-rum|dd-trace|ddtrace|newrelic|bugsnag|@bugsnag/[\\w.-]+'
  + '|rollbar|applicationinsights|@microsoft/applicationinsights-[\\w.-]+|@vercel/analytics|@vercel/speed-insights|react-ga4?|logrocket|@fullstory/[\\w.-]+'
  + '|@opentelemetry/exporter-[\\w.-]+|opentelemetry-exporter-[\\w.-]+|node-machine-id|py-machineid|machine-uid)(?![\\w/-])', 'gi');
const INSTALL = /(?<![\w/.-])@scarf\/scarf(?![\w/-])/gi;
const MANIFEST = new RegExp(
  '(?:^|/)(?:package\\.json|requirements[\\w.-]*\\.txt|pyproject\\.toml|setup\\.cfg|Pipfile|Cargo\\.toml|go\\.mod|Gemfile|composer\\.json|pubspec\\.yaml'
  + '|build\\.gradle(?:\\.kts)?|pom\\.xml|[^/]+\\.csproj|Package\\.swift)$');
const SETTING = new RegExp(
  '\\b(?:DO_NOT_TRACK|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:TELEMETRY|ANALYTICS|CRASH_REPORTS?|CRASH_REPORTING|USAGE_STATS|USAGE_DATA)(?:_[A-Z0-9]+)*'
  + '|(?:TELEMETRY|ANALYTICS)_(?:DISABLED?|ENABLED?|OPT_?OUT|OPT_?IN|OFF|ON|URL|HOST|ENDPOINT|KEY|ID)\\b)', 'g');
const MACHINE_ID = new RegExp(
  '/etc/machine-id|/var/lib/dbus/machine-id|IOPlatformUUID|IOPlatformSerialNumber|\\bMachineGuid\\b|\\bwmic\\s+(?:csproduct|bios)\\s+get\\b|\\bdmidecode\\b'
  + '|\\buuid\\.getnode\\s*\\(|\\bmachineIdSync\\s*\\(|\\bhostnamectl\\b[^\\n]{0,40}machine', 'gi');
const DOC_EXT = new Set(['md', 'mdc', 'txt', 'rst', 'adoc', 'html', 'htm']);
const SKIP_DIRS = /(^|\/)(node_modules|vendor|third_party|\.git)\//;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|[^/]+\.lock)$/;
const RANK = { info: 0, low: 1, medium: 2, high: 3 };

export function analyzeTelemetryText(path, text) {
  const out = [];
  let hits = trapHits(HOST, text);
  if (hits.length) out.push(trapFinding('low', 'Names a telemetry, analytics or error-reporting service', hits));
  if (MANIFEST.test(path)) {
    hits = trapHits(INSTALL, text);
    if (hits.length) out.push(trapFinding('medium', 'Depends on a package that reports each install to its maintainer', hits));
    hits = trapHits(PACKAGE, text);
    if (hits.length) out.push(trapFinding('low', 'Depends on a telemetry, analytics or error-reporting package', hits));
  }
  if (!DOC_EXT.has(extension(path))) {
    hits = trapHits(MACHINE_ID, text);
    if (hits.length) out.push(trapFinding('low', 'Reads an identifier of the machine', hits));
  }
  hits = trapHits(SETTING, text);
  if (hits.length) out.push(trapFinding('info', 'Names a telemetry setting', hits));
  return out;
}

export async function runTelemetry(ctx, { maxFiles = 4000, maxBytes = 60_000_000 } = {}) {
  let findings = [];
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
    ctx.progress(`S9: reading files ${done} of ${selected.length}`);
  });
  for (const [path, res] of texts) {
    if (!res.text) { skipped++; continue; }
    scanned++;
    if (SKIP_DIRS.test(path) || LOCKFILE.test(path)) continue;
    findings.push(...analyzeTelemetryText(path, res.text).map((f) => ({ ...f, path })));
  }
  findings = findings.map((f, i) => [f, i]).sort((a, b) => RANK[b[0].severity] - RANK[a[0].severity] || a[1] - b[1]).map(([f]) => f);

  const notes = [`Scanned ${scanned} text files. Lockfiles and vendored folders are left out.`];
  if (skipped) notes.push(`${skipped} files could not be read as text (binary, too large, or not served).`);
  if (notCovered) notes.push(`${notCovered} files not read because of the size or count cap.`);
  if (ctx.truncated) notes.push('The file list from GitHub was truncated, so some files were never listed.');
  return { status: notCovered || ctx.truncated ? 'partial' : 'ran', notes, findings };
}
