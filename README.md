# Discord Stream Recorder

Records each DJ's Go Live stream in a Discord voice channel as its own loudness-normalised file (optionally with video), and serves a web archive of past sessions, browsable by session and by streamer.

You start a session with `/record start` in a voice channel's chat. A Discord bot watches for streams starting and stopping. A real Discord web client, logged in as a dedicated recorder account and running headed on a virtual display, opens each stream while ffmpeg records its audio.

> **ToS:** driving a user account with Playwright counts as a "self-bot", which Discord forbids, and the account can be terminated. Use a throwaway recorder account. The bot account is a normal bot and is not at risk. Tell DJs and attendees they are being recorded.

**Status:** see [docs/status.md](docs/status.md).

## Repository layout

pnpm workspace. Each app is one container. Each package is shared code with no I/O side effects at import.

```
apps/
  recorder/   @dsr/recorder  Discord bot, session control, browser driver, live capture
  archive/    @dsr/archive   Web archive (Hono + SQLite): browse, search, play, download, admin edits
packages/
  core/       @dsr/core      session.json/state.json schemas, file layout and naming, env parsing, logging
  media/      @dsr/media     ffmpeg runner, two-pass loudnorm, export encodes
docs/         plan, research notes, development guide
compose.yaml          local / default deployment
compose.server.yaml   home server overlay (Traefik on media_network)
```

Dependencies only point one way: `apps/*` → `packages/*`, and `media` doesn't depend on `core`. The recorder is the only writer of the recordings volume; the archive mounts it read-only.

## Quick start

```sh
corepack enable          # uses the pnpm version pinned in package.json
pnpm install
cp .env.example .env     # fill in at least VNC_PASSWORD for the smoke test
pnpm check               # format, lint, typecheck, test

docker compose up --build recorder
# open http://localhost:6080/vnc.html and log in to Discord as the recorder account
```

See [docs/development.md](docs/development.md) for the full workflow, and [docs/plan.md](docs/plan.md) for the design.

## Docs

- [docs/plan.md](docs/plan.md): goals, architecture, commands, archive, deployment, configuration, milestones
- [docs/research.md](docs/research.md): confirmed facts with sources, open questions, rejected options
- [docs/status.md](docs/status.md): progress tracker, covering what's implemented and what's next
- [docs/development.md](docs/development.md): setup, scripts, Docker workflow, adding packages
- [docs/conventions.md](docs/conventions.md): architecture rules, code style, testing, security, git
