/**
 * Proves the release pipeline produces what the release page promises.
 *
 * `docs/release-process.md` promised checksums for all artifacts, and nothing produced
 * any. The workflow uploaded the publish folder as a file tree rather than an archive,
 * published framework-dependent so the artifact needed a .NET runtime the recipient may
 * not have, and ran `npm install` where `npm ci` was meant -- which is free to resolve
 * something other than the lockfile that was tested.
 *
 * None of that fails. It produces a release that looks fine and is subtly wrong, which
 * is the worst shape of problem to find out about from a user's bug report. So the
 * claims are checked here, against the files that make them, with a self-test because a
 * gate that only ever passes is indistinguishable from a gate that cannot fail.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const read = (...parts) => readFileSync(resolve(ROOT, ...parts), 'utf8');

/**
 * Strips comments before a file is searched for a command.
 *
 * The reason this exists: the release workflow's comment explains that it used to run
 * `npm install`, and the check for `npm install` matched the sentence explaining why it
 * no longer does. A gate that reads its own documentation as evidence is worse than no
 * gate, because it reports a problem that does not exist and trains people to ignore it.
 *
 * Line comments only. A `#` inside a quoted string would be stripped too, which is a
 * trade this accepts: every shell command in these files is unquoted, and the check that
 * matters is whether the *command* uses the lockfile.
 */
