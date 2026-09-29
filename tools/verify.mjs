/**
 * One command that verifies the whole project.
 *
 *   node tools/verify.mjs
 *
 * Runs the licence gate (plus its self-test), then the end-to-end suite against
 * the DEPLOYED build over file://, which is the exact condition the native host
 * uses. Anything served over http would hide module and CORS regressions, which
 * is how a real bug shipped once already.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DEPLOYED = join(ROOT, 'src', 'AnomalyEngine', 'bin', 'Debug', 'net8.0-windows', 'renderer', 'index.html');

function run(label, args, opts = {}) {
  return new Promise((resolve) => {
    process.stdout.write(`\n=== ${label} ===\n`);
    const p = spawn(process.execPath, args, { cwd: HERE, stdio: 'inherit', ...opts });
    p.on('close', (code) => resolve({ label, code: code ?? 1 }));
  });
}

const steps = [];

if (!existsSync(DEPLOYED)) {
  process.stdout.write(
    `ERROR  deployed build not found:\n  ${DEPLOYED}\n` +
    '  Build first:  dotnet build src\\AnomalyEngine\n'
  );
  process.exit(1);
}

steps.push(await run('licence gate self-test', ['license-gate.mjs', '--selftest']));
steps.push(await run('licence gate', ['license-gate.mjs']));
steps.push(await run('font files parse', ['verify-fonts.mjs']));
steps.push(await run('end-to-end (deployed, file://)', ['e2e.mjs']));
steps.push(await run('per-monitor layouts', ['per-monitor.mjs']));
steps.push(await run('typefaces load and apply', ['verify-fonts-use.mjs']));
steps.push(await run('durable state round-trip', ['verify-persistence.mjs']));

process.stdout.write('\n' + '='.repeat(56) + '\n');
let failed = 0;
for (const s of steps) {
  process.stdout.write(`${s.code === 0 ? 'PASS' : 'FAIL'}  ${s.label}\n`);
  if (s.code !== 0) failed++;
}
process.stdout.write('='.repeat(56) + '\n');
process.stdout.write(failed ? `\n${failed} step(s) failed.\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
