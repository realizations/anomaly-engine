# Release Process

## Versioning

Anomaly Engine uses [Semantic Versioning](https://semver.org/):

- MAJOR: breaking changes
- MINOR: new features
- PATCH: bug fixes

The version lives in **one** place: `<Version>` in `src/AnomalyEngine/AnomalyEngine.csproj`.
The artifact name is built from it, so a release cannot claim to be one version and ship
another. `package.json` has no version field to keep in step — that is deliberate, because
two version literals drift and the one that drifts is the one in the artifact filename.

## Building a release

```bash
node tools/release.mjs
```

That is the whole process. It:

1. Installs dependencies with `npm ci`, from the lockfile.
2. Typechecks, lints and runs the unit tests.
3. Runs the full gate suite — 38 steps, including the visual, per-monitor, persistence
   and host-event checks.
4. Publishes **self-contained and single-file**, so the artifact runs on a machine with no
   .NET runtime installed.
5. Checks the published output: the renderer is present, the bundle digest recorded at
   build time still matches what was actually published, and the executable is large
   enough to contain a runtime.
6. Writes `START-HERE.txt`, zips the folder, and writes `SHA256SUMS`.

Useful flags:

| Flag | Why |
| --- | --- |
| `--skip-verify` | Skips the gate suite. For a local look at the packaging, not for a release. |
| `--out <dir>` | Puts the output somewhere other than `dist/`. |

Output lands in `dist/`, which is git-ignored. The publish folder is left beside the
archive so it can be inspected; it is not part of the artifact.

### Why self-contained

The previous workflow published framework-dependent. The artifact then required a .NET
runtime on the recipient's machine, which most people downloading a wallpaper will not
have, and the release would have failed on first launch with an error that says nothing
about what went wrong. The check that catches a regression here is a size check: a
framework-dependent single file is a few hundred kilobytes, and anything under 5 MB is
not carrying a runtime.

### Why an archive

Releases used to upload the publish folder as a file tree. That is several hundred loose
files on a release page, which cannot be unzipped, un-installed or checksummed as a thing.
The archive is the artifact; the folder is a staging area.

## Release Checklist

1. Update `CHANGELOG.md`
2. Update `<Version>` in `src/AnomalyEngine/AnomalyEngine.csproj`
3. `node tools/release.mjs` — must be green
4. Tag: `git tag v0.1.0 && git push --tags`
5. CI builds and attaches `anomaly-engine-<version>-win-x64.zip` and `SHA256SUMS`

## GitHub Actions

- `ci.yml` — typecheck, lint, unit tests and every gate on every push.
- `release.yml` — runs `tools/release.mjs` on a `v*` tag and attaches the archive and its
  checksums.

Both call the same scripts a developer runs locally. Neither reimplements a build step.

## Signing

- **Authenticode: not done.** A release zip is unsigned, so Windows SmartScreen will
  warn on first launch, and there is no way around that without a code-signing
  certificate. This is stated rather than left to be discovered, because a user who hits
  the warning has no way to tell whether it means anything.
- **Checksums: done.** `SHA256SUMS` accompanies every artifact.
- **Signed git tags: not done.**

`tools/verify-release.mjs` asserts each of the claims on this page against the files that
make them, so this document and the pipeline cannot quietly disagree.