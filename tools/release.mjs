/**
 * Builds the thing that ships.
 *
 * One script, run locally and from CI, because the two drifting apart is how a release
 * pipeline starts producing artifacts nobody has ever opened. The GitHub workflow calls
 * this; it does not reimplement it.
 *
 * What it does, in order, and why the order matters:
 *
 *   1. `npm ci`, not `npm install`. The lockfile is the point; `install` is free to
 *      resolve something different from the one that was tested.
 *   2. Typecheck, lint and the unit tests, because a release is the wrong place to find
 *      out.
 *   3. The full gate suite. It is slow, and that is why it runs here and in CI rather
 *      than only locally -- a release that skips it is a release whose visual and
 *      persistence checks have not run against the artifact.
 *   4. A self-contained single-file publish, so the artifact runs on a machine with no
 *      .NET runtime installed. The previous workflow published framework-dependent, which
 *      meant the release only worked for people who had already installed the SDK.
 *   5. A zip. The old workflow uploaded the publish folder as a file tree, which is
 *      hundreds of loose files on a release page and not something anyone can unzip.
 *   6. Checksums, which `docs/release-process.md` promised and nothing produced.
 *
 * Run: `node tools/release.mjs [--skip-verify] [--out <dir>]`
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ENGINE = resolve(ROOT, 'src', 'Engine');
const HOST = resolve(ROOT, 'src', 'AnomalyEngine');

const args = process.argv.slice(2);
const SKIP_VERIFY = args.includes('--skip-verify');
const outArg = args.indexOf('--out');
const DIST = resolve(ROOT, outArg >= 0 ? args[outArg + 1] : 'dist');

const log = (message) => process.stdout.write(`${message}\n`);
const step = (message) => log(`\n== ${message}`);

/**
 * Runs a command and fails loudly.
 *
 * `shell: true` is not used anywhere in this repository: on Windows it hands the
 * argument array to cmd.exe, which joins it with spaces without quoting, and this
 * checkout's path contains a space. That bug is real and was hit before.
 */
function run(command, argv, cwd = ROOT) {
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    console.error(`FAIL  ${command} ${argv.join(' ')}`);
    console.error((result.stdout ?? '') + (result.stderr ?? ''));
    process.exit(1);
  }
  return result.stdout ?? '';
}

/**
 * Runs an npm script.
 *
 * By invoking npm's JavaScript entry point with the same node binary rather than the
 * `npm` executable. On Windows the executable is `npm.cmd`, and Node refuses to spawn a
 * `.cmd` without `shell: true` -- which this repository does not use, for the quoting
 * reason above. So the two options are "invoke a batch file" or "invoke the same program
 * it wraps", and the second is both safer and more precise: it is the same npm, with the
 * same lockfile, run by the same interpreter.
 *
 * Falls back to the executable where that works, so this is not Windows-only.
 */
function npm(args, cwd = ENGINE) {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(cli)) return run(process.execPath, [cli, ...args], cwd);
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd);
}

function version() {
  const csproj = readFileSync(join(HOST, 'AnomalyEngine.csproj'), 'utf8');
  const match = /<Version>([^<]+)<\/Version>/.exec(csproj);
  return match ? match[1].trim() : '0.0.0';
}

const VERSION = version();
const ARTIFACT = `anomaly-engine-${VERSION}-win-x64.zip`;

step(`Anomaly Engine ${VERSION}`);
log(`   output: ${DIST}`);

// ---------------------------------------------------------------- verification --

step('Install dependencies from the lockfile');
npm(['ci']);

step('Typecheck');
npm(['run', 'typecheck']);

step('Lint');
npm(['run', 'lint']);

step('Unit tests');
// `npm test` exits non-zero on failure, which `run` turns into a hard stop. Its output is
// summarised rather than dumped: a release log is not the place to read 500 passing
// test names.
const testOut = npm(['test']);
const summary = /Tests\s+.*?passed/.exec(testOut)?.[0] ?? 'tests passed';
log(`   ${summary.trim()}`);

if (!SKIP_VERIFY) {
  step('Full gate suite');
  // This builds and deploys the renderer, so it has to run before the publish step
  // rather than against the publish output.
  const verifyOut = run('node', [join('tools', 'verify.mjs')]);
  const passed = (verifyOut.match(/^PASS/gm) ?? []).length;
  log(`   ${passed} checks passed`);
} else {
  step('Full gate suite');
  log('   skipped by --skip-verify');
}

// ------------------------------------------------------------------- publishing --

step('Publish, self-contained and single-file');

if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

run('dotnet', [
  'publish',
  join(HOST, 'AnomalyEngine.csproj'),
  '-c', 'Release',
  '-o', DIST,
  // Self-contained: the artifact has to run on a machine with no .NET runtime. The
  // previous workflow published framework-dependent, so the release only worked for
  // people who had the SDK installed.
  '--self-contained', 'true',
  '-p:PublishSingleFile=true',
  // The renderer is deployed by the build target and copied into the publish directory.
  // Excluding it from the single-file bundler is what keeps `renderer/` a real folder on
  // disk, which it has to be: the page is served from file:// and Chromium will not
  // fetch a module out of an archive.
  '-p:IncludeNativeLibrariesForSelfExtract=true',
]);

