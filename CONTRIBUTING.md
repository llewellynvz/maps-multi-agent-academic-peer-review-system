# Contributing

MAPS is licensed under the PolyForm Strict License 1.0.0 with additional terms. Copyright © 2026 Llewellyn E. van Zyl and Psynalytics B.V.

## Who may contribute

Contributions are accepted only from collaborators invited by the owner. Unsolicited pull requests, including pull requests from forks, are closed without review. Access to this repository, or a fork of it on GitHub, grants no rights beyond those in [LICENSE](LICENSE).

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

## Names that must not change

MAPS was renamed from MARA. These identifiers keep their old names, because changing them breaks existing installations:

- the key-vault salt `mara-master-key-derivation` in `server/src/security/vault.ts` (stored provider keys would stop decrypting)
- the ingest store id `mara-ingest-storage`
- the session cookie `mara_session`

Legacy `MARA_*` environment variables are still honoured through `server/src/env-aliases.ts`, and `mapsDbPath()` falls back to an existing `data/mara.db`.

By submitting a contribution you agree to term A5 of the [LICENSE](LICENSE).
