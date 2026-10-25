# Design

How the recorder and the archive work. Current state and next steps are in [status.md](status.md); the facts behind these choices, with sources, are in [research.md](research.md).

## Approach

Discord's bot API can't watch Go Live streams, so a **real Discord web client** (Firefox, driven by Playwright, logged in as a dedicated recorder account) joins the voice channel and plays each DJ's stream into PulseAudio, where ffmpeg records it. A normal **bot** takes the `/record` commands and reports streams starting and stopping.

> **ToS:** automating a user account ("self-bot") is against Discord's rules and can get that account terminated. Use a throwaway recorder account. The bot account isn't at risk. Tell people the event is recorded.

```
recorder container ─────────────────────────────────────────────────────
  bot (discord.js)         /record, Go Live start/stop, recorder's voice moves
  session manager          active session, whose stream to record
  controller ──────────────► Firefox on Xvfb (discord.com, muted + deafened)
       │                          │ plays the stream into PulseAudio
       └─ ffmpeg ◄── recorder.monitor ── float32 WAV per set
  pipeline                 trim, level, FLAC + MP3, cleanup
  noVNC (127.0.0.1)        for logging in and debugging
archive container ──────────────────────────────────────────────────────
  Hono + SQLite            browse, play, download, admin edits
shared: recordings volume (session folders with session.json)
```

## Recording

### Commands

Guild slash commands, registered for `DISCORD_GUILD_ID` at startup. Who can use them: `COMMAND_DEFAULT_PERMISSION` (default `ManageEvents`, adjustable in Server Settings → Integrations), optionally narrowed by `ALLOWED_ROLE_IDS`.

