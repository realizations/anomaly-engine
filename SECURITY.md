# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

Please report security vulnerabilities by opening a security advisory on GitHub.
Do not open public issues for security problems.

## Trust Model

- **World packages** are treated as untrusted. They are validated, sandboxed,
  and never execute native code.
- **Remote event data** is validated against schemas, fetched over HTTPS only,
  and never executed as code.
- **No arbitrary code execution** is permitted from downloaded content.
- **No telemetry** is collected by default. No accounts required.

## Secrets and API Keys

No credential is required to run Anomaly Engine, and none is committed.

- `.env` holds real keys and is gitignored. `.env.example` is the tracked
  template and must always be empty.
- Every credential the project knows how to use is declared once, in
  `tools/secret-keys.mjs`. The template, the scan and the tests all derive from
  that table, so a new provider is one entry.
- `node tools/secret-scan.mjs` reads every tracked file and fails the build on
  credential material: provider key formats, PEM private key blocks, JWTs, and
  long literals assigned to credential-shaped names. `--selftest` proves it
  catches planted keys. Both run in `node tools/verify.mjs`.
- The engine does not read `.env` today. Keys would be supplied to the native
  host, never baked into the renderer bundle, which is what `git add`s end up
  publishing.

**If a key is committed anyway**, treat it as public: revoke and rotate it at the
provider first, then remove it from history. Deleting the file from the working
tree does not remove it from the commit.

## Scope

- Path traversal in world package extraction
- Malformed or malicious world manifests
- Remote event feed injection
- WebView2 sandbox escapes
- Native host privilege escalation
- Credential material in the repository
