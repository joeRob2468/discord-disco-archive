# Discord Stream Recorder

Records each DJ's Go Live stream in a Discord voice channel as its own leveled audio file, and serves them in a web archive to browse, play and download.

Type `/record start` in a voice channel's chat. A bot follows who is streaming; a real Discord web client, logged in as a dedicated recorder account, plays each stream while ffmpeg records it. When a set ends it's trimmed, leveled to −14 LUFS and saved as FLAC and MP3, and it shows up in the archive.

> **ToS:** driving a user account with Playwright counts as a self-bot, which Discord forbids; the account can be banned. Use a throwaway recorder account, and tell people the event is recorded.

## Layout

```
apps/recorder/    bot, session rules, browser driver, capture, processing (Docker image)
apps/archive/     web archive: Hono + SQLite (Docker image)
packages/core/    session.json schema, file layout and naming, env parsing, logging
packages/media/   ffmpeg: capture, loudness, leveling, encodes
compose.yaml          both services (local)
compose.server.yaml   home server overlay (Traefik)
```

## Quick start

```sh
corepack enable
pnpm install
cp .env.example .env     # fill in the Discord IDs, tokens and passwords
pnpm check               # format, lint, typecheck, test

docker compose up --build
# log the recorder account in once at http://localhost:6080/vnc.html
```

## Docs

- [docs/status.md](docs/status.md): what works, what's next.
- [docs/design.md](docs/design.md): how it works, configuration, bot setup.
- [docs/operations.md](docs/operations.md): running the server and fixing problems (e.g. the recorder logged out).
- [docs/development.md](docs/development.md): scripts and local workflow.
- [docs/conventions.md](docs/conventions.md): code rules.
- [docs/research.md](docs/research.md): verified facts with sources.
