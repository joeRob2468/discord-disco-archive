# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo.

## What this is

A tool that records Discord Go Live DJ sets (one file per streamer, loudness-normalised, optionally with video), plus a web archive to browse, search, play and edit them. It's a pnpm monorepo in TypeScript on Node 24.

- `apps/recorder`: Discord bot (`/record`), session control, Playwright-driven Discord web client on Xvfb, and PulseAudio + ffmpeg capture. A Docker image.
- `apps/archive`: Hono + SQLite web archive (browse, search, admin edits). A Docker image. The full site is on the `feat/archive` branch; see docs/status.md.
- `packages/core`: `session.json`/`state.json` schemas, layout and naming, env parsing, logger.
- `packages/media`: ffmpeg runner, two-pass loudnorm, encodes.

## Read first

1. `docs/status.md`: **what's implemented, on which branch, what's verified, what's next.** Keep it current.
2. `docs/plan.md`: design and milestones.
3. `docs/conventions.md`: architecture rules, TypeScript and style, testing, security, git. **Follow it.**
4. `docs/research.md`: verified facts with sources, plus open questions. Check it before re-researching anything.
5. `docs/development.md`: setup, scripts, Docker workflow.
6. `docs/operations.md`: the server runbook (deploy, access, troubleshooting). Keep it current when behaviour it describes changes.

## Commands

```sh
pnpm install
pnpm check                               # format:check + lint + typecheck + test; must pass before committing
pnpm test / pnpm lint:fix / pnpm format
pnpm --filter @dsr/archive dev           # archive on :3000 using ./.env
docker compose up --build recorder       # milestone 1 smoke test (noVNC on 127.0.0.1:6080)
```

## Working rules

- **Ask before anything remote:** network requests, web lookups, package installs, Docker pulls, SSH to the home server, pushing, publishing. Local edits, local scripts and local commits are fine. Describe major changes (features, behaviour or scope changes, deletions, restructuring) and get a yes first.
- **Commits:** Conventional Commits (`feat(archive): …`), one per logical change, **no AI attribution or Co-Authored-By trailers**.
- **Config:** everything goes in `.env` (documented in `.env.example` and the plan's config table). Never commit or print secrets.
- **Deploy target:** the home server ("<server>"), behind its Traefik on `media_network`, with storage under `/mnt/media/docker_data/…` (app state) and `/mnt/media/data/…` (media). Its stack repo is separate. Docs use placeholders (`example.com`), not real hosts.
- **Pinned versions:** `playwright` must equal the Docker image tag (`apps/recorder/Dockerfile`). TypeScript stays on 6.0.x until typescript-eslint supports 7.
- **Work in stages.** One milestone at a time; stop after each for the user to test. Don't build ahead.
- **When something is verified or decided,** update `docs/status.md` and `docs/plan.md`/`docs/research.md` in the same commit.