// ------------------------------------------------------------------ packaging ---

step('Verify the published artifact');

const exe = join(DIST, 'AnomalyEngine.exe');
if (!existsSync(exe)) {
  console.error(`FAIL  ${exe} was not produced.`);
  process.exit(1);
}

const indexHtml = join(DIST, 'renderer', 'index.html');
if (!existsSync(indexHtml)) {
  // Not a warning. A publish without a renderer is an app that starts and draws
  // nothing, and it is the one packaging mistake that cannot be seen from the zip's
  // file list.
  console.error('FAIL  the published folder has no renderer/index.html. It would start and render nothing.');
  process.exit(1);
}

const digest = join(DIST, 'renderer.bundle.sha256');
if (!existsSync(digest)) {
  console.error('FAIL  the renderer bundle digest is missing; the host refuses to start without it.');
  process.exit(1);
}

// The digest is what the host checks at startup, so it has to describe what was
// actually published rather than what was built. Recomputed here from the published
// folder and compared, which is the only way to know the two agree.
const recomputed = recomputeDigest(join(DIST, 'renderer'));
const recorded = readFileSync(digest, 'utf8').trim();
if (recomputed !== recorded) {
  console.error('FAIL  the published renderer digest is stale.');
  console.error(`   recorded ${recorded}`);
  console.error(`   actual   ${recomputed}`);
  process.exit(1);
}
log(`   renderer digest matches: ${recorded.slice(0, 16)}...`);

const exeSize = statSync(exe).size;
if (exeSize < 5 * 1024 * 1024) {
  // A framework-dependent single file is a few hundred kilobytes. Under 5MB means the
  // runtime was not embedded, whatever the command line said.
  console.error(`FAIL  AnomalyEngine.exe is ${Math.round(exeSize / 1024)}KB, which is too small to be self-contained.`);
  process.exit(1);
}
log(`   AnomalyEngine.exe ${Math.round(exeSize / 1024 / 1024)}MB, self-contained`);

// -------------------------------------------------------------------- shipping --

step('Write the archive');

const readme = join(DIST, 'START-HERE.txt');
writeFileSync(
  readme,
  [
    'Anomaly Engine ' + VERSION,
    '',
    'Double-click AnomalyEngine.exe. There is no installer and nothing to configure:',
    'this folder is the program.',
    '',
    'The tray icon, once running, is where the settings live. Right-click it.',
    '',
    'It needs the WebView2 Runtime, which ships with Windows 11 and with any current',
    'Windows 10. Everything else it needs is in this folder.',
    '',
    'Command line:',
    '  AnomalyEngine.exe --settings    open the settings window',
    '  AnomalyEngine.exe --diagnose    report what it can see, and what it cannot',
    '  AnomalyEngine.exe --debug       start with the debug overlay open',
    '',
    'Uninstall: delete this folder. Anything it saved is in',
    '%APPDATA%\\AnomalyEngine and can be deleted too.',
    '',
  ].join('\n')
);

const zip = join(DIST, ARTIFACT);
// Compress-Archive rather than a Node zip dependency: the package.json here carries no
// archive library, and adding one to build a release artifact is a larger dependency
// than the thing it would do.
run('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zip}' -Force`,
]);

const zipSize = statSync(zip).size;
log(`   ${ARTIFACT} ${(zipSize / 1024 / 1024).toFixed(1)}MB`);

step('Checksums');
const sums = [`${await digestOf(zip)}  ${ARTIFACT}`];
writeFileSync(join(DIST, 'SHA256SUMS'), sums.join('\n') + '\n');
log(`   ${sums[0].split('  ')[0].slice(0, 16)}...  ${ARTIFACT}`);

step('Done');
log(`   ${ARTIFACT}`);
log(`   SHA256SUMS`);
log('');
log('Upload both files to the release. The publish folder next to them is left in');
log('place so it can be inspected, and is not part of the artifact.');

/* ------------------------------------------------------------------- helpers -- */

async function digestOf(path) {
  const bytes = readFileSync(path);
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Recomputes the renderer digest exactly as `write-bundle-digest.mjs` does.
 *
 * Duplicated rather than imported because that script runs as a child process and takes
 * a directory argument; importing it would mean importing a module whose whole job is to
 * exit. Two details have to match or this comparison is meaningless: the sort is
 * case-insensitive on the relative path rather than the default one, and the file holds
 * the bare hash. The host parses that hash at startup, so the comparison above is what
 * proves the published folder is the one that was built.
 */
function recomputeDigest(rendererDir) {
  const walk = (base, current = base) => {
    const found = [];
    for (const name of readdirSync(current)) {
      const p = join(current, name);
      if (statSync(p).isDirectory()) found.push(...walk(base, p));
      else found.push(p);
    }
    return found;
  };

  const files = walk(rendererDir).sort((a, b) =>
    relative(rendererDir, a).toLowerCase() < relative(rendererDir, b).toLowerCase() ? -1 : 1
  );

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(Buffer.from(relative(rendererDir, file).replace(/\\/g, '/'), 'utf8'));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}