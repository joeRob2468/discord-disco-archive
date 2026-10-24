# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo.

## What this is

Records Discord Go Live DJ sets (one leveled file per set) and serves them in a web archive. A pnpm monorepo in TypeScript on Node 24, deployed with Docker on the home server.

- `apps/recorder`: bot (`/record`), session rules, Firefox driven by Playwright on Xvfb, PulseAudio + ffmpeg capture, processing.
- `apps/archive`: Hono + SQLite web archive (browse, play, download, admin).
- `packages/core`: `session.json` schema, layout and naming, env parsing, logger.
- `packages/media`: ffmpeg capture, loudness, leveling, encodes.

## Read first

1. `docs/status.md`: what works, what's next. Keep it current.
2. `docs/design.md`: how it works and its configuration.
3. `docs/conventions.md`: code rules. **Follow it.**
4. `docs/operations.md`: the server runbook. Keep it current when behaviour it describes changes.
5. `docs/research.md`: verified facts. Check it before re-researching anything.
6. `docs/development.md`: scripts and local workflow.

## Commands

```sh
pnpm check                               # format:check + lint + typecheck + test; must pass before committing
pnpm test / pnpm lint:fix / pnpm format
pnpm --filter @dsr/archive dev           # archive on :3000 using ./.env
```

## Working rules

- **Ask before anything remote:** network requests, web lookups, package installs, Docker pulls, SSH to the server, pushing, publishing. Local edits, local scripts and local commits are fine. Describe major changes (features, behaviour or scope changes, deletions, restructuring) and get a yes first.
- **Commits:** Conventional Commits (`feat(archive): …`), one per logical change, **no AI attribution or Co-Authored-By trailers**.
- **Config:** everything goes in `.env` (documented in `.env.example` and design.md). Never commit or print secrets.
- **Deploy:** the home server, in `~/.services/discord-stream-recorder`, behind its Traefik on `media_network`; update with `git pull` + `docker compose up -d --build` there (see operations.md). Docs use placeholders (`<server>`, `example.com`), not real hosts.
- **Pinned versions:** `playwright` must equal the Docker image tag (`apps/recorder/Dockerfile`). TypeScript stays on 6.0.x until typescript-eslint supports 7.
- **Work in stages:** one change at a time; stop for the user to test. Don't build ahead.
- **Docs describe the current state**, briefly: update status.md, design.md or research.md in the same commit as the change. No history or dated decision logs.