| Command                           | Effect                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `/record start [channel] [title]` | Start a session. Every Go Live stream in that voice channel is recorded until `/record stop`. |
| `/record stop`                    | End the session; the recorder leaves voice.                                                   |
| `/record switch <user>`           | Record that live user now instead (for the current DJ: retry their stream if it didn't open). |
| `/record title <text>`            | Set the session title (the folder is renamed when the session ends).                          |
| `/record status`                  | Who is being recorded, who else is live, elapsed time.                                        |

- **Target channel:** the `channel` option, else the voice channel whose chat the command was typed in, else the caller's current voice channel.
- **One session at a time.** Before joining, `/record start` checks that the recorder account can see and connect to the channel and that its browser is logged in (no login page or captcha); otherwise it refuses with the reason.
- **Replies:** start, stop and title replies are public (they double as the recording notice); refusals are private.
- **Channel notices** (`ANNOUNCE_SETS`): 🔴 now recording, 🔀 switched (with the reason), ⏸️ waiting for the next stream, ⏳/▶️ stream dropped/back, plus ⚠️ alerts.

### Whose stream to record

The recorder watches one stream at a time.

1. **Stay on the current DJ** while they're live. Other live streams are tracked, not opened.
2. **When the current DJ stops streaming**, switch to whoever went live earliest.
3. **If nobody else is live**, hold the set open for `RESTART_GRACE_SECONDS` (60). If the same DJ goes live again in time, recording continues in the same set as a new segment; segments are joined back to back (the dropout is cut out). Otherwise the set ends at the drop. Anyone else going live during the hold takes over at once.
4. **When the current stream is silent** for `HANDOVER_SILENCE_SECONDS` (45) **and someone else is live**, switch to them. Silence with nobody else live is just a quiet passage.
5. **`/record switch`** overrides all of this.

Every switch ends the current set (it's processed) and starts the next. Known gap: if the next DJ starts playing while the current one is still audible, their first moments are missed until a switch.

**Long silence:** when the current DJ's stream is still live but silent for `SILENCE_ALERT_SECONDS` (300), the chat gets a ⚠️ and the recorder reopens the stream in the browser, in case it stopped playing on its side; the set keeps recording. Once per silence, with a ✅ when the audio is back.

### When things go wrong

- **Recorder logged out or shown a captcha:** checked at startup, every 5 minutes and before `/record start`. Logged once per change; announced in an active session's chat. Login and captchas are never automated: fix it over noVNC ([operations.md](operations.md)).
- **Recorder drops out of voice** (network, AFK move, kick): the current set ends, the chat is told, the recorder retries the join (0, 10, 30, 60 s) and records the current DJ again as a new set.
- **Capture stops on its own:** the set is closed as failed and the chat is told.
- **A set fails processing:** the chat is told; the raw capture is kept for `reprocess.ts`.
- **Recorder restart mid-session:** not handled; start a new session.

### Partial sets

A set is `partial` only if recording cut off music. `session.json` records which ends recording cut (`cut.start`: the DJ was already live; `cut.end`: `/record stop`, a drop or a capture failure), and processing keeps `partial` only if there is sound right at a cut end. A capture that opens or closes with at least 2 s of silence isn't partial at that end.

### Browser and audio

- **Firefox** (`BROWSER_CHANNEL=firefox`): Chromium-based browsers play Discord's stream audio in mono. Firefox runs in kiosk mode on Xvfb with its own profile (`<PROFILE_DIR>-firefox`), which holds the Discord login.
- **Voice is kept out** by joining self-muted and self-deafened: deafen silences voice chat but not Go Live audio. **Disable All Notification Sounds** is set in the profile (it's per browser, so set it again after a new login).
- **Stream volume** is set to `STREAM_VOLUME` (85) on every open (Discord's default is 50%), and the stream is unmuted, since Discord remembers mutes per streamer.
- **Popups** (Discord's modal dialogs, e.g. the "How'd the stream go?" survey after a watched stream ends) block clicks on the call view. They're closed with Escape (ticking "Don't show again" where offered) before every open and whenever the stream goes silent; a failed open is retried once. Both save a screenshot of the browser to `screenshots/` next to the profile (the newest 50 are kept).

## Processing

1. **Capture:** float32 WAV, 48 kHz stereo, from the PulseAudio monitor, so nothing clips before leveling. `silencedetect` runs in the same ffmpeg process for rule 4.
2. **Analyse:** loudness (EBU R128) and leading/trailing silence (−60 dB, 2 s) in one pass.
3. **Master:** trim the silence (keeping 0.5 s), apply one fixed gain to `TARGET_LUFS` (−14), then a 4× oversampled true-peak limiter just under `TARGET_TP` (−1 dBTP). The DJ's dynamics are kept. Written as 24-bit FLAC.
4. **Exports** from the master: MP3 320 (`EXPORT_FORMATS=mp3`; `m4a` is optional).
5. The set is marked `ready` (or `failed` with the reason). Sets are processed one at a time, in the background.

**Retention:** the raw WAV (~1.3 GB/h) is deleted `RAW_RETENTION_HOURS` (48) after leveling, by a sweep at startup and hourly, which also removes exports no longer in `EXPORT_FORMATS`. Only `ready` sets of ended sessions are touched; failed or unprocessed sets keep their raw capture. A kept set is about 415 MB/h (FLAC ~300 + MP3 ~115). The sweep runs in the processing queue, so it never edits a `session.json` that a job has open.

### Uploaded sets

A set can be added to a finished session from a file (any format ffmpeg reads, e.g. a DJ's own copy of a set that wasn't recorded), with the admin's **Add set…** on the session page: the file, the DJ it's filed under, the name shown and its start time. The browser sends the file as the request body with a progress bar, and the archive streams it to disk. The archive saves the audio and an import request (`uploads/<id>.json`: DJ user ID, display name, start time) in the session folder. The recorder checks every 15 s, moves the audio to `raw/<set>.<ext>`, adds the set as `processing` and levels it like a recorded one; its end time comes from the measured length. Requests wait while the session is still recording; an unreadable one is renamed `.invalid`. Like a raw capture, the uploaded file is deleted `RAW_RETENTION_HOURS` after leveling; until then it's offered as e.g. **MP3 (original)**.

## Storage

```
recordings/
  2026-11-14_halloween-disco/        date + title (or channel name)
    session.json                     what was recorded (source of truth)
    setlist.csv                      for people browsing the folder
    raw/2026-11-14T21-03-12_dj.wav   float32 capture, until retention
    leveled/2026-11-14T21-03-12_dj.flac, .mp3
    uploads/                         uploaded sets waiting to be imported
```

| What       | `.env` host path      | Server                                           | Container     |
| ---------- | --------------------- | ------------------------------------------------ | ------------- |
| App state  | `APP_DATA_DIR`        | `/mnt/media/docker_data/discord-stream-recorder` | `/config`     |
| Recordings | `RECORDINGS_HOST_DIR` | `/mnt/media/data/media/discord-sets`             | `/recordings` |

- `recorder/` app state holds the browser profiles (the Discord login: treat it like a password). `archive/` holds `archive.db` and uploaded `images/`.
- **`session.json`** (one per folder, written atomically by the recorder) records sessions, sets, times, files and recorded names. The archive writes it only to remove a set an admin deletes. Every write re-reads the file first, so writers don't undo each other's changes.
- **`archive.db`** (SQLite) mirrors every `session.json` plus everything the archive adds: edits, images, plays, album order, the activity log and the search index. If it's lost, it rebuilds from `session.json` without the edits. Schema changes are append-only migrations.
- **Back up both** folders.

## Archive

Hono, server-rendered `hono/jsx`, daisyUI on Tailwind, htmx (with `hx-boost`, so the player keeps playing across pages) and one client script for the player.

- **Pages:** home (latest sessions, DJs, popular sets), `/search` (every set, filtered live by text, DJ or session), sessions as albums (`/sessions/<uuid>`, with tracklist), set pages under their album, and stats tables at `/sessions` and `/djs`. Set rows expand in place into the set's details.
- **Player:** a bottom bar with a queue (play an album, a list or a set; add to it, jump within it, remove from it), stop, seek, volume and media keys. Plays the MP3, falling back to the raw WAV until a set is leveled. While a set loads or buffers, the play button shows a spinner and the seek bar pulses. A play counts when a set starts playing, and that set's play counts on the page update at once.
- **Forms:** submit buttons are disabled while their request is pending.
- **Assets:** pages link the CSS and scripts with a `?v=` version (file time and size), so they're cached for a year and a new build is fetched at once.
- **Downloads:** MP3 and FLAC (and the raw WAV while it exists), named `DJ - Title (date).ext`. Each client IP (from Traefik's `X-Forwarded-For`) gets at most `ARCHIVE_DOWNLOAD_LIMIT_MBPS` across all its downloads and playback, after a 1 s burst at full speed (so playback starts and seeks are instant), so one fast downloader can't take the whole upload link.
- **Link previews:** Open Graph tags and a preview card on the home and login pages.
- **Access:** public unless `ARCHIVE_PASSWORD` is set (one shared viewer password). `ARCHIVE_ADMIN_PASSWORD` enables admin features. Signed `HttpOnly` cookies, CSRF-checked form posts, constant-time password checks.
- **Admin:** **Add set…** from a file (see [Uploaded sets](#uploaded-sets)), edit dialogs for sets, sessions and DJs (titles, names, descriptions, tags, links, images; nothing changes until Save), reorder sets within an album, **Archive** (hide; reversible) or **Delete** (permanent: files and the `session.json` entry, or the whole session folder; refused while recording unless forced). `/admin` shows totals, storage use and sets needing attention; `/admin/sets` lists every set; `/admin/activity` lists every change, by the admin or by the recorder.
- **Name precedence:** set edit → DJ edit → recorded display name.

## Deployment

On the home server, in `~/.services/discord-stream-recorder`, cloned from GitHub with a read-only deploy key. The archive is served through the server's Traefik on `media_network` at `archive.<domain>` (Cloudflare CNAME to `media`, **DNS only**, so Cloudflare's CDN limits on large files don't apply). noVNC is bound to `127.0.0.1` and reached over an SSH tunnel. Day-to-day running is in [operations.md](operations.md).

## Configuration

All settings are in `.env` (see `.env.example`). The main ones:

| Key                                                      | Default           | Notes                                                       |
| -------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`                  | —                 | Bot token (secret) and server.                              |
| `RECORDER_USER_ID`                                       | —                 | The recorder account, for the pre-flight check.             |
| `COMMAND_DEFAULT_PERMISSION`, `ALLOWED_ROLE_IDS`         | `ManageEvents`, — | Who can use `/record`.                                      |
| `ANNOUNCE_SETS`                                          | `true`            | Notices in the voice channel's chat.                        |
| `BROWSER_CHANNEL`                                        | `firefox`         | `firefox` (stereo), `chrome` or `chromium` (mono).          |
| `STREAM_VOLUME`                                          | `85`              | Discord's stream volume slider.                             |
| `HANDOVER_SILENCE_SECONDS`, `RESTART_GRACE_SECONDS`      | `45`, `60`        | Rules 3 and 4 above.                                        |
| `SILENCE_ALERT_SECONDS`                                  | `300`             | Long silence, above.                                        |
| `TARGET_LUFS`, `TARGET_TP`, `TARGET_LRA`                 | `-14`, `-1`, `11` | Leveling targets.                                           |
| `EXPORT_FORMATS`                                         | `mp3`             | `mp3`, `m4a`.                                               |
| `RAW_RETENTION_HOURS`                                    | (keep)            | `48` on the server.                                         |
| `APP_DATA_DIR`, `RECORDINGS_HOST_DIR`, `TZ`, `PUID/PGID` | local paths       | Host paths, time zone for folder names, file owner (1000).  |
| `VNC_ENABLED`, `VNC_PORT`, `VNC_PASSWORD`                | `true`, `6080`, — | noVNC, always on `127.0.0.1`.                               |
| `ARCHIVE_PUBLIC_URL`                                     | —                 | Absolute URL (CSRF origin, link previews).                  |
| `ARCHIVE_PASSWORD`, `ARCHIVE_ADMIN_PASSWORD`             | —                 | Viewer password (optional), admin password (12+ chars).     |
| `ARCHIVE_SESSION_SECRET`                                 | —                 | Cookie signing (32+ chars), needed if a password is set.    |
| `ARCHIVE_SYNC_INTERVAL_SECONDS`                          | `60`              | Full rescan of the recordings.                              |
| `ARCHIVE_DOWNLOAD_LIMIT_MBPS`                            | `200`             | Per-client media bandwidth cap (Mbit/s); `0` = none.        |
| `COMPOSE_FILE`, `DOMAIN`                                 | server only       | `compose.yaml:compose.server.yaml`, and the Traefik domain. |

`RECORD_VIDEO`, `VIDEO_FPS` and `VIDEO_SIZE` exist but video capture isn't built.

## Bot setup (one-time)

1. Create an application and bot in the Discord Developer Portal; put the token in `.env`. No privileged intents are needed.
2. Invite it with the `bot` and `applications.commands` scopes and **View Channels** (plus **Send Messages** for notices).
3. Create the recorder account, give it **View Channel** and **Connect** on the voice channels, put its user ID in `RECORDER_USER_ID`, and log it in once over noVNC.
4. Keep AFK handling off the recorder: no inactive timeout during events, and exempt it from any AFK bot.

## Not built

- **Video** capture (deferred).
- **Resuming after a recorder restart** (`state.json`; skipped).
- **A recorder pool** for recording overlapping streams in full (one account and browser per stream).
- **Login with Discord** for the archive.
