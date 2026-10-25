# Status

_Last updated: 2026-10-25_

## Where things stand

Deployed on the home server and working end to end: `/record` captures each DJ's set, levels it to −14 LUFS (FLAC + MP3) within seconds of it ending, and the archive at `archive.<domain>` serves it.

| Area                           | State                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Recording and handover rules   | ✅ verified live (start, stop, switch, title, handover on stream end and on silence)   |
| Processing and retention       | ✅ verified live (raw deleted 48 h after leveling)                                     |
| Archive (pages, player, admin) | ✅ verified live (playback, downloads, deletes, link previews)                         |
| Deployment                     | ✅ Traefik + DNS working on the LAN; **not yet checked from outside the home network** |
| Logout / captcha alerts        | ✅ deployed; the healthy path is verified, a real logout or captcha hasn't been seen   |
| Rejoin after a voice drop      | ✅ verified live (disconnected mid-set, rejoined in 6 s)                               |
| Stream restart grace           | ✅ verified live (drop and return joined into one set)                                 |
| Partial tagging                | ✅ deployed; no set was tagged in the first real event                                 |
| Video                          | ⏸️ not built (deferred)                                                                |
| Resume after recorder restart  | ⏭️ skipped                                                                             |

## Next

The first real event (Halloween Disco, 2026-10-24, 18:00–01:00 CDT, 7 DJs) is recorded: 6 sets in the archive. Capture lengths matched wall-clock time, handovers and stream-restart grace worked. **Afterglow (20:00–21:00) was lost entirely and Comet lost its first ~11 min**, both on our side (items 1–2). From the recorder log (CDT): at 19:56 a test `/record switch` to another stream that ended after 11 s sent the recorder back to Nova's stream (shared by Orbit and Afterglow); ~105 s later the capture went to digital zero and stayed there for an hour, logged only as `stream went silent`. After Nova's stream restarted three times (20:57–21:01), every open failed (`locator.hover: Timeout`), Comet's included, and `/record switch` didn't help; `/record stop` + `/record start` at 21:13 (leaving and rejoining voice) cleared it. Likely cause of both: Discord's "How'd the stream go?" popup, which appears when a watched stream ends. Unconfirmed: the recorder keeps no screenshot of a failure. The silent set and the 11 s test were deleted, and the `-2` session was merged back by hand.

1. **Discord popups: built, not yet verified live.** The recorder closes popups (Escape, ticking "Don't show again") before every open and when the stream goes silent, retries a failed open once, saves screenshots of both, and `/record switch` to the current DJ retries their stream. Checked against a stand-in page (a modal over the call tile reproduces the `locator.hover` timeout; closing it, "Don't show again" included, lets the stream open), but the popup selector (`[role="dialog"]`) is unverified against Discord's own markup: on the event the survey was closed with Esc after ticking "Don't show again", so it may not come back to test. Check the screenshots and logs after the next event.
2. **Long-silence alert: built, not yet verified live.** A live stream silent for `SILENCE_ALERT_SECONDS` (300) gets a ⚠️ in chat and is reopened, with a screenshot; ✅ when audio is back. If the cause turns out not to be a popup, the screenshots should show whether the stream was paused in the page, or its volume or unmute was undone.
3. **Player buffering state: done** (checked locally on a throttled network). A spinner on the play button and a pulsing seek bar while a set loads or stalls.
4. **Upload a set by hand: built, not yet verified live.** Admin **Add set…** on a session page; the recorder imports and levels it. Tested end to end locally (upload through the archive, import and leveling in the recorder image). First use: Afterglow' own copy of their set.
5. **Slow downloads: capped per client, not yet verified live.** Likely many people downloading at once after the event (the archive itself serves ~600 MB/s locally). Each client IP is now capped at `ARCHIVE_DOWNLOAD_LIMIT_MBPS` (200, a fifth of the 1 Gbit/s upload, leaving room for Plex) so they share the upload link. Not measured: Traefik's own throughput on the server.
6. Open the archive from outside the home network once (logins from outside IPs were seen during the event, so it's likely reachable).
7. **`/record resume`: built, not yet verified live.** Reopens an earlier session of the channel (default: the most recent) and adds new sets to it. Next: resume automatically after the recorder restarts mid-session (`state.json`).
8. **`/record split`: built, not yet verified live.** Ends the current set and records the same stream as a new one, optionally naming both. The overlap was checked in the recorder image (0.9 s, no gap). Split and uploaded sets keep their own names in the archive, even after the DJ's name is edited.

## Environment notes

- **Server:** `~/.services/discord-stream-recorder`, read-only deploy key (`github-dsr` host alias). Update with `git pull` + `docker compose up -d --build`. The local recorder must stay stopped: it's the same Discord account.
- **Dev machine (WSL2):** the archive runs with `pnpm --filter @dsr/archive dev` against `data/recordings` and `docker-data/archive`. WSL2's clock drifts and drops ~6% of captured audio; `wsl --shutdown` resets it (the server isn't affected).
- **Discord:** bot "Recorder Bot"; recorder account "Recorder Account" (logged in in the Firefox profile, notification sounds off); test channel "👻Halloween Disco👻"; test streamers Val Mason and 🎃.
- `.env` holds secrets; never print it.
