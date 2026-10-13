/**
 * Runs the world-validator harness and reports.
 *
 * `dotnet run` rather than `dotnet build` + `dotnet exec`, so there is no path to get
 * wrong between the two. No `shell: true`: on Windows that hands the argument array to
 * cmd.exe, which joins it with spaces without quoting, and this repository's path
 * contains a space.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROJECT = resolve(HERE, 'WorldFolderTests', 'WorldFolderTests.csproj');

const run = (args) => spawnSync('dotnet', args, { cwd: ROOT, encoding: 'utf8' });

const result = run(['run', '--project', PROJECT, '-c', 'Release', '--nologo']);

if (result.status !== 0) {
  console.error('FAIL  world folder:');
  console.error((result.stdout ?? '') + (result.stderr ?? ''));
  process.exit(1);
}

const passed = (result.stdout.match(/^PASS /gm) ?? []).length;
console.log(`PASS  the world validator behaves -- ${passed} checks`);