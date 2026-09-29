# Contributing

MAPS is proprietary software. Copyright © 2026 Llewellyn E. van Zyl and Psynalytics B.V. All rights reserved.

## Who may contribute

Contributions are accepted only from collaborators invited by the owner. Unsolicited pull requests, including pull requests from forks, are closed without review. Access to this repository, or the ability to fork it on GitHub, grants no licence of any kind; see [LICENSE](LICENSE).

## How changes reach `main`

Nothing is pushed to `main` directly. Every change, including a collaborator's, goes through a pull request that:

1. is approved by the code owner (@llewellynvz), as required by [CODEOWNERS](.github/CODEOWNERS);
2. passes the required checks (`verify`: typecheck, lint, tests, and dependency audit; `secrets`: full-history secret scan);
3. has every review thread resolved, and is re-approved after any new push;
4. includes a [CHANGELOG](CHANGELOG.md) entry under `[Unreleased]` when it changes product code.

These rules are enforced by the repository ruleset in [.github/rulesets/protect-main.json](.github/rulesets/protect-main.json). See [docs/REPOSITORY_GOVERNANCE.md](docs/REPOSITORY_GOVERNANCE.md).

## Local checks before opening a pull request

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

By submitting a contribution you agree to the terms in section 7 of the [LICENSE](LICENSE).
