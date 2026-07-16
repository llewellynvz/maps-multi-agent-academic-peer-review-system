# Review exemplars

Voice benchmarks. Drop two or three past review letters here as `.md` files and the report writer reads them before drafting, matching their register rather than the mined default alone.

The contents of this folder are gitignored. Past reviews are confidential third-party material and never enter the repository, a search query, or an event payload. Only this README is tracked.

When the folder holds no letters, the writer falls back to the mined default voice in `knowledge/06_WRITING_CRAFT.md`. That fallback is the normal shipping state, not a degraded one.

Loader: `readExemplars` in `server/src/prompts/knowledge.ts`, wired into the static frame for any agent whose manifest sets `"exemplars": true`. Files named `README.md` are skipped, and empty files are ignored.
