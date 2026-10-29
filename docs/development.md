# Development

## Requirements

- Node 24 (`.nvmrc`) and pnpm through Corepack (`corepack enable`; version pinned in `package.json`).
- Docker with Compose v2.24+ (the server overlay uses `!reset`).
- ffmpeg on the host only if you run media code outside Docker.

## Scripts (repo root)

| Script                          | What it does                                                             |
| ------------------------------- | ------------------------------------------------------------------------ |
| `pnpm check`                    | `format:check`, `lint`, `typecheck` and `test`: run before every commit. |
| `pnpm test` / `pnpm test:watch` | Vitest across all packages.                                              |
| `pnpm lint:fix` / `pnpm format` | ESLint fixes, Prettier.                                                  |

Per app:

| Command                                                          | What it does                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @dsr/archive dev`                                 | Archive on http://localhost:3000 with `./.env`, watching code, CSS and the client scripts. Data: `./docker-data/archive`, `./data/recordings`. |
| `pnpm --filter @dsr/recorder reprocess <session folder> [--all]` | Re-level a session's `processing`/`failed` sets (or all). Needs ffmpeg, so run it in the container (see operations.md).                        |
| `pnpm --filter @dsr/recorder backfill-avatars`                   | Save DJs' Discord avatar URLs on sets recorded before avatars were (one-time; see operations.md).                                              |
| `pnpm --filter @dsr/recorder smoke`                              | Open Discord with the recorder's profile and stay up, e.g. to log in. Container only.                                                          |
| `pnpm --filter @dsr/recorder probe <channel URL> <user ID>`      | Run each browser step against a live channel and save page state, for fixing selectors. Container only.                                        |

## Docker

```sh
docker compose up --build          # recorder + archive (archive on :3000, noVNC on 127.0.0.1:6080)
docker compose logs -f recorder | pnpm dlx pino-pretty
```

The recorder needs Xvfb and PulseAudio, so it only runs in its container. Log the recorder account in once over noVNC (`http://localhost:6080/vnc.html`). Only one recorder may use the account at a time: keep the local one stopped while the server runs.

## Adding a workspace package

1. `packages/<name>/package.json` (`"name": "@dsr/<name>"`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`, a `typecheck` script) and a `tsconfig.json` extending `../../tsconfig.base.json`.
2. Add `"@dsr/<name>": "workspace:*"` to the apps that use it, then `pnpm install`.
3. Add its `package.json` and `src` `COPY` lines to those apps' Dockerfiles.

## Dependency versions

- `playwright` is pinned to the Docker image tag (`apps/recorder/Dockerfile`); bump both together.
- Everything else uses caret ranges with the lockfile committed; Docker builds use `--frozen-lockfile`.
