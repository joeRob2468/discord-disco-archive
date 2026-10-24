# Status

Progress tracker: what exists, where it lives, what's been verified, and what's next. Update it with every milestone. The design is in [plan.md](plan.md#milestones).

_Last updated: 2026-10-23 (session 3)_

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
| 7   | Archive site          | 🧪 merged, testing | On `main`. Runs locally against the real recordings: browse, streamers, search, set pages, M4A player with range requests, MP3/FLAC/M4A downloads, raw WAV playback and download until leveling finishes. Not yet: the Docker image, admin edits on real data.                                |
| 8   | Deploy to home server | ⬜                 |                                                                                                                                                                                                                                                                                               |
| 9   | Hardening             | ⬜                 |                                                                                                                                                                                                                                                                                               |

## Implemented on `main`

| Area            | What                                                                                                                                                            | Verified by                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@dsr/core`     | Session/state schemas, naming, layout, atomic JSON, env parsing, logger                                                                                         | unit tests                                                                          |
| `@dsr/media`    | `runFfmpeg`, `spawnFfmpeg` (stop with `q`, live stderr lines), live capture with `silencedetect`, level check, loudnorm measurement and filters, encode helpers | unit tests (parsing and filter strings only)                                        |
| `@dsr/recorder` | Config sections, `launchBrowser`, `smoke.ts`, Docker image, entrypoint, minimal PulseAudio config; bot (`src/bot/`) and session logic (`src/session/`)          | unit tests; image built and run (milestone 1); bot connects and registers `/record` |
| `@dsr/archive`  | Browse, search (FTS5), players, downloads, admin edits and hiding, activity log; SQLite catalog synced from `session.json`                                      | unit tests; local run against real recordings                                       |
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

## Next: archive UI rewrite (before deploy)

daisyUI 5 + Tailwind 4 + htmx, on the existing server-rendered architecture; plan in plan.md, "UI rewrite". Stages: (1) build setup, layout, dark theme, login page; (2) pages as tables and cards; (3) player with queue (MP3 default); (4) admin panel and stats. Deploy (milestone 8) comes after.

- **Stage 4 built, user testing (2026-10-23):** public stats tables at `/sessions` and `/djs` (sortable by every column); `/search?streamer=` now heads the list with the DJ's picture, bio, links and totals. Admin panel at `/admin`: totals, storage use, and recording/processing/failed sets with the failure reason; `/admin/sets`, every set filtered live by text, status and visibility, sortable, with quick hide; `/admin/activity` restyled. Edits are modal dialogs (with the image uploads) on the album, set, DJ and table pages, returning to the page via a `next` field. Migration 4 stores each set's `error` and file sizes (stat-ed by sync, so pages don't touch the disk). The old `/streamers`, `/streamers/<id>` and `/tags` pages and the stage-1 CSS mapping are deleted (404, no redirects; user's call). First review (same day) and fixes: dialog close button moved into a header row; pages no longer change width (stable scrollbar gutter); images are part of the edit form and only apply on Save (the separate `/admin/images` route is gone); set pages show a session card with its tracklist and previous/next buttons; set rows expand into an inline set page; the player has Stop and a queue panel (add, jump, remove, clear upcoming). Then: admins reorder sets within an album (↑/↓ on the album page, stored as `album_position`, migration 5, with "Back to recorded order"), and a white flame home link at the top left of every page. Then: "Hide" is renamed **Archive** in the UI, and admins can **delete permanently** from the edit dialogs (set: its files and `session.json` entry; session: its folder), refused while recording unless forced; the archive's recordings mount is now read-write (`compose.yaml`). Tests green; waiting on the user's browser check. Deploy check: the recorder's `PUID` must be 1000 (the archive's `node` user) for deletes to work.

- **Redesign (2026-10-23):** the user asked for a dashboard look (dark glass panels, gradient hero, avatar row, cards, a side panel) with one searchable set list instead of per-set pages. Sets keep the name "sets". Sessions and DJs filter the list (`?session=<uuid>`, `?streamer=<id>`); `/t/<set uuid>` opens one shared set. Popular = play counts. Artwork is placeholder gradients seeded by ID.
- **Stage 2 follow-up (2026-10-23):** sidebar removed (menu button by the search bar), larger muted glows, bare login page, `/search` page for the full list, album pages per session and set pages nested under them, old links redirected, empty sessions hidden. Admin image uploads added the same day: DJ pictures, set art and album covers (PNG/JPEG/WebP, max 5 MB, type checked from the file bytes, stored content-named under `<ARCHIVE_DATA_DIR>/images`, served at `/images/<name>`; set art falls back to the album cover, then a gradient). Then (same day) per review: logo removed, menu closes on outside click, darker plainer background with solid panels, and **stage 3, the player**: a bottom bar kept across page swaps, queues from albums, search and popular sets, play counting after 30 s, media keys. Checked in Chromium: Play all, navigating mid-play (audio continued), Next, and one counted play after 30 s. Next: stage 4, the admin panel.
- **Stage 2 done (2026-10-23):** (2a) set UUIDs (v5 of session and set ID, stable across rebuilds), a plays table, popular and session-filter queries; (2b) the new shell (icon rail, big search, "Now playing" placeholder panel, glowing backdrop) and home page (hero, DJ row, recent session cards, popular sets, live-filtered set list with removable filter chips; rows expand to play, download, copy link, and Edit for admins). `/search` redirects into the list. The old session, set and streamer pages remain only for admin edits until stage 4. Checked in Chromium at 1500 px and 390 px, including htmx filtering with and without a session filter.
- **Stage 1 done (2026-10-23):** Tailwind 4.3 + daisyUI 5.7 built by the Tailwind CLI (`build:css`; `dev` watches it), htmx 2.0 with `hx-boost` (error pages swap in too), navbar with a phone drawer, dark default with a remembered light toggle, login card. The old page classes are mapped onto daisyUI in `app.css` until stage 2. Checked in Chromium at desktop and phone widths. Not yet: the archive Docker image (it now has a CSS build stage), and real passwords in `.env` (`ARCHIVE_ADMIN_PASSWORD` 12+ characters, `ARCHIVE_SESSION_SECRET` 32+).

## Browser: Firefox (2026-10-23)

Chromium plays Discord's stream audio in mono, so the recorder now uses Firefox by default (`BROWSER_CHANNEL=firefox`, research.md "Audio quality"). The probe passed every step in Firefox, and a full `/record` session ("Firefox Stereo") recorded and leveled in stereo: side channel 10 dB under mid in raw, master and M4A, master at −14.0 LUFS. Firefox runs in kiosk mode. The recorder account is logged in to the Firefox profile (`docker-data/recorder/profile-firefox`), with **Disable All Notification Sounds** on: a capture during the recorder joining, a member joining and leaving, and an @mention stayed at digital silence (−91 dB). Discord keeps that setting per browser profile, so set it again after any new login.

## Dev environment state (end of session 2, 2026-10-23)

- **Resume here:** the user checks stage 4 (admin panel and stats) in the browser; then the archive Docker image check, then milestone 8 (deploy). See "Next: archive UI rewrite" above. Starting the archive migrates `docker-data/archive/archive.db` to schema v4.
- The recorder runs in Docker (`docker compose up -d recorder`, currently stopped); `/record` works from the container. It uses **Firefox** (`BROWSER_CHANNEL=firefox` in `.env`), logged in as "Recorder Account" in `docker-data/recorder/profile-firefox`, with Discord notification sounds disabled. The old Chrome profile is in `docker-data/recorder/profile`.
- `.env` is filled in (bot token, guild ID, recorder user ID, `COMMAND_DEFAULT_PERMISSION=Everyone`, `VNC_PASSWORD`, `PUID`/`PGID` 1000, and the archive's viewer and admin passwords and session secret). Never print it.
- The bot application is "Recorder Bot" (private), invited with View Channels + Send Messages. Test server: the user's; test voice channel: "👻Halloween Disco👻" (formerly "Test Room"). Test accounts: Val Mason (desktop client) and 🎃 (web client).
- The server's inactive timeout is disabled. Any AFK bot still needs a recorder exemption before a real event.
- Test recordings: `data/recordings/2026-10-23_*` (one early session still has unprocessed sets; `reprocess.ts` would level them) and `data/recordings/_tests/`.
- The archive runs locally with `pnpm --filter @dsr/archive dev` (http://localhost:3000; it also watches the CSS and the player script) against `data/recordings`, with its database and images in `docker-data/archive`.
- WSL2's monotonic clock drifts (about 7% slow), which drops audio from desktop-client streams on this machine only; `wsl --shutdown` resets it.
- When stopping a temporary archive, don't kill every `node … apps/archive/src/main.ts`: `node --watch` runs the dev server as a child with those same arguments.

## Open questions blocking upcoming milestones

See the "Unverified / to test" table in [research.md](research.md). The most relevant to the next milestones:

- The recorder isolates voice by self-deafening (streams still play); AFK timeout/bot must exempt it.
- Overlapping streams: one recorder plus handover rules (plan.md, "Which stream to record"); every switch is announced.
- The `--no-sandbox` info bar in Chrome; it matters for video (milestone 6).
