/**
 * Runs the renderer-read regression test and reports.
 *
 * Small and standalone on purpose: it needs no network, no listener and no browser, so
 * it can be run the moment a "the settings window crashed" report comes in, without
 * standing up anything.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROJECT = resolve(HERE, 'RendererReadTests', 'RendererReadTests.csproj');

const result = spawnSync('dotnet', ['run', '--project', PROJECT, '-c', 'Release', '--nologo'], {
  cwd: ROOT,
  encoding: 'utf8',
});

if (result.status !== 0) {
  console.error('FAIL  renderer reads:');
  console.error((result.stdout ?? '') + (result.stderr ?? ''));
  process.exit(1);
}

const passed = (result.stdout.match(/^PASS /gm) ?? []).length;
console.log(`PASS  a failed renderer read cannot crash the settings window -- ${passed} checks`);