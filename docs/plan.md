# Discord Stream Recorder: Plan

Record each DJ's Go Live stream during a Discord disco as its own audio file (and optionally video), loudness-normalised and named after the DJ.

Progress is tracked in [status.md](status.md). See [research.md](research.md) for the facts behind each decision and the things still to verify.

## Goals

- One file per set, split automatically when a DJ starts and stops streaming.
- Stream audio only. No voice chat or mic audio in the recording.
- Loudness-normalised output with no clipping (see [Leveling](#leveling)).
- Optional video capture of each stream.
- An optional title for each session (`/record start title:…`), used for its folder and in the archive.
- A web archive where people can browse past sessions by date or title and by streamer, and play or download sets.
- Developed and tested on the WSL2 dev machine, then deployed to the home server (Ubuntu + Docker, behind the existing Traefik).
- Started and stopped with a slash command typed in the voice channel's own text chat. That channel is the one recorded.
- Fully automated while a session runs: no one has to click "Watch Stream" or press record between sets.
- All configuration in a `.env` file.

## Non-goals

- Asking DJs to route their mix through their mic. Ruled out: it needs every DJ to disable Discord's voice processing, and the quality ceiling is lower.
- Fixing audio that was already clipped at the DJ's end.
- Recording more than one stream at a time, or more than one channel at a time. Sets are sequential, and there is one recorder account.

## Approach

Discord's bot API cannot watch Go Live streams, so capture is done by a **real Discord web client** running in a container, driven by Playwright and logged in as a dedicated recorder account. A separate, legitimate **event bot** takes the `/record` commands and tells the recorder when streams start and stop.

> **ToS risk:** automating a normal user account ("self-bot") is forbidden by Discord and can get that account terminated. Use a throwaway recorder account, never a personal one. The event bot is a normal bot account and is not at risk. Tell DJs and attendees the event is being recorded.

### Architecture

```
┌──────────────────────── docker container ────────────────────────┐
│                                                                  │
│  event bot (discord.js, bot token)                               │
│    /record start|stop|status → session for one voice channel     │
│    voiceStateUpdate: streaming false→true / true→false           │
│        │                                                         │
│        ▼                                                         │
│  controller (TypeScript)                                         │
│    ├─ Playwright → Chromium (headed, on Xvfb :99)                │
│    │     discord.com, logged in as recorder account, in voice    │
│    │     self-muted and self-deafened (voice off, stream on)     │
│    │     clicks "Watch Stream" for the DJ who went live          │
│    │                                                             │
│    ├─ ffmpeg: pulse recorder.monitor     → <set>.wav             │
│    │   (+ x11grab :99 if video: one process → <set>.mkv)         │
│    └─ on stream end: stop ffmpeg → post-process                  │
│                                                                  │
│  PulseAudio: null sink "recorder" (Chromium's only output)       │
│  noVNC (optional, for one-time login and debugging)              │
└──────────────────────────────────────────────────────────────────┘
          │
          ▼
   recordings/  (bind-mounted volume)
```

### Commands

These are guild slash commands, registered for `DISCORD_GUILD_ID` on startup. Guild commands update instantly; global ones don't.

| Command                           | Effect                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/record start [channel] [title]` | Starts a session in the target voice channel. The recorder account joins it and every Go Live stream there is recorded until `/record stop`. |
| `/record title <text>`            | Sets or changes the active session's title. The folder is renamed when the session ends.                                                     |
| `/record stop`                    | Ends the session. Any set in progress is finalised and marked `partial`. The recorder leaves the channel.                                    |
| `/record switch <user>`           | Forces the recorder onto that user's stream (they must be live in the session's channel). The current set ends, and theirs starts.           |
| `/record status`                  | Shows the active channel, who is being recorded, **who else is live** (and since when), sets so far, and the elapsed time.                   |

**Choosing the target channel**, first match wins:

1. The `channel` option, limited to voice channel types.
2. The channel the command was typed in, if it's a voice channel. Typing it in a voice channel's built-in text chat starts recording **that** channel, which is the main way to use it.
3. The voice channel the person running the command is connected to.
4. Otherwise, it fails with an ephemeral "run this in a voice channel's chat or pass `channel`".

discord.js: `interaction.channel?.isVoiceBased()` for step 2, and `interaction.member.voice.channelId` for step 3.

**Rules:**

- **One session at a time.** `/record start` while a session is active in another channel is rejected, naming the active channel. In the same channel, it's a no-op.
- **Pre-flight checks before joining.** The bot checks that the recorder account (`RECORDER_USER_ID`) has `ViewChannel` + `Connect` in the target channel, and that the browser is logged in. If either fails, it replies with the reason.
- **Someone already streaming at start:** recording starts right away, and that set is marked `partial` (joined late).
- **Who can run it:** `default_member_permissions` is set to `COMMAND_DEFAULT_PERMISSION` (default `ManageEvents`). Server admins can change this per role or channel in Server Settings → Integrations without code changes. Optionally, `ALLOWED_ROLE_IDS` adds a check in code.
- **Replies:**
  - Command replies are public by default, so the channel sees "🔴 Recording started by @user. Go Live streams in this channel are being recorded." This doubles as the consent notice.
  - Errors are ephemeral.
  - The initial reply must be within 3 s, so `start` defers and then edits the reply once the recorder has joined. The interaction token lasts 15 min.
- **Notices in the channel's chat** (`ANNOUNCE_SETS=true`, the default). These need `Send Messages` in that channel; interaction replies don't.
  - "🔴 Now recording: DJ name" when a set starts.
  - "✅ Finished: DJ name (1h02m)" when it ends.
  - **Every time a new stream starts being recorded:** "🔴 Now recording **A**" (nobody was being recorded before), or "🔀 Switched from **A** to **B**: A stopped streaming" / "…: went silent" / "…: requested by @mod".
  - **When the current streamer stops and nobody else is live:** "⏸️ **A** stopped streaming. Waiting for the next stream."
  - `/record start` names the first target itself if someone is already live ("🎧 First up: …"). `/record switch` replies privately, and the switch is announced like any other.
- **Bot or container restart with a session active:** the session is saved to `RECORDINGS_DIR/state.json` on start and cleared on stop. On boot, the bot resumes it and posts a notice that there was a gap.

### Which stream to record (handover)

One recorder can only watch one stream with clean audio. Chrome mixes everything it plays into one PulseAudio input, and a Discord account has a single voice connection. DJs often go live before the previous set ends (to set up or test), so the recorder follows these rules:

1. **Stay on the current streamer** while they're live and audible. Other live streams are tracked but not opened.
2. **When the current streamer stops streaming**, switch to the other live stream that **went live earliest** (normally the next DJ). If nobody else is live, wait for the next `streamStart`.
3. **When the current stream is silent** for `HANDOVER_SILENCE_SECONDS` (default 45) **and someone else is live**, switch to them, using the same earliest-first order. This catches a DJ who finishes but forgets to end their stream. Their set ends at their last audio. The silence check runs on the live capture (audio level from ffmpeg). Silence with nobody else live never triggers a switch, since it may just be a quiet passage.
4. **`/record switch <user>`** overrides the rules at any time.
5. **Every switch** ends the current set (normal post-processing), starts the next, and posts a 🔀 notice with the reason.
6. **Timestamps:** each set stores both `streamStartedAt` (when they went live) and `recordingStartedAt`. A set whose stream was already live when recording began is marked `partial` only if it had audio before the switch. Post-processing trims leading and trailing silence, so setup time and dead air don't end up in the files.

**Known gap:** if B really starts playing while A is still audible (a deliberate overlap or b2b transition), B's first moments are missed until a switch. `/record switch` covers events where that matters.

**Possible later upgrade (not planned): a recorder pool.** One recorder per concurrent stream, each with its own Discord account, Chrome profile and PulseAudio sink (`PULSE_SINK` per Chrome instance), would capture overlapping streams in full. The costs are more throwaway accounts (more ToS exposure) and about 1.5 GB RAM per Chrome. The controller should keep "which recorder watches which stream" behind one interface, so a pool can be added later without rework.

### Flow for one set

1. The DJ starts Go Live in the session's channel, and the handover rules pick them as the stream to record.
2. The event bot gets `voiceStateUpdate` with `oldState.streaming === false` and `newState.streaming === true` for a member **in the session's channel** (events from other channels are ignored), then emits `streamStart { userId, displayName, at }`.
3. The controller finds that member in the voice channel UI and opens their stream. Then it:
   - makes the stream full-screen (for video) and checks the stream volume is at 100%;
   - starts ffmpeg on the PulseAudio monitor. With video on, a **single** ffmpeg process takes both `x11grab` and `pulse` and writes one MKV (H.264 `veryfast` + `pcm_f32le`). One process keeps audio and video in sync, and MKV survives a crash mid-set.
4. The DJ stops streaming, so the bot emits `streamEnd`. The controller stops ffmpeg cleanly, sending `q` on stdin so the file is finalised.
5. Post-processing runs on the finished file (see [Leveling](#leveling)) and appends a line to the set list.

Edge cases the controller must handle:

- **The DJ's stream drops and restarts mid-set.** Treat a restart by the same user within `RESTART_GRACE_SECONDS` as the same set. Record it as a new segment and join the segments in post-processing.
- **The recorder gets disconnected** (network issue or AFK move). Rejoin the channel and resume watching if a stream is still live. Log the gap.
- **Someone runs `/record stop` mid-set.** Finalise the file, mark it `partial`, and still post-process it.
- **Two or more people stream at once.** Handled by the [handover rules](#which-stream-to-record-handover).
- **Login or captcha prompt.** Stop and alert. Never try to solve captchas or type credentials automatically.

## Components

The project uses TypeScript on Node 24 in a pnpm workspace, run with `tsx`, so there's no build step. The layout and conventions are in [development.md](development.md), and each package has its own README.

| Package         | Path              | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@dsr/recorder` | `apps/recorder/`  | Container 1. Bot (`src/bot/`: `Guilds` + `GuildVoiceStates` intents, `/record`, stream start/end for the active channel). Sessions (`src/session/`: state machine, target channel, pre-flight checks, `state.json`). Browser (`src/browser/`: Playwright persistent context, joining or leaving voice via `discord.com/channels/<guild>/<channel>`, self-mute and deafen, opening streams and setting their volume, spotting logouts). Capture (`src/capture/`). Pipeline (`src/pipeline/`: post-processing). `src/main.ts` wires these together. |
| `@dsr/archive`  | `apps/archive/`   | Container 2. Hono web app that reads the recordings volume read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@dsr/core`     | `packages/core/`  | `session.json` and `state.json` schemas (the contract between the apps), file layout and naming, atomic JSON files, env parsing, logger.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@dsr/media`    | `packages/media/` | ffmpeg runner, two-pass loudnorm, export encodes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The bot and the controller run in **one Node process** (the recorder), which avoids inter-process messaging. The bot module exposes an `EventEmitter` that the session manager subscribes to.

### Container details

- Base: the official Playwright image `mcr.microsoft.com/playwright:v1.64.1-noble` (Ubuntu 24.04), pinned to the version that matches the npm `playwright` dependency.
- Extra packages: `xvfb`, `pulseaudio`, `ffmpeg`, `x11vnc` + `novnc` (optional).
- Run with `--init` and `--ipc=host`, as Playwright's Docker docs recommend for Chromium.
- `entrypoint.sh`:
  1. Start `Xvfb :99 -screen 0 1920x1080x24`.
  2. Start PulseAudio (`--exit-idle-time=-1`), load `module-null-sink sink_name=recorder format=float32le rate=48000 channels=2` and set it as the default sink. Also load a null source as the default mic, so Discord gets silence if it opens a mic.
  3. Optionally start `x11vnc` + noVNC on `VNC_PORT`.
  4. `exec` the command: `node --import tsx apps/recorder/src/main.ts`, or `smoke.ts` until milestone 4. Compose passes `.env` in with `env_file`.
- Volumes (see [Storage layout](#storage-layout)):
  - `${APP_DATA_DIR}/recorder` → `/config`: the Playwright `userDataDir` (`/config/profile`), so the recorder account stays logged in across restarts.
  - `${RECORDINGS_HOST_DIR}` → `/recordings`: session folders and media.

### Browser settings

These need care:

- **Playwright mutes Chromium by default** (`--mute-audio`). We must pass `ignoreDefaultArgs: ['--mute-audio']` or nothing reaches PulseAudio.
- Use `launchPersistentContext(PROFILE_DIR, { headless: false, ... })` on Xvfb, not headless.
- Pass `--autoplay-policy=no-user-gesture-required` so stream audio plays without a click.
- Prefer the **Google Chrome channel** (`channel: 'chrome'`) over bundled Chromium. Chromium lacks some licensed codecs, and Discord may negotiate one. This is an open question; see research.md.
- Grant the `microphone` permission up front so Discord's join-voice flow doesn't stall on a prompt. The default mic is the silent null source, and the account is self-muted anyway.

### Isolating stream audio from voice chat

- **The recorder joins self-muted and self-deafened.** Deafen silences voice chat but not Go Live stream audio (confirmed by the user, 2026-10-23). It's one toggle that covers everyone, including people who join later, with no per-user settings, and it shows everyone that the recorder isn't listening to voice.
- **Fallback:** if deafen ever stops passing stream audio, set each member's user volume to 0% instead. That's verified by capture in milestone 2, and Discord remembers it per user, per account.
- **Stream volume defaults to 50%** in the web client (a separate slider on the stream tile). The controller must set it to **100%** every time it opens a stream; at 50% the capture is about 6 dB quieter. Don't go above 100%, because that can clip inside Discord's mixer.
- Chrome mixes all of Discord's audio into **one** PulseAudio sink input, so voice and stream can't be separated at the PulseAudio level. Isolation has to happen inside Discord.
- Later, if v1 leaks voice audio: inject a page script that hooks `RTCPeerConnection` and takes the audio track only from the Go Live connection, then records it through an AudioWorklet. This is more fragile, but isolation is perfect.

## Leveling

Two layers:

1. **Capture:** record lossless 32-bit float (`pcm_f32le` WAV, 48 kHz stereo) straight from the PulseAudio monitor. The sink is float32 too, so any peaks over 0 dBFS inside the pipeline are kept, not clipped, and loudnorm brings them back down. This costs about 1.4 GB per hour, and the raw file is only an intermediate. FLAC is integer-only and would hard-clip those overs, so it is used only after leveling. Keep the stream volume in Discord at or below 100%, because higher values can clip inside Discord's mixer.
2. **After the set:** two-pass `loudnorm` (EBU R128) per set:
   - Pass 1: `loudnorm=I=$TARGET_LUFS:TP=$TARGET_TP:LRA=$TARGET_LRA:print_format=json` to measure.
   - Pass 2: the same targets plus `measured_I`, `measured_TP`, `measured_LRA`, `measured_thresh` and `offset` from pass 1, with `linear=true`. Linear mode applies one gain change to the whole set, so the DJ's dynamics are kept. It falls back to dynamic mode only when the targets can't be met linearly, for example when the true-peak ceiling would be exceeded.
   - Defaults: `-14 LUFS`, `-1 dBTP`, LRA `11`. These targets are typical for streaming platforms and set the same perceived loudness for every mix.
   - The leveled master is kept as FLAC. Exports (MP3 320 / AAC in M4A) come from the master.

The raw capture is never deleted, so leveling can be re-run with different targets.

## Output layout

```
recordings/
  state.json                        # active session, if any
  2026-11-14_halloween-disco/       # one folder per session: date + title (or channel name if untitled)
    session.json                    # source of truth for the archive (see below)
    setlist.csv                     # start, end, user id, display name, partial, files
    raw/
      2026-11-14T21-03-12_djname.wav     # float32 capture
      2026-11-14T21-03-12_djname.mkv     # if video enabled (video + float audio)
    leveled/
      2026-11-14T21-03-12_djname.flac    # master
      2026-11-14T21-03-12_djname.mp3     # download
      2026-11-14T21-03-12_djname.m4a     # web playback (AAC)
      2026-11-14T21-03-12_djname.mp4     # web playback: H.264 + leveled AAC, faststart
```

`session.json` holds the session's ID, title, guild and channel, start and end, who started it, and a list of sets. Each set records the user ID, display name, avatar URL, start, end, `partial`, `hidden` and its files. The recorder writes it; the archive only reads it. Plain files keep backup and restore as simple as copying the folder.

Titles and display names are converted to safe file names (lowercase, `a-z0-9-`). Names come from the server display name at stream start, converted to a safe file name, with the user ID in `setlist.csv` for certainty.

## Archive site

`archive` is a second, small TypeScript service in this repo, in its own container. It serves the recordings over the web.

- **Browse by session:** a list of past sessions, newest first, showing date, title, channel and number of sets. Each session page lists its sets in order, with a player and downloads.
- **Browse by streamer:** a list of everyone who has played, with avatar and set count. Each streamer page lists their sets across all sessions.
- **Player:** HTML5 `<audio>` (m4a) or `<video>` (mp4). Files are served with HTTP Range support so seeking works in long sets. Downloads offer MP3 and FLAC, plus MP4 if there's video.
- **Data:** at startup it scans `RECORDINGS_DIR/*/session.json`, and rescans when files change (`fs.watch`) or on a timer. It needs no database in v1. It mounts recordings **read-only**.
- **Hiding sets:** a set with `hidden: true` doesn't appear. v1 sets it by editing `session.json`. Later, `/archive hide`, which a DJ can run on their own sets and mods on any set.
- **Access, v1:** public. Optionally, set `ARCHIVE_PASSWORD` to require one shared password:
  - It's a simple login page that sets a signed, `HttpOnly` cookie (`ARCHIVE_SESSION_SECRET`, for 30 days), so links shared afterwards keep working and media range requests carry the cookie.
  - Empty means public.
  - It's done in the app rather than with Traefik basic auth, because the later Discord login will replace it in the same place.
- **Access, later:** "Login with Discord", limited to members of the server and optionally a role, with the OAuth2 `identify` + `guilds.members.read` scopes. This reuses the **same Discord application** as the bot. It needs the app's client ID and secret and a redirect URI (`${ARCHIVE_PUBLIC_URL}/auth/discord/callback`) added in the Developer Portal. **It needs no extra bot permissions or intents**: OAuth scopes are separate from bot permissions, and membership is checked with the user's own token.

## Deployment (home server)

Development and testing happen on the WSL2 machine. The real deployment is the home Ubuntu server, which already runs a Docker stack (in a separate repo) with:

- **Traefik** on host ports 80/443. It discovers services through Docker labels (`exposedbydefault=false`) on the shared external network `media_network`, with entrypoint `websecure`.
- **A wildcard Let's Encrypt cert** for `${DOMAIN}` and `*.${DOMAIN}`, through Cloudflare's DNS challenge. A new subdomain needs no cert setup.
- **Cloudflare DNS records set to "DNS only"** (not proxied): a CNAME per app pointing at the `media` A record, then the router port forward to Traefik. Because nothing goes through Cloudflare's proxy, its CDN restrictions on serving video don't apply.
- **No hairpin NAT:** LAN devices reach subdomains through a hosts file / local DNS override to the server's LAN IP.
- **Authentik** at `auth.${DOMAIN}` (Plex login source), with the `authentik@docker` forward-auth middleware already used for the admin tools.
- **Cloudflare Tunnels** for some other stacks: a `cloudflared` sidecar per app (on that app's own compose network, run with a dashboard-managed token). These are not on Traefik.

**Why Traefik and not a tunnel:** tunnel traffic passes through Cloudflare's network, and its terms restrict serving video and large files through the CDN on free plans. The Traefik path is DNS only, so traffic goes straight to the server. The archive will mostly serve hour-long audio and video, so it uses Traefik.

How this project plugs in:

| Piece      | How it's exposed                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archive`  | Through Traefik, not a Cloudflare Tunnel (see below). Traefik labels: ``Host(`archive.${DOMAIN}`)``, `entrypoints=websecure`, plus a middleware depending on the access decision. Joins `media_network` as `external: true`. Needs a new Cloudflare CNAME `archive` → `media.${DOMAIN}` (DNS only) and a LAN DNS override entry. |
| `recorder` | **Not exposed through Traefik.** noVNC binds to `127.0.0.1:${VNC_PORT}` only, and you reach it with `ssh -L 6080:localhost:6080 <server>`. Docker-published ports skip ufw on that server, so it must never publish on `0.0.0.0`.                                                                                                |
| Storage    | See [Storage layout](#storage-layout): app data under `docker_data`, recordings under `data/media`.                                                                                                                                                                                                                              |

Server facts (checked over SSH on 2026-10-23; details in research.md):

- **CPU:** x86_64 with 16 cores, so Google Chrome (`channel: 'chrome'`) is available.
- **Memory:** 30 GiB RAM, about 19 GiB available, with swap already in use (5.6 of 8 GiB) because of the Minecraft server. Give `recorder` `mem_limit: 3g` and check during the first event.
- **Disk:** `/mnt/media` has 1.5 TB free (79% used) and holds the media stack's `docker_data/` and `data/`; this project follows the same layout. Raw WAV is about 1.4 GB/h. Video at about 6 Mb/s is about 2.7 GB/h. Plan on about 5 GB per hour of video sets. `RAW_RETENTION_DAYS` is optional; empty means keep forever. The NVMe root (746 GB free) is the fallback if the media disk fills up.
- **Docker** 28.5.1 and Compose v2.40.1. `include:` and `env_file` work as planned.
- **Time zone:** the host is `America/Chicago`. Set the same `TZ` in `.env` so folder dates match the local event date.
- **Login on the server:** reuse the recorder `PROFILE_DIR` copied from the test machine, or log in again over the SSH-tunnelled noVNC.

## Storage layout

This mirrors the media stack on the home server: **app state** in `docker_data/<app>`, **actual files** in `data/`.

| What       | Host path (`.env`)    | Local default       | Home server                                      | Container path                                                |
| ---------- | --------------------- | ------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| App data   | `APP_DATA_DIR`        | `./docker-data`     | `/mnt/media/docker_data/discord-stream-recorder` | `/config` (`recorder/` and `archive/` subfolders on the host) |
| Recordings | `RECORDINGS_HOST_DIR` | `./data/recordings` | `/mnt/media/data/media/discord-sets`             | `/recordings` (read-only in `archive`)                        |

- `recorder` `/config`: `profile/`, the Discord login (treat it like a password).
- `archive` `/config`: reserved for the archive's own data.
- Bind mounts rather than the media stack's `local-persist` volumes, so it also works on the dev machine without the plugin. The on-disk result is the same.

## Data storage: JSON manifests, not a database (for now)

Each session folder holds a `session.json` written by the recorder. The archive loads them all into an in-memory index at startup and reloads when they change. No database is used.

**Why this is enough:**

- **Scale is small.** One session per event, around 5–20 sets each. Even 500 sessions is a few MB of JSON, read in milliseconds. Every query the archive needs (by session, by streamer, newest first) is a filter over an in-memory array.
- **One writer.** Only the recorder writes, one session at a time, with an atomic write (temp file + rename). There's no concurrency problem for a database to solve.
- **Self-describing folders.** Copy, move, back up or delete a session folder and its metadata goes with it. Nothing has to be kept in sync, and an index can always be rebuilt from the files.
- **Simple containers.** SQLite in WAL mode needs write access for readers too (the `-shm` file), which conflicts with the archive's read-only mount. A database would also add migrations and a second source of truth next to the media files.

**When to switch to SQLite.** Any of these would justify it:

- The archive starts **writing**: hiding sets or editing titles from the web UI, Discord-login user records, play counts, comments.
- Full-text search across titles and names, or the session count grows into the thousands.

**The plan if we switch:** Node's built-in `node:sqlite` (a release candidate since Node 25.7; unflagged but experimental on Node 24), or `better-sqlite3`. The database would be **owned by the archive** in its own volume, as a cache and index built from the `session.json` files, plus tables for archive-only data. The recorder keeps writing JSON, so the session folders stay the source of truth for recordings.

## Configuration (`.env`)

All settings live in `.env` (git-ignored). `.env.example` is committed with every key and safe placeholders. Docker Compose passes it with `env_file: .env`, and Node reads it with `--env-file`.

| Key                          | Example                       | Notes                                                                                  |
| ---------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`          | —                             | Event bot token. Secret.                                                               |
| `DISCORD_GUILD_ID`           | `123…`                        | Server to register `/record` in.                                                       |
| `RECORDER_USER_ID`           | `789…`                        | User ID of the recorder account, for the pre-flight permission check.                  |
| `COMMAND_DEFAULT_PERMISSION` | `ManageEvents`                | discord.js `PermissionFlagsBits` name used as `default_member_permissions`.            |
| `ALLOWED_ROLE_IDS`           | (empty)                       | Optional comma list. If set, only these roles may use `/record`.                       |
| `ANNOUNCE_SETS`              | `true`                        | Post "Now recording" and "Finished" messages in the voice channel's chat.              |
| `RECORD_VIDEO`               | `false`                       | Also capture the screen with x11grab.                                                  |
| `VIDEO_FPS`                  | `30`                          | Matches what most Go Live streams send.                                                |
| `VIDEO_SIZE`                 | `1920x1080`                   | Xvfb screen and capture size.                                                          |
| `RECORDINGS_DIR`             | `/recordings`                 | Path inside the containers.                                                            |
| `RECORDINGS_HOST_DIR`        | `./data/recordings`           | Host path bind-mounted to `RECORDINGS_DIR` (see Storage layout).                       |
| `APP_DATA_DIR`               | `./docker-data`               | Host path for app state; `recorder/` and `archive/` are mounted at `/config`.          |
| `RAW_RETENTION_DAYS`         | (empty)                       | Delete raw WAV/MKV this many days after leveling. Empty = keep.                        |
| `TZ`                         | `America/Chicago`             | Session dates and file times.                                                          |
| `PROFILE_DIR`                | `/config/profile`             | Playwright user data dir (login session). Set by compose.                              |
| `BROWSER_CHANNEL`            | `chrome`                      | `chrome` or `chromium`.                                                                |
| `TARGET_LUFS`                | `-14`                         | Loudnorm integrated target.                                                            |
| `TARGET_TP`                  | `-1`                          | Loudnorm true-peak ceiling (dBTP).                                                     |
| `TARGET_LRA`                 | `11`                          | Loudnorm loudness range target.                                                        |
| `EXPORT_FORMATS`             | `mp3,m4a`                     | Comma list: `mp3`, `m4a`.                                                              |
| `RESTART_GRACE_SECONDS`      | `60`                          | Stream restart within this window = same set.                                          |
| `HANDOVER_SILENCE_SECONDS`   | `45`                          | Current stream silent this long while another is live → switch.                        |
| `VNC_ENABLED`                | `true`                        | noVNC for login and debugging.                                                         |
| `VNC_PORT`                   | `6080`                        | Always bound to `127.0.0.1`.                                                           |
| `VNC_PASSWORD`               | —                             | Secret. Required if VNC is enabled.                                                    |
| `ARCHIVE_PORT`               | `3000`                        | Archive's internal HTTP port (Traefik targets it).                                     |
| `ARCHIVE_PASSWORD`           | (empty)                       | Optional shared password for the archive. Empty = public. Quote it if it contains `#`. |
| `ARCHIVE_SESSION_SECRET`     | —                             | Signs the archive login cookie. Secret. Required if `ARCHIVE_PASSWORD` is set.         |
| `ARCHIVE_PUBLIC_URL`         | `https://archive.example.com` | Used for links in Discord messages and OAuth redirects.                                |
| `DOMAIN`                     | `example.com`                 | Only for compose label interpolation on the server.                                    |

Later, for Discord login: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (secret), and `ARCHIVE_ALLOWED_ROLE_IDS` (optional).

The recorder account's password is **not** stored. Log in once by hand through noVNC; the session persists in `PROFILE_DIR`.

## Milestones

1. **Container smoke test:** Xvfb, PulseAudio and Chrome start. Discord loads in noVNC. A manual login persists across restarts. Playing a YouTube video produces audio in an ffmpeg capture of `recorder.monitor`.
2. **Manual stream capture:** join the voice channel and watch a test stream by hand in noVNC. Confirm stream audio is captured and voice chat isn't (with user volumes at 0).
3. **Event bot:** `/record start|stop|status|switch|title` work and pick the right channel. Live streams in the session's channel are tracked (who is live, and since when), and start/end events are logged.
4. **Automated watch:** `/record start` makes the recorder join that channel (muted and deafened). It follows the handover rules (stream ends, silence, `/record switch`), posts switch notices, and leaves on `/record stop`.
5. **Post-processing:** loudnorm, exports, set list.
6. **Video:** x11grab capture, full-screen stream and the matching video file.
7. **Archive site:** browse by session and by streamer, players, downloads, `hidden` sets. Runs locally against test recordings.
8. **Deploy to the home server:** compose with Traefik labels, `media_network`, a CNAME, the SSH-tunnelled noVNC login and a test event.
9. **Hardening:** reconnects, restart grace, resuming from `state.json`, logout detection and alerts, dry run with friends.

## Bot setup (one-time, manual)

1. Create an application and bot in the Discord Developer Portal. Copy the token into `.env`.
2. No privileged intents are needed: `GuildVoiceStates` is not privileged.
3. Invite it with the `bot` and `applications.commands` scopes and these permissions: `View Channels`, plus `Send Messages` if `ANNOUNCE_SETS=true`. It must be able to see every voice channel you might record.
4. Create the recorder user account. Give it `View Channel` + `Connect` on those channels, put its user ID in `RECORDER_USER_ID`, and log in once through noVNC.
5. Optional: in Server Settings → Integrations → the bot, limit `/record` to the roles or channels you want.
6. **AFK:** the recorder sits muted and deafened for hours, which is exactly what AFK handling targets.
   - Discord's own AFK timeout (Server Settings → Overview → Inactive Timeout): set it to the maximum, or have no inactive channel during events.
   - Any **AFK bot** on the server: exclude the recorder account, by its user ID or an exempt role.
   - The controller still treats being moved out of the channel as a disconnect and rejoins (see "Flow for one set").
