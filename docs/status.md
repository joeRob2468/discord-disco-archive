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
| Partial tagging                | ✅ built; **the fix for a stop while a set is held (`1e47bf7`) isn't deployed yet**    |
| Video                          | ⏸️ not built (deferred)                                                                |
| Resume after recorder restart  | ⏭️ skipped                                                                             |

## Next

1. Deploy `1e47bf7`: `ssh <server> 'cd ~/.services/discord-stream-recorder && git pull && docker compose up -d --build recorder'`.
2. **Dry run with friends** (the user's). Watch for:
   - "capture is shorter than the time it ran" warnings: the first segment of some sets was 1–3 s short (later segments weren't), likely audio missed while ffmpeg starts.
   - Partial tags: a set only escapes the tag if it opens with at least 2 s of silence.
   - AFK moves of the recorder (exempt it from any AFK bot).
3. Open the archive from outside the home network once.

## Environment notes

- **Server:** `~/.services/discord-stream-recorder`, read-only deploy key (`github-dsr` host alias). Update with `git pull` + `docker compose up -d --build`. The local recorder must stay stopped: it's the same Discord account.
- **Dev machine (WSL2):** the archive runs with `pnpm --filter @dsr/archive dev` against `data/recordings` and `docker-data/archive`. WSL2's clock drifts and drops ~6% of captured audio; `wsl --shutdown` resets it (the server isn't affected).
- **Discord:** bot "Recorder Bot"; recorder account "Recorder Account" (logged in in the Firefox profile, notification sounds off); test channel "👻Halloween Disco👻"; test streamers Val Mason and 🎃.
- `.env` holds secrets; never print it.
