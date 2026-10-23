# Status

Progress tracker: what exists, where it lives, what's been verified, and what's next. Update it with every milestone. The design is in [plan.md](plan.md#milestones).

_Last updated: 2026-10-23 (session 2)_

## Branches

| Branch         | Contents                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| `main`         | Scaffolding, storage layout, docs. Work proceeds here milestone by milestone.    |
| `feat/archive` | Merged into `main` (fast-forward, after a rebase) on 2026-10-23; can be deleted. |

## Milestones

| #   | Milestone             | State              | Notes                                                                                                                                                                                                                                                                                         |
| --- | --------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Workspace scaffolding | ✅ done            | pnpm monorepo, tooling, `pnpm check` green.                                                                                                                                                                                                                                                   |
| —   | Storage layout        | ✅ done            | `/config` (app data) + `/recordings`; see plan.md "Storage layout".                                                                                                                                                                                                                           |
| 1   | Container smoke test  | ✅ done            | Container starts cleanly. Chrome → PulseAudio → ffmpeg verified with a test tone. Recorder account logged in over noVNC; login survives restarts and container recreation.                                                                                                                    |
| 2   | Manual stream capture | ✅ done            | Stream audio captured; with the streamer's user volume at 0%, no voice leaks (user confirmed by listening). Stream volume defaults to 50% and must be set to 100%. Details in research.md.                                                                                                    |
| 3   | Event bot (`/record`) | ✅ done            | Tested in Discord: start/stop/status/switch/title, handover on stream end, 🔴/🔀/⏸️ announcements. The recorder account's own streams are ignored. Run with `pnpm --filter @dsr/recorder dev`.                                                                                                |
| 4   | Automated watch       | 🧪 user testing    | `/record` drives the browser and capture: join muted and deafened, open streams by user ID, 85% volume, float32 WAV per set, `session.json`, handover on stream end and on 45 s of silence. Verified live on WSL. Dev-only issue: WSL2 clock drift drops about 6% of the audio (research.md). |
| 5   | Post-processing       | ✅ done            | After each set: trim ends, loudnorm measurement, fixed gain + oversampled true-peak limiter into a FLAC master, MP3 + M4A, `ready`/`failed`, `setlist.csv`. Verified live: sets processed within ~10 s of ending, all at −14.0 LUFS. `reprocess.ts` re-runs a session.                        |
| 6   | Video                 | ⏸️ deferred        | Tabled on 2026-10-23 as a future optimisation; audio-only for now. Still open when it's picked up: x11grab capture, full-screen stream, the `--no-sandbox` info bar.                                                                                                                          |
| 7   | Archive site          | 🧪 merged, testing | On `main`. Runs locally against the real recordings: browse, streamers, search, set pages, M4A player with range requests, MP3/FLAC/M4A downloads. Not yet: the Docker image, admin edits on real data.                                                                                       |
| 8   | Deploy to home server | ⬜                 |                                                                                                                                                                                                                                                                                               |
| 9   | Hardening             | ⬜                 |                                                                                                                                                                                                                                                                                               |

## Implemented on `main`

| Area            | What                                                                                                                                                            | Verified by                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@dsr/core`     | Session/state schemas, naming, layout, atomic JSON, env parsing, logger                                                                                         | unit tests                                                                          |
| `@dsr/media`    | `runFfmpeg`, `spawnFfmpeg` (stop with `q`, live stderr lines), live capture with `silencedetect`, level check, loudnorm measurement and filters, encode helpers | unit tests (parsing and filter strings only)                                        |
| `@dsr/recorder` | Config sections, `launchBrowser`, `smoke.ts`, Docker image, entrypoint, minimal PulseAudio config; bot (`src/bot/`) and session logic (`src/session/`)          | unit tests; image built and run (milestone 1); bot connects and registers `/record` |
| `@dsr/archive`  | Health check only (the full site is on `feat/archive`)                                                                                                          | unit test                                                                           |
| Deploy          | `compose.yaml`, `compose.server.yaml` (Traefik labels)                                                                                                          | not run                                                                             |

## Milestone 4 (automated watch): user testing

Run it with `docker compose up -d --build recorder`; `main.ts` (bot, browser and capture in one process) is the container command now. All six planned steps are built and were exercised live on 2026-10-23 (research.md, "Automated watch"):

1. **One process** in the container. The bot no longer runs on the WSL host.
2. **Join on `/record start`**, deafened and muted before joining, then checked. Failures are posted in the channel.
3. **Open the target's stream** by user ID, unmute it, and set the volume to `STREAM_VOLUME` (85).
4. **Capture** one float32 WAV per set into `<date>_<title>/raw/`, with a minimal `session.json` (sets end as `processing` until milestone 5).
5. **Silence handover** via `silencedetect` in the capture; verified switching after 45 s.
6. **Leave** on `/record stop`, and on container shutdown (`stop_grace_period: 30s`).

Before calling it done:

- `/record switch` (both directions, while both streams were live, plus the "already recording" and "not live" replies) and `/record title` (folder renamed at the end) verified live on 2026-10-23.
- The ~6% missing audio on WSL is dev-only clock drift; restart WSL after the host sleeps (research.md). Not being chased further.
- A logged-out browser is only caught at join time (posted in the channel), not as a pre-flight check in `/record start`.

Not in this milestone: restart grace and `state.json` resume (9), leveling and `setlist.csv` (5), video (6).

## Milestone 5 (post-processing): done

Built: after each set the controller queues `processSet` (one at a time, in the background). It trims leading and trailing silence, levels it (loudnorm measurement, then fixed gain and a true-peak limiter) into a FLAC master, exports `EXPORT_FORMATS`, and marks the set `ready` (or `failed` with the reason). The session folder is renamed for a title change only after its encodes finish. On shutdown, encodes are aborted and the sets stay `processing`; `reprocess.ts` re-runs them. Results on the test recordings are in research.md.

**Leveling (decided 2026-10-23):** one fixed gain to `TARGET_LUFS`, then an oversampled true-peak limiter, instead of loudnorm's pass 2, which compressed sets it couldn't level linearly. Every test set now lands within 0.4 LU of −14 LUFS.

Verified live on 2026-10-23 ("Set Test"): each set was processed about 10 s after it ended, the first while the next was recording; the session finished only after its last encode; masters and exports at −14.0 LUFS. Checking the files in the archive is part of milestone 7.

## Dev environment state (session 2)

- The recorder runs in Docker (`docker compose up -d recorder`); `/record` works from the container.
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
