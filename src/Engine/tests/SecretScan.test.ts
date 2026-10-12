import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECRET_KEYS, registryProblems, isCredentialShaped } from '../../../tools/secret-keys.mjs';
import {
  scanText,
  scanRepo,
  envExampleProblems,
  repoRoot,
  trackedFiles,
  isSkippedPath,
} from '../../../tools/secret-scan.mjs';

const ROOT = repoRoot();

function gitIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd: ROOT });
    return true;
  } catch (err) {
    const e = err as { status?: number };
    if (e.status === 1) return false;
    throw err;
  }
}

describe('secret-key registry', () => {
  it('is well formed and its consumers exist', () => {
    expect(registryProblems()).toEqual([]);
  });

  it('declares at least one credential', () => {
    expect(SECRET_KEYS.length).toBeGreaterThan(0);
  });

  it('names credentials in the shape the scan greps for', () => {
    for (const k of SECRET_KEYS) expect(isCredentialShaped(k.name)).toBe(true);
    expect(isCredentialShaped('OPENWEATHER_API_KEY')).toBe(true);
    expect(isCredentialShaped('OPENWEATHER_ENDPOINT')).toBe(false);
  });

  it('has no duplicate names', () => {
    const names = SECRET_KEYS.map((k: { name: string }) => k.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('.env.example', () => {
  const examplePath = join(ROOT, '.env.example');
  const text = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : null;

  it('exists', () => {
    expect(text).not.toBeNull();
  });

  it('declares every registered key and carries no value for any', () => {
    expect(envExampleProblems(text)).toEqual([]);
  });

  it('is tracked, while .env is not', () => {
    const files = trackedFiles(ROOT);
    expect(files).toContain('.env.example');
    expect(files).not.toContain('.env');
  });

  it('is gitignored-exception, and .env is gitignored', () => {
    expect(gitIgnored('.env.example')).toBe(false);
    expect(gitIgnored('.env')).toBe(true);
    expect(gitIgnored('.env.local')).toBe(true);
  });
});

describe('scanText', () => {
  // The fixtures are assembled rather than written out. The scan reads this file
  // like any other, so a literal key here would be a finding -- and the test that
  // proves the scan works would be the reason the scan fails. Building the string
  // keeps the end-to-end assertion real while leaving the repository clean.
  const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';
  const WX_KEY = '0123456789abcdef' + '0123456789abcdef';

  it('catches a planted AWS access key id', () => {
    const f = scanText(`const leaked = "${AWS_KEY}";`);
    expect(f.map((x: { rule: string }) => x.rule)).toContain('aws-access-key-id');
  });

  it('catches a registered key given a literal value', () => {
    const f = scanText(`OPENWEATHER_API_KEY='${WX_KEY}'`);
    expect(f.map((x: { rule: string }) => x.rule)).toContain('registry-key-value');
  });

  it('does not flag a source statement that mentions a registered key', () => {
    expect(scanText('const OPENWEATHER_API_KEY = buildKey(opts);\n')).toEqual([]);
  });

  it('accepts the empty template form', () => {
    expect(scanText('OPENWEATHER_API_KEY=\n')).toEqual([]);
  });

  it('accepts the provider source that merely holds the key', () => {
    const source = readFileSync(join(ROOT, 'src', 'Engine', 'src', 'systems', 'WeatherSystem.ts'), 'utf8');
    expect(scanText(source)).toEqual([]);
  });

  it('reports the line a finding came from', () => {
    const f = scanText(`line one\nline two\nconst k = "${AWS_KEY}";\n`);
    expect(f[0].line).toBe(3);
  });

  it('excludes only its own source, which holds the patterns', () => {
    expect(isSkippedPath('tools/secret-scan.mjs')).toBe(true);
    expect(isSkippedPath('tools/secret-keys.mjs')).toBe(false);
    expect(isSkippedPath('src/Engine/src/main.ts')).toBe(false);
  });
});

describe('scanRepo', () => {
  it('finds no credential material anywhere in the repository', () => {
    const { problems, scanned } = scanRepo(ROOT);
    expect(scanned).toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });
});
