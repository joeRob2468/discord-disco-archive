# Status

Progress tracker: what exists, where it lives, what's been verified, and what's next. Update it with every milestone. The design is in [plan.md](plan.md#milestones).

_Last updated: 2026-10-23_

## Branches

| Branch         | Contents                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `main`         | Scaffolding, storage layout, docs. Work proceeds here milestone by milestone.                                                    |
| `feat/archive` | The archive site (milestone 7), built early. **Not merged.** Merge it once milestone 5 produces real recordings to test against. |

## Milestones

| #   | Milestone             | State                | Notes                                                                                                                                                                                           |
| --- | --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Workspace scaffolding | ✅ done              | pnpm monorepo, tooling, `pnpm check` green.                                                                                                                                                     |
| —   | Storage layout        | ✅ done              | `/config` (app data) + `/recordings`; see plan.md "Storage layout".                                                                                                                             |
| 1   | Container smoke test  | ✅ done              | Container starts cleanly. Chrome → PulseAudio → ffmpeg verified with a test tone. Recorder account logged in over noVNC; login survives restarts and container recreation.                      |
| 2   | Manual stream capture | ✅ done              | Stream audio captured; with the streamer's user volume at 0%, no voice leaks (user confirmed by listening). Stream volume defaults to 50% and must be set to 100%. Details in research.md.      |
| 3   | Event bot (`/record`) | ✅ done              | Tested in Discord: start/stop/status/switch/title, handover on stream end, 🔴/🔀/⏸️ announcements. The recorder account's own streams are ignored. Run with `pnpm --filter @dsr/recorder dev`.  |
| 4   | Automated watch       | ⏳ next              | Wire the browser (join muted and deafened, open the target's stream, stream volume 100%) and ffmpeg capture to target changes; silence handover; run main.ts in the container.                  |
| 5   | Post-processing       | ⬜                   | `@dsr/media` loudnorm/encode helpers exist and are unit-tested, but have never run on real audio.                                                                                               |
| 6   | Video                 | ⬜                   |                                                                                                                                                                                                 |
| 7   | Archive site          | 🧪 on `feat/archive` | Browse, search (FTS5), players, downloads, admin edits and hiding, activity log. 48 tests against fixtures; one local run against sample data. Not tested against real recordings or in Docker. |
| 8   | Deploy to home server | ⬜                   |                                                                                                                                                                                                 |
| 9   | Hardening             | ⬜                   |                                                                                                                                                                                                 |

## Implemented on `main`

| Area            | What                                                                                                                                                   | Verified by                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `@dsr/core`     | Session/state schemas, naming, layout, atomic JSON, env parsing, logger                                                                                | unit tests                                                                          |
| `@dsr/media`    | `runFfmpeg`, `spawnFfmpeg` (stop with `q`), loudnorm measurement and filters, encode helpers                                                           | unit tests (parsing and filter strings only)                                        |
| `@dsr/recorder` | Config sections, `launchBrowser`, `smoke.ts`, Docker image, entrypoint, minimal PulseAudio config; bot (`src/bot/`) and session logic (`src/session/`) | unit tests; image built and run (milestone 1); bot connects and registers `/record` |
| `@dsr/archive`  | Health check only (the full site is on `feat/archive`)                                                                                                 | unit test                                                                           |
| Deploy          | `compose.yaml`, `compose.server.yaml` (Traefik labels)                                                                                                 | not run                                                                             |

## Open questions blocking upcoming milestones

See the "Unverified / to test" table in [research.md](research.md). The most relevant to the next milestones:

- The recorder isolates voice by self-deafening (streams still play); AFK timeout/bot must exempt it.
- Overlapping streams: one recorder plus handover rules (plan.md, "Which stream to record"); every switch is announced.
- The controller must set the stream volume slider to 100% (it defaults to 50%).
- The `--no-sandbox` info bar in Chrome; it matters for video (milestone 6).
