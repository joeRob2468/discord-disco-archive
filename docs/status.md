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

1. **Fix: Discord popups block opening a stream.** After a few stream restarts in a row, Discord showed its "How'd the stream go?" feedback popup over the call view; every stream open then failed (`locator.hover: Timeout 10000ms exceeded` on the call tile) and nothing was recorded until the popup was closed by hand. The recorder should close such popups (Esc, or the dialog's close button) before opening a stream, and retry once if it fails; it should also check for a popup when the stream goes silent, since one likely cut the audio mid-set. Save a screenshot when an open fails or the stream goes silent. Also: after a failed open, the ⚠️ notice says to try `/record switch`, but switching to the user who is still the target does nothing; a failed open should clear the target, or switching to the current target should retry.
2. **Alert on long silence.** The Afterglow hour was exact digital zero (peak `-inf`) while people in the call heard the DJ: the browser stopped feeding the capture. If the popup isn't the whole story, check whether the stream was paused in the page, its audio moved to another sink, or the volume/unmute undone. Safety net either way: when the target stays silent for a few minutes while still live, post a ⚠️ in chat and reopen the stream.
3. **Player: show buffering.** While an MP3 is loading or stalls, the player gives no sign; it needs a loading/buffering state (spinner on the play button and seek bar).
4. **Upload a set by hand** (after the fixes): an admin action to add an audio file as a set in an existing session (DJ, title, position), leveled like a recorded set. First use: Afterglow' own copy of their set.
5. **Investigate slow downloads** of the FLAC/MP3 files from the archive (where the bottleneck is: the archive's file serving, Traefik, or the upload link).
6. Open the archive from outside the home network once (logins from outside IPs were seen during the event, so it's likely reachable).
7. **Keep a night in one session** (later): `/record stop` + `/record start` mid-event makes a new session (`<date>_<slug>-2`), and the archive can't merge sessions. Options: `/record start` reopens the last session if it's in the same channel and ended within a set time (e.g. 2 h), and/or an admin "merge into…" action. Until then, merge by hand after the event: move the second folder's `raw/` and `leveled/` files into the first, append its `sets` to the first `session.json` (paths are relative) and update `endedAt`, remove the second folder, restart the archive.
8. **`/record split`** (later): end the current set and start the next one on the same stream, for DJs who share one Go Live stream. Today the recorder sees no switch (switching to the current target does nothing), so they end up in one long set; see the workaround in operations.md. Ideally a gapless cut, with an optional DJ name or title for the new set.

## Environment notes

- **Server:** `~/.services/discord-stream-recorder`, read-only deploy key (`github-dsr` host alias). Update with `git pull` + `docker compose up -d --build`. The local recorder must stay stopped: it's the same Discord account.
- **Dev machine (WSL2):** the archive runs with `pnpm --filter @dsr/archive dev` against `data/recordings` and `docker-data/archive`. WSL2's clock drifts and drops ~6% of captured audio; `wsl --shutdown` resets it (the server isn't affected).
- **Discord:** bot "Recorder Bot"; recorder account "Recorder Account" (logged in in the Firefox profile, notification sounds off); test channel "👻Halloween Disco👻"; test streamers Val Mason and 🎃.
- `.env` holds secrets; never print it.
