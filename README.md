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

## Day to day

### In Discord

| Command                                  | Use                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `/record start [title]`                  | Start recording the voice channel you're in (or whose chat you type in).  |
| `/record stop`                           | Stop; the last set is leveled and the session closes.                     |
| `/record resume [session]`               | Carry on an earlier session of the channel instead of starting a new one. |
| `/record switch <user>`                  | Record someone else who is live now (or retry the current DJ's stream).   |
| `/record split [name] [previous]`        | DJs sharing one stream: end the set here and start the next DJ's.         |
| `/record title <text>`, `/record status` | Rename the session; see who's recorded and who's live.                    |
| `/record check`                          | Before an event: start the recorder and check it's logged in.             |

The recorder posts in the channel's chat as it goes: 🔇 when a stream goes quiet, ⚠️ when something needs a look, 🔁 when it carried on after a restart. What each one means and what to do: [operations.md](docs/operations.md).

### In the archive (as admin)

Edit a set, session or DJ (names, titles, art), reorder or archive sets, **Add set…** on a session to upload a set that wasn't recorded, and Admin → Overview / Activity for storage, stuck sets and every change.

### On the server

```sh
ssh <server>
cd ~/.services/discord-stream-recorder

git pull && docker compose up -d --build   # deploy (a live session carries on after ~20 s)
docker compose ps                          # both running, archive "healthy"
docker compose logs -f recorder            # or archive; JSON (pipe through pnpm dlx pino-pretty)
docker compose restart recorder            # if it's stuck; it resumes its session

# Re-level a session's stuck or failed sets (add --all to re-level everything)
docker compose exec recorder node --import tsx src/reprocess.ts /recordings/<session folder>

# Recorder account logged out: /record check (starts its browser), then open noVNC
# over a tunnel and log in by hand
ssh -L 6080:localhost:6080 <server>        # then http://localhost:6080/vnc.html
```

Screenshots of failed stream opens and silent streams: `APP_DATA_DIR/recorder/screenshots/`.

### Developing

```sh
pnpm check                          # format, lint, typecheck, test: before every commit
pnpm test:watch
pnpm lint:fix && pnpm format
pnpm --filter @dsr/archive dev      # archive on http://localhost:3000 with ./.env, live reload
```

The recorder only runs in its container (Xvfb, PulseAudio), and only one recorder may use the Discord account: keep the local one stopped while the server runs. More in [development.md](docs/development.md).

## Docs

- [docs/status.md](docs/status.md): what works, what's next.
- [docs/design.md](docs/design.md): how it works, configuration, bot setup.
- [docs/operations.md](docs/operations.md): running the server and fixing problems (e.g. the recorder logged out).
- [docs/development.md](docs/development.md): scripts and local workflow.
- [docs/conventions.md](docs/conventions.md): code rules.
- [docs/research.md](docs/research.md): verified facts with sources.

## License

[MIT](LICENSE). It covers this code only: running the recorder still means automating a Discord user account, which Discord's terms forbid (see the ToS note above).