const withoutComments = (text) => text.replace(/^\s*#.*$/gm, '');

export function releaseProblems(files) {
  const f = files ?? {
    RELEASE: read('tools', 'release.mjs'),
    CI: read('.github', 'workflows', 'ci.yml'),
    RELEASE_YML: read('.github', 'workflows', 'release.yml'),
    DOCS: read('docs', 'release-process.md'),
    GITIGNORE: read('.gitignore'),
    CSPROJ: read('src', 'AnomalyEngine', 'AnomalyEngine.csproj'),
  };
  const problems = [];

  // Workflow content with comments removed, so the prose explaining a past mistake is
  // not mistaken for the mistake itself.
  const releaseYml = withoutComments(f.RELEASE_YML);
  const ci = withoutComments(f.CI);

  // 1. One script, run from CI.
  //
  // The failure this prevents is the two drifting apart: a release built by hand and a
  // release built by CI, each with its own idea of what shipped, and only one of them
  // ever having been opened.
  if (!f.RELEASE.includes('npm-cli.js')) {
    problems.push(
      'tools/release.mjs does not invoke npm through its JavaScript entry point. On Windows ' +
        'the npm executable is a .cmd file and Node refuses to spawn one without shell: true, ' +
        'which this repository does not use'
    );
  }
  if (!/run\(process\.execPath/.test(f.RELEASE)) {
    problems.push('tools/release.mjs does not run npm with the current node binary.');
  }
  if (!/tools\/release\.mjs/.test(releaseYml)) {
    problems.push('release.yml does not call tools/release.mjs, so it builds releases its own way.');
  }

  // 2. The lockfile is used.
  if (!/\bnpm\(\['ci'\]\)|\bnpm\(\["ci"\]\)/.test(f.RELEASE)) {
    problems.push('the release does not run `npm ci`, so it can install something other than the lockfile.');
  }
  if (/npm (install|update)/.test(releaseYml)) {
    problems.push('release.yml uses `npm install` rather than `npm ci`.');
  }

  // 3. Self-contained.
  if (!/--self-contained/.test(f.RELEASE)) {
    problems.push('the publish is not self-contained, so the artifact needs a .NET runtime installed.');
  }
  if (!/--self-contained/.test(releaseYml) && /dotnet publish/.test(releaseYml)) {
    problems.push('release.yml publishes without --self-contained.');
  }

  // 4. An archive, not a tree.
  if (/publish\/\*\*/.test(releaseYml)) {
    problems.push(
      'release.yml uploads the publish folder as a file tree. A release page of several hundred ' +
        'loose files is not something anyone can unzip.'
    );
  }
  if (!/Compress-Archive/.test(f.RELEASE)) {
    problems.push('tools/release.mjs does not produce an archive.');
  }

  // 5. Checksums, which the release process document promised.
  if (!/SHA256SUMS/.test(f.RELEASE)) {
    problems.push('no checksum file is produced.');
  }
  if (!/SHA256SUMS/.test(releaseYml)) {
    problems.push('the checksum file is not uploaded to the release.');
  }
  if (!/Checksum/i.test(f.DOCS)) {
    problems.push('docs/release-process.md no longer mentions checksums, or never did.');
  }

  // 6. The artifact is checked, not assumed.
  //
  // A publish without a renderer is an application that starts and draws nothing, and it
  // is invisible in the zip's file list to anyone who has not run it. A self-contained
  // publish that is not actually self-contained is a few hundred kilobytes.
  for (const needle of [
    ['renderer/index.html', 'the published folder is never checked for a renderer'],
    ['renderer.bundle.sha256', 'the published bundle digest is never checked'],
    ['too small to be self-contained', 'the executable size is never checked'],
  ]) {
    if (!f.RELEASE.includes(needle[0])) problems.push(needle[1]);
  }

  // 7. The gates run before the publish, not instead of it.
  if (!/verify\.mjs/.test(f.RELEASE)) {
    problems.push('the release does not run the gate suite.');
  }

  // 8. The output is not committed.
  //
  // A 64MB zip in the repository is a 64MB zip in every clone, forever, and it is
  // replaced on every release.
  if (!/^dist\/?$/m.test(f.GITIGNORE)) {
    problems.push('dist/ is not ignored, so every release artifact would be committed.');
  }

  // 9. The version has one source.
  //
  // Two version literals drift, and the artifact name is built from one of them.
  const csprojVersion = /<Version>([^<]+)<\/Version>/.exec(f.CSPROJ)?.[1]?.trim();
  if (!csprojVersion) {
    problems.push('AnomalyEngine.csproj declares no version, so the artifact cannot be named.');
  }
  if (f.DOCS.includes('Update version in `AnomalyEngine.csproj` and `package.json`') &&
      !/package\.json/.test(f.RELEASE)) {
    problems.push(
      'the docs say the version lives in two files, but the release reads only one. ' +
        'Two literals drift.'
    );
  }

  return problems;
}

/* --------------------------------- self-test --------------------------------- */

if (process.argv.includes('--selftest')) {
  const base = {
    RELEASE: read('tools', 'release.mjs'),
    CI: read('.github', 'workflows', 'ci.yml'),
    RELEASE_YML: read('.github', 'workflows', 'release.yml'),
    DOCS: read('docs', 'release-process.md'),
    GITIGNORE: read('.gitignore'),
    CSPROJ: read('src', 'AnomalyEngine', 'AnomalyEngine.csproj'),
  };
  const cases = [];
  const record = (name, files, shouldFail) => {
    const problems = releaseProblems(files);
    const ok = (problems.length > 0) === shouldFail;
    cases.push({ name, ok, problems });
  };

  record('the repository as it stands is clean', base, false);

  record('npm install in place of npm ci is caught', {
    ...base,
    RELEASE: base.RELEASE.replace("npm(['ci'])", "npm(['install'])"),
  }, true);

  record('an npm install step in the workflow is caught', {
    ...base,
    RELEASE_YML: base.RELEASE_YML.replace(
      'run: node tools/release.mjs',
      'run: |\n          cd src/Engine\n          npm install\n          npm run build'
    ),
  }, true);

  record('a comment explaining a past mistake is not the mistake', {
    ...base,
    // The workflow's own comment says it used to run `npm install`. Reading that as
    // evidence would report a problem that does not exist.
    RELEASE_YML: base.RELEASE_YML.replace('npm install', 'npm ci'),
  }, false);

  record('a framework-dependent publish is caught', {
    ...base,
    RELEASE: base.RELEASE.replace('--self-contained', '--no-self-contained'),
  }, true);

  record('uploading the publish folder as a tree is caught', {
    ...base,
    RELEASE_YML: base.RELEASE_YML.replace('anomaly-engine-*-win-x64.zip', 'publish/**'),
  }, true);

  record('checksums promised but not uploaded is caught', {
    ...base,
    RELEASE_YML: base.RELEASE_YML.replace(/SHA256SUMS/g, 'nothing'),
  }, true);

  record('not checking the published renderer is caught', {
    ...base,
    RELEASE: base.RELEASE.replace(/renderer\/index\.html/g, 'nothing'),
  }, true);

  record('a committed dist folder is caught', {
    ...base,
    GITIGNORE: base.GITIGNORE.replace(/^dist\/?$/m, ''),
  }, true);

  record('the workflow building releases its own way is caught', {
    ...base,
    RELEASE_YML: base.RELEASE_YML.replace(/tools\/release\.mjs/g, 'dotnet publish'),
  }, true);

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) for (const p of c.problems) process.stdout.write(`        ${p}\n`);
  }
  process.stdout.write(
    failed ? `\n${failed} assertion(s) failed.\n` : '\nThe release check behaves.\n'
  );
  process.exit(failed ? 1 : 0);
}

/* ------------------------------- the repository ------------------------------ */

if (!existsSync(join(ROOT, 'tools', 'release.mjs'))) {
  console.error('FAIL  release: run this from the repository root.');
  process.exit(1);
}

const problems = releaseProblems();
if (problems.length) {
  console.error('FAIL  the release pipeline does not do what it claims:');
  for (const p of problems) console.error(`      ${p}`);
  process.exit(1);
}
console.log('PASS  the release produces a self-contained archive with checksums, and checks itself');