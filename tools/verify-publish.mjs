/**
 * Publishes a release build and verifies it is actually shippable.
 *
 * This exists because a published build of this application shipped with no
 * renderer in it. The copy target fired on Build and wrote to $(OutDir), while
 * `dotnet publish` writes somewhere else, so the exe was present, the fonts were
 * present, the icon was present, and renderer/index.html was not. The app would
 * have launched, found nothing to load, and shown a blank desktop. Every existing
 * check passed, because every existing check looked at the debug build output,
 * which was correct.
 *
 * So the release path is verified on its own terms: publish it, then assert the
 * things without which the application cannot function. The renderer is the whole
 * product, so its absence is treated as a hard failure rather than a warning.
 *
 *   node tools/verify-publish.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, statSync, rmSync, readdirSync } from 'node:fs';

// Anchored to this file rather than to the working directory, so the tool
// behaves the same however it is invoked.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'build', 'publish-verify');

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failed++;
};

// The renderer must be built first. A release built against a stale or absent
// renderer is exactly the failure this tool is here to catch, so it does not
// paper over it by building it silently.
const rendererBuilt = existsSync(resolve(ROOT, 'src/Engine/renderer/index.html'));
if (!rendererBuilt) {
  console.error('FAIL  the renderer is not built. Run `npm run build` in src/Engine first.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });

console.log('publishing a self-contained win-x64 release (this takes a moment)...');
const publish = spawnSync(
  'dotnet',
  ['publish', 'src/AnomalyEngine/AnomalyEngine.csproj', '-c', 'Release', '-r', 'win-x64',
    '--self-contained', '-o', OUT, '--nologo'],
  { cwd: ROOT, encoding: 'utf8', shell: true }
);

if (publish.status !== 0) {
  console.error('FAIL  dotnet publish failed');
  console.error((publish.stdout ?? '') + (publish.stderr ?? ''));
  process.exit(1);
}

// The application itself.
check(existsSync(join(OUT, 'AnomalyEngine.exe')), 'the executable is published');

// The renderer. Without this the application shows a blank desktop, which is why
// it is the first and most important assertion here.
const rendererIndex = join(OUT, 'renderer', 'index.html');
check(existsSync(rendererIndex), 'the renderer is published',
  existsSync(rendererIndex) ? 'renderer/index.html' : 'renderer/index.html is MISSING');

// The renderer has to be a real document, not a placeholder.
if (existsSync(rendererIndex)) {
  const html = statSync(rendererIndex).size;
  check(html > 500, 'the published renderer is a real document', `${html} bytes`);
}

// The bundle the page loads.
const assetDir = join(OUT, 'renderer', 'assets');
const bundles = existsSync(assetDir) ? readdirSync(assetDir).filter((f) => f.endsWith('.js')) : [];
check(bundles.length > 0, 'the renderer bundle is published',
  bundles.length ? bundles.join(', ') : 'no .js in renderer/assets');

// The integrity digest, which the host checks at startup and refuses to run
// without. Missing means the host either cannot verify the install or, worse,
// treats a missing digest as acceptable.
check(existsSync(join(OUT, 'renderer.bundle.sha256')), 'the bundle integrity digest is published');

// Branding and typography. The tray icon in particular is loaded from the output
// directory rather than from an embedded resource when present.
check(existsSync(join(OUT, 'anomaly.ico')), 'the tray icon is published');
const fontCount = existsSync(join(OUT, 'renderer', 'fonts'))
  ? readdirSync(join(OUT, 'renderer', 'fonts')).filter((f) => f.endsWith('.ttf')).length
  : 0;
check(fontCount >= 5, 'every bundled typeface is published', `${fontCount} ttf`);
check(existsSync(join(OUT, 'renderer', 'favicon.png')), 'the favicon is published');

// A self-contained release must not depend on a separate .NET install, so the
// runtime has to be in the output rather than on the machine.
check(existsSync(join(OUT, 'coreclr.dll')) || existsSync(join(OUT, 'hostfxr.dll')),
  'the .NET runtime is bundled, so the release is self-contained');

let total = 0;
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else total += statSync(p).size;
  }
};
if (existsSync(OUT)) walk(OUT);
console.log(`\npublish size: ${(total / 1024 / 1024).toFixed(1)} MB`);
console.log(`output: ${OUT}`);

console.log(failed ? `\n${failed} publish check(s) failed.` : '\nPASS  the published build is complete and shippable.');
process.exit(failed ? 1 : 0);
