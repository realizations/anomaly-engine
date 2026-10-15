/**
 * Runs the feed-rule editing test and reports.
 *
 * Standalone on purpose, like renderer-read.mjs: it needs no browser, no listener and no
 * desktop, so it can be run on its own the moment a "the rule I added did not stick" or
 * "this headline fires twice" report comes in. The WPF window cannot be tested from a
 * console, which is why the edits it performs live in Core and are tested here.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROJECT = resolve(HERE, 'FeedRulesTests', 'FeedRulesTests.csproj');

const result = spawnSync('dotnet', ['run', '--project', PROJECT, '-c', 'Release', '--nologo'], {
  cwd: ROOT,
  encoding: 'utf8',
});

if (result.status !== 0) {
  console.error('FAIL  feed rules:');
  console.error((result.stdout ?? '') + (result.stderr ?? ''));
  process.exit(1);
}

const passed = (result.stdout.match(/^PASS /gm) ?? []).length;
console.log(`PASS  feed rules are edited the way they are meant to be -- ${passed} checks`);
