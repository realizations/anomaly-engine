/**
 * Runs the feed-fetcher harness and reports.
 *
 * The fetcher's rules are a security boundary -- https only, an explicit host allow-list,
 * no redirects, a size cap, a floor between polls -- and none of that can be verified by
 * reading the code, because every interesting failure is "what happens when the server
 * does something unexpected". So the C# harness points the real fetcher at a real
 * loopback listener that misbehaves on demand.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROJECT = resolve(HERE, 'EventFeedTests', 'EventFeedTests.csproj');

const run = (args) => spawnSync('dotnet', args, { cwd: ROOT, encoding: 'utf8' });
const result = run(['run', '--project', PROJECT, '-c', 'Release', '--nologo']);

if (result.status !== 0) {
  console.error('FAIL  event feed fetcher:');
  console.error((result.stdout ?? '') + (result.stderr ?? ''));
  process.exit(1);
}

const passed = (result.stdout.match(/^PASS /gm) ?? []).length;
console.log(`PASS  the feed fetcher holds its rules -- ${passed} checks`);