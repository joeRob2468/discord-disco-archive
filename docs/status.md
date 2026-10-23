# Status

Progress tracker: what exists, where it lives, what's been verified, and what's next. Update it with every milestone. The design is in [plan.md](plan.md#milestones).

_Last updated: 2026-10-23_

## Branches

| Branch         | Contents                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `main`         | Scaffolding, storage layout, docs. Work proceeds here milestone by milestone.                                                    |
| `feat/archive` | The archive site (milestone 7), built early. **Not merged.** Merge it once milestone 5 produces real recordings to test against. |

## Milestones

| #   | Milestone             | State                | Notes                                                                                                                                                                                                |
| --- | --------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Workspace scaffolding | ✅ done              | pnpm monorepo, tooling, `pnpm check` green.                                                                                                                                                          |
| —   | Storage layout        | ✅ done              | `/config` (app data) + `/recordings`; see plan.md "Storage layout".                                                                                                                                  |
| 1   | Container smoke test  | 🔄 in progress       | Container starts cleanly. Discord login page renders. Chrome → PulseAudio → ffmpeg verified with a test tone. **Remaining:** log in over noVNC, then confirm the login survives a container restart. |
| 2   | Manual stream capture | ⬜                   |                                                                                                                                                                                                      |
| 3   | Event bot (`/record`) | ⬜                   |                                                                                                                                                                                                      |
| 4   | Automated watch       | ⬜                   |                                                                                                                                                                                                      |
| 5   | Post-processing       | ⬜                   | `@dsr/media` loudnorm/encode helpers exist and are unit-tested, but have never run on real audio.                                                                                                    |
| 6   | Video                 | ⬜                   |                                                                                                                                                                                                      |
| 7   | Archive site          | 🧪 on `feat/archive` | Browse, search (FTS5), players, downloads, admin edits and hiding, activity log. 48 tests against fixtures; one local run against sample data. Not tested against real recordings or in Docker.      |
| 8   | Deploy to home server | ⬜                   |                                                                                                                                                                                                      |
| 9   | Hardening             | ⬜                   |                                                                                                                                                                                                      |

## Implemented on `main`

| Area            | What                                                                                              | Verified by                                          |
| --------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `@dsr/core`     | Session/state schemas, naming, layout, atomic JSON, env parsing, logger                           | unit tests                                           |
| `@dsr/media`    | `runFfmpeg`, `spawnFfmpeg` (stop with `q`), loudnorm measurement and filters, encode helpers      | unit tests (parsing and filter strings only)         |
| `@dsr/recorder` | Config sections, `launchBrowser`, `smoke.ts`, Docker image, entrypoint, minimal PulseAudio config | config unit tests; image built and run (milestone 1) |
| `@dsr/archive`  | Health check only (the full site is on `feat/archive`)                                            | unit test                                            |
| Deploy          | `compose.yaml`, `compose.server.yaml` (Traefik labels)                                            | not run                                              |

## Open questions blocking upcoming milestones

See the "Unverified / to test" table in [research.md](research.md). The most relevant to milestone 1:

- Does the recorder's Discord login survive a container restart (persistent profile in `/config/profile`)?
- Does Discord stream (WebRTC) audio reach the sink? (Milestone 2.)
- The `--no-sandbox` info bar in Chrome; it matters for video (milestone 6).
