# Release Process

## Versioning

Anomaly Engine uses [Semantic Versioning](https://semver.org/):

- MAJOR: breaking changes
- MINOR: new features
- PATCH: bug fixes

## Release Checklist

1. Update `CHANGELOG.md`
2. Update version in `AnomalyEngine.csproj` and `package.json`
3. Run full test suite
4. Build release binaries
5. Create installer
6. Generate checksums
7. Create GitHub release
8. Tag the release

## GitHub Actions

Releases are automated via GitHub Actions:

- `ci.yml` — build + test on every push
- `release.yml` — build + package + publish on tag

## Signing

Releases are signed where practical:

- Authenticode signing for the native host
- Checksums for all artifacts
- Signed git tags
