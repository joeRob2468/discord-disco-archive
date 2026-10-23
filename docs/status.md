# Status

Progress tracker: what exists, where it lives, what's been verified, and what's next. Update it with every milestone. The design is in [plan.md](plan.md#milestones).

_Last updated: 2026-10-23 (session 2)_

## Branches

| Branch         | Contents                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `main`         | Scaffolding, storage layout, docs. Work proceeds here milestone by milestone.                                                    |
| `feat/archive` | The archive site (milestone 7), built early. **Not merged.** Merge it once milestone 5 produces real recordings to test against. |

## Milestones

| #   | Milestone             | State                | Notes                                                                                                                                                                                                                               |
| --- | --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Workspace scaffolding | ✅ done              | pnpm monorepo, tooling, `pnpm check` green.                                                                                                                                                                                         |
| —   | Storage layout        | ✅ done              | `/config` (app data) + `/recordings`; see plan.md "Storage layout".                                                                                                                                                                 |
| 1   | Container smoke test  | ✅ done              | Container starts cleanly. Chrome → PulseAudio → ffmpeg verified with a test tone. Recorder account logged in over noVNC; login survives restarts and container recreation.                                                          |
| 2   | Manual stream capture | ✅ done              | Stream audio captured; with the streamer's user volume at 0%, no voice leaks (user confirmed by listening). Stream volume defaults to 50% and must be set to 100%. Details in research.md.                                          |
| 3   | Event bot (`/record`) | ✅ done              | Tested in Discord: start/stop/status/switch/title, handover on stream end, 🔴/🔀/⏸️ announcements. The recorder account's own streams are ignored. Run with `pnpm --filter @dsr/recorder dev`.                                      |
| 4   | Automated watch       | 🚧 in progress       | **Discord UI prototype done** (`discord-web.ts` + `probe.ts`): join muted and deafened, open a stream by user ID, unmute, volume 100%, level check. Verified live. Next: wire to `/record` in `main.ts`, capture, silence handover. |
| 5   | Post-processing       | ⬜                   | `@dsr/media` loudnorm/encode helpers exist and are unit-tested, but have never run on real audio.                                                                                                                                   |
| 6   | Video                 | ⬜                   |                                                                                                                                                                                                                                     |
| 7   | Archive site          | 🧪 on `feat/archive` | Browse, search (FTS5), players, downloads, admin edits and hiding, activity log. 48 tests against fixtures; one local run against sample data. Not tested against real recordings or in Docker.                                     |
| 8   | Deploy to home server | ⬜                   |                                                                                                                                                                                                                                     |
| 9   | Hardening             | ⬜                   |                                                                                                                                                                                                                                     |

## Implemented on `main`

| Area            | What                                                                                                                                                   | Verified by                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `@dsr/core`     | Session/state schemas, naming, layout, atomic JSON, env parsing, logger                                                                                | unit tests                                                                          |
| `@dsr/media`    | `runFfmpeg`, `spawnFfmpeg` (stop with `q`), loudnorm measurement and filters, encode helpers                                                           | unit tests (parsing and filter strings only)                                        |
| `@dsr/recorder` | Config sections, `launchBrowser`, `smoke.ts`, Docker image, entrypoint, minimal PulseAudio config; bot (`src/bot/`) and session logic (`src/session/`) | unit tests; image built and run (milestone 1); bot connects and registers `/record` |
| `@dsr/archive`  | Health check only (the full site is on `feat/archive`)                                                                                                 | unit test                                                                           |
| Deploy          | `compose.yaml`, `compose.server.yaml` (Traefik labels)                                                                                                 | not run                                                                             |

## Next: milestone 4 (automated watch)

Agreed approach. **Prototype the Discord UI automation first**, against a live test channel with the user streaming, before writing the full controller.

**Prototype: done and verified (2026-10-23).** `src/browser/discord-web.ts` holds every selector, and `src/probe.ts` runs the steps against a live channel and saves page state after each (see development.md). The seventh run passed all steps; findings are in research.md, "Discord web client automation". What the controller needs from it:

- Pass the session's channel ID and the target's **user ID**; tiles are matched by user ID, so display names and usernames don't matter.
- Call `unmuteStream` before `setStreamVolume` every time a stream opens. Discord remembers a stream mute per streamer.
- Run the probe in the container without a rebuild by bind-mounting `apps/recorder/src` and `packages/media/src` (command in development.md).

1. **One process:** `main.ts` runs the bot and the browser together in the recorder container, replacing `smoke.ts` as the container `CMD`. The bot currently runs on the WSL host via `pnpm --filter @dsr/recorder dev`.
2. **Join on `/record start`:** open `discord.com/channels/<guild>/<channel>`, join voice, self-mute and **self-deafen** (deafen keeps stream audio). If it fails, report in the channel.
3. **Open the target's stream** on each target change: click their stream tile and **set the stream volume to 100%** (it defaults to 50%). Confirm audio is flowing.
4. **Capture:** start or stop ffmpeg per set with `@dsr/media`'s `spawnFfmpeg`, writing to `data/recordings/<date>_<title>/raw/<timestamp>_<dj>.wav` (`pcm_f32le`). Write a minimal `session.json`. Leveling is milestone 5.
5. **Silence handover:** measure the live level (e.g. ffmpeg `astats`/`silencedetect` on the capture) and call `SessionManager.targetSilent()` after `HANDOVER_SILENCE_SECONDS` (add the key to `config.ts`; it's already in `.env.example`).
6. **Leave** voice on `/record stop`.

The riskiest step is 3 (Discord DOM selectors). Keep the selectors in one module, `src/browser/discord-web.ts`.

## Dev environment state (end of session 1)

- `.env` is filled in: bot token, guild ID, recorder user ID, `COMMAND_DEFAULT_PERMISSION=Everyone`, a generated `VNC_PASSWORD`, `PUID`/`PGID` 1000. Never print it.
- The recorder account ("Recorder Account") is logged in. The profile is in `docker-data/recorder/profile`.
- The bot application is "Recorder Bot" (private), invited with View Channels + Send Messages. Test server: the user's; test voice channel: "Test Room".
- The server's inactive timeout is disabled. Any AFK bot still needs a recorder exemption before a real event.
- Test captures from milestone 2: `data/recordings/_tests/`.
- `feat/archive` branches from `9e6c284`; rebase it onto `main` at milestone 7. Its archive `dev` script also needed the root `tsx` fix, which `main` now has.

## Open questions blocking upcoming milestones

See the "Unverified / to test" table in [research.md](research.md). The most relevant to the next milestones:

- The recorder isolates voice by self-deafening (streams still play); AFK timeout/bot must exempt it.
- Overlapping streams: one recorder plus handover rules (plan.md, "Which stream to record"); every switch is announced.
- The controller must set the stream volume slider to 100% (it defaults to 50%).
- The `--no-sandbox` info bar in Chrome; it matters for video (milestone 6).
