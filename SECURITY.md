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

## Scope

- Path traversal in world package extraction
- Malformed or malicious world manifests
- Remote event feed injection
- WebView2 sandbox escapes
- Native host privilege escalation
