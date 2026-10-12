# Contributing to Anomaly Engine

Thank you for your interest in contributing. This document explains how to get involved and make this project better.

## Why Contribute?

Anomaly Engine is built on a simple idea: the desktop should feel alive. Every contribution — whether it's a new world, a bug fix, or a documentation improvement — helps make that idea real.

## Contribution Levels

Start where you're comfortable. Grow at your own pace.

| Level | Contribution | Skills Needed |
|-------|-------------|---------------|
| 1 | Documentation | Writing, attention to detail |
| 2 | World assets | Art, audio design |
| 3 | Events & anomalies | JSON, creative thinking |
| 4 | Integrations | API knowledge, TypeScript |
| 5 | Engine development | C#, TypeScript, systems design |

## Getting Started

1. **Fork the repository** — Click the fork button on GitHub
2. **Clone your fork** — `git clone https://github.com/YOUR_USERNAME/anomaly-engine.git`
3. **Create a branch** — `git checkout -b feature/your-feature-name`
4. **Make your changes** — Write code, create assets, fix bugs
5. **Test your changes** — from `src/Engine`: `npm test`, `npm run typecheck`,
   `npm run lint`. There is no `dotnet test`: the native host has no test project yet,
   so its checks live in `node tools/verify.mjs` (needs a Windows build first — see
   [`docs/setup-guide.md`](docs/setup-guide.md)) and in CI.
6. **Commit** — `git commit -m "feat: describe your change"`
7. **Push** — `git push origin feature/your-feature-name`
8. **Open a PR** — Fill out the pull request template

## Guidelines

### Code Style

- C#: 4-space indent. There is no formatter configured, so match the file you are in.
- TypeScript: 2-space indent, enforced by ESLint (`npm run lint`, which covers
  `tests/` as well as `src/`). There is no Prettier config and no Prettier
  dependency — an earlier version of this file listed it.
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, etc.)

### Pull Requests

- Describe what changed and why
- Reference related issues
- Include tests for new functionality
- Update documentation if needed
- No secrets or API keys
- Be respectful and constructive

### Issues

- Use the appropriate template (bug report, feature request, world submission, event proposal)
- Provide as much detail as possible
- Include logs and screenshots if relevant

## What Can I Contribute?

### Documentation

- Fix typos and unclear explanations
- Add examples and tutorials
- Translate documentation
- Improve the README

### World Assets

- Create sprites, textures, and animations
- Design ambient sounds and music
- Build new worlds
- Improve existing worlds

### Events & Anomalies

- Propose new events
- Design new anomalies
- Write lore and secrets
- Balance rarity and cooldowns

### Integrations

- Add new weather providers
- Support new RSS formats
- Build new API adapters
- Improve error handling

### Engine Development

- Fix bugs and performance issues
- Add new features
- Improve architecture
- Write tests

## Need Help?

- Open an [issue](https://github.com/realizations/anomaly-engine/issues) for bugs or feature requests
- Check the [discussions](https://github.com/realizations/anomaly-engine/discussions) for general questions
- Read the [documentation](docs/) for technical details

## Code of Conduct

Be kind. Be respectful. Be constructive.

We are committed to providing a welcoming and harassment-free experience for everyone. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

<p align="center">
  <sub>Thank you for helping make the desktop alive.</sub>
</p>
