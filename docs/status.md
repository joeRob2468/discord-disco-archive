# Status

_Last updated: 2026-10-23_

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
| Partial tagging                | ✅ deployed; needs a real event to judge (see Next)                                    |
| Video                          | ⏸️ not built (deferred)                                                                |
| Resume after recorder restart  | ⏭️ skipped                                                                             |

## Next

1. **Dry run with friends** (the user's). Watch for:
   - "capture is shorter than the time it ran" warnings: the first segment of some sets was 1–3 s short (later segments weren't), likely audio missed while ffmpeg starts.
   - Partial tags: a set only escapes the tag if it opens with at least 2 s of silence.
   - AFK moves of the recorder (exempt it from any AFK bot).
2. Open the archive from outside the home network once.
3. **Fix: Discord popups block opening a stream.** After a few stream restarts in a row, Discord showed its "How'd the stream go?" feedback popup over the call view; every stream open then failed (`locator.hover: Timeout 10000ms exceeded` on the call tile) and nothing was recorded until the popup was closed by hand. The recorder should close such popups (Esc, or the dialog's close button) before opening a stream, and retry once if it fails. Also: after a failed open, the ⚠️ notice says to try `/record switch`, but switching to the user who is still the target does nothing; a failed open should clear the target, or switching to the current target should retry.
4. **`/record split`** (later): end the current set and start the next one on the same stream, for DJs who share one Go Live stream. Today the recorder sees no switch (switching to the current target does nothing), so they end up in one long set; see the workaround in operations.md. Ideally a gapless cut, with an optional DJ name or title for the new set.

## Environment notes

- **Server:** `~/.services/discord-stream-recorder`, read-only deploy key (`github-dsr` host alias). Update with `git pull` + `docker compose up -d --build`. The local recorder must stay stopped: it's the same Discord account.
- **Dev machine (WSL2):** the archive runs with `pnpm --filter @dsr/archive dev` against `data/recordings` and `docker-data/archive`. WSL2's clock drifts and drops ~6% of captured audio; `wsl --shutdown` resets it (the server isn't affected).
- **Discord:** bot "Recorder Bot"; recorder account "Recorder Account" (logged in in the Firefox profile, notification sounds off); test channel "👻Halloween Disco👻"; test streamers Val Mason and 🎃.
- `.env` holds secrets; never print it.
