# Contributing

## Getting Started

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run the checks, all from `src/Engine`:

   ```
   npm test          # 393 unit tests
   npm run typecheck # src/, then src/ + tests/ together
   npm run lint      # src/ and tests/
   ```

   `node tools/verify.mjs` from the repository root runs everything else, including
   the licence, secret, host-event and dead-code gates. It needs a deployed Windows
   build first: `dotnet build src\AnomalyEngine`.
5. Submit a pull request

## Contribution Levels

| Level | Contribution |
|-------|-------------|
| 1 | Documentation |
| 2 | World assets |
| 3 | Events |
| 4 | Integrations |
| 5 | Engine development |

## Code Style

- C#: 4-space indent. No formatter is configured, so match the surrounding file.
- TypeScript: 2-space indent, ESLint over both `src/` and `tests/`. There is no
  Prettier config or dependency in this repository.
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, etc.)

## Pull Requests

- Describe what changed and why
- Reference related issues
- Include tests for new functionality
- Update documentation if needed
- No secrets or API keys

## Code of Conduct

See `CODE_OF_CONDUCT.md`.
