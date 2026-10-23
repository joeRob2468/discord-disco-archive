# Development

## Requirements

- Node 24 (`.nvmrc`). The Playwright Docker image also ships Node 24.
- pnpm through Corepack: `corepack enable`. The exact version is pinned in `package.json` (`packageManager`).
- Docker with Compose v2.24+ (the server overlay uses `!reset`).
- ffmpeg on the host, only if you run media code outside Docker.

## Scripts (repo root)

| Script                              | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm check`                        | Everything CI would run: `format:check`, `lint`, `typecheck`, `test`.  |
| `pnpm typecheck`                    | `tsc` in every workspace package (no emit).                            |
| `pnpm lint` / `pnpm lint:fix`       | ESLint with typescript-eslint strict and stylistic type-checked rules. |
| `pnpm format` / `pnpm format:check` | Prettier.                                                              |
| `pnpm test` / `pnpm test:watch`     | Vitest across all packages (`*/src/**/*.test.ts`).                     |

Per app:

| Command                                                                            | What it does                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @dsr/recorder smoke`                                                | Launch the browser with the persistent profile and open Discord, for logging in. Needs a display and PulseAudio, so run it in the container.                                                                                            |
| `pnpm --filter @dsr/recorder probe <voice channel URL> <user ID> ["display name"]` | Milestone 4 prototype: join the channel muted and deafened, open that person's stream, set its volume to 100% and measure the level. Saves page state per step to `docker-data/recorder/probe/`. Run it in the container.               |
| `pnpm --filter @dsr/recorder reprocess <session folder> [--all]`                   | Re-run leveling and exports for a session (sets left `processing` or `failed`, or all). Needs ffmpeg, so run it in the container: `docker compose run --rm --no-deps recorder node --import tsx src/reprocess.ts /recordings/<folder>`. |
| `pnpm --filter @dsr/archive build:css`                                             | Build the archive's stylesheet (`apps/archive/dist/app.css`) from `src/views/app.css` with Tailwind + daisyUI. `dev` runs it in watch mode.                                                                                             |
| `pnpm --filter @dsr/archive dev`                                                   | Archive with `--watch`, run from the repo root with `./.env` if present. Data defaults to `./docker-data/archive` and `./data/recordings`.                                                                                              |

## Running in Docker

```sh
cp .env.example .env
docker compose up --build recorder     # bot + browser + capture (src/main.ts)
docker compose up --build archive      # http://localhost:3000/healthz
```

To run the milestone 4 probe against a live channel (someone must be streaming there), without rebuilding the image:

```sh
docker compose stop recorder   # the probe needs the browser profile to itself
docker compose run --rm --service-ports \
  -v ./apps/recorder/src:/app/apps/recorder/src \
  -v ./packages/media/src:/app/packages/media/src \
  recorder node --import tsx src/probe.ts \
  https://discord.com/channels/<guild>/<voice channel> <streamer user ID> "<display name>"
```

Ctrl+C makes it leave voice and close the browser. Page state for each step is saved in `docker-data/recorder/probe/<run>/`.

noVNC is at `http://localhost:${VNC_PORT}/vnc.html`, bound to `127.0.0.1` only. On the home server, use `ssh -L 6080:localhost:6080 <server>` and open the same URL locally.

Logs are JSON (pino). To make them readable: `docker compose logs -f recorder | pnpm dlx pino-pretty`.

## Code organisation and style

Architecture rules, TypeScript conventions, style, testing, security and git conventions are in [conventions.md](conventions.md).

## Adding a workspace package

1. `packages/<name>/package.json` with `"name": "@dsr/<name>"`, `"private": true`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`, and a `typecheck` script.
2. `packages/<name>/tsconfig.json` extending `../../tsconfig.base.json`.
3. Add it to the dependents with `"@dsr/<name>": "workspace:*"`, then run `pnpm install`.
4. Add its `package.json` and `src` `COPY` lines to the Dockerfile of every app that uses it.

## Dependency versions

- Exact pins: `playwright` must match the Docker image tag (`mcr.microsoft.com/playwright:v1.64.1-noble`); bump both together.
- Everything else uses caret ranges, with the lockfile committed. Docker builds use `--frozen-lockfile`.
