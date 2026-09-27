# Security

## Trust Model

Anomaly Engine treats all downloaded content as untrusted:

- **World packages** — validated, sandboxed, no native code execution
- **Remote event data** — schema-validated, HTTPS-only, no code execution
- **Assets** — type-validated, size-limited

## World Package Security

### Validation

- Manifest schema validation
- Required file existence checks
- Asset type verification (MIME + extension)
- Path traversal protection
- File size limits (configurable, default 50MB per asset)

### Sandboxing

- No `eval()` or `Function()` constructor
- No native API access
- No file system access outside the world directory
- Network requests proxied through the engine

### Safe Extraction

- ZIP Slip protection
- Symlink rejection
- Maximum compression ratio check
- Maximum file count limit

## Remote Event Security

- HTTPS required (no HTTP)
- Schema validation before processing
- Exponential backoff on failures
- Timeout limits
- Never executes downloaded code
- Signed events (opt-in)

## Privacy

- No telemetry by default
- No accounts required
- No personal data collection
- No background tracking
- All data stays local

## Reporting

See `SECURITY.md` for the security policy and reporting process.
