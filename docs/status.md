# Status

_Last updated: 2026-10-29_

## Where things stand

Deployed on the home server and working end to end: `/record` captures each DJ's set, levels it to −14 LUFS (FLAC + MP3) within seconds of it ending, and the archive at `archive.<domain>` serves it.

| Area                           | State                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Recording and handover rules   | ✅ verified live (start, stop, switch, title, handover on stream end and on silence)                   |
| Processing and retention       | ✅ verified live (raw deleted 48 h after leveling)                                                     |
| Archive (pages, player, admin) | ✅ verified live (playback, downloads, deletes, link previews, pending buttons, buffering, live plays) |
| Deployment                     | ✅ Traefik + DNS working, reachable from inside and outside the home network                           |
| Logout / captcha alerts        | ✅ deployed; the healthy path is verified, a real logout or captcha hasn't been seen                   |
| Rejoin after a voice drop      | ✅ verified live (disconnected mid-set, rejoined in 6 s)                                               |
| Stream restart grace           | ✅ verified live (drop and return joined into one set)                                                 |
| Partial tagging                | ✅ deployed; no set was tagged in the first real event                                                 |
| `/record split`                | ✅ verified live (names, ~1 s overlap, no gap)                                                         |
| `/record resume`, restart      | ✅ verified live (resume with its session list; a restart mid-set carried on in 18 s, re-leveling)     |
| Long-silence alert             | ✅ verified live (⚠️ and reopen at 5 min, ✅ when audio returned, screenshots saved)                   |
| Uploaded sets                  | ✅ verified live (Add set…, import and leveling in ~20 s)                                              |
| Discord popups                 | 🔨 deployed; opens and screenshots verified, but no popup has appeared since to close                  |
| Download cap (200 Mbit/s each) | 🔨 deployed; not yet seen under load                                                                   |
| Browser only around sessions   | 🔨 built; `/record check`, start on demand and the 2 h idle close not yet tested live                  |
| Login rate limit, body cap     | 🔨 deployed; not yet tested live                                                                       |
| Upload free-space check        | 🔨 deployed; not yet tested live                                                                       |
| Download counts                | 🔨 deployed; not yet tested live                                                                       |

## Next

1. **Test the on-demand browser** on the server: after deploying, the recorder idles near 0% CPU; `/record check` starts the browser and replies privately; `/record start` with the browser closed defers, then posts its public reply; the browser closes 2 h after `/record stop` (log: `browser idle; closing it`).
2. **After the next event:** check the recorder's screenshots (`APP_DATA_DIR/recorder/screenshots`) and logs (`closed Discord popups`, `could not open stream`, `stream silent too long`) to see whether the popup handling held, and whether downloads stayed quick for everyone.

## Environment notes

- **Server:** `~/.services/discord-stream-recorder`, read-only deploy key (`github-dsr` host alias). Update with `git pull` + `docker compose up -d --build`. The local recorder must stay stopped: it's the same Discord account.
- **Dev machine (WSL2):** the archive runs with `pnpm --filter @dsr/archive dev` against `data/recordings` and `docker-data/archive`. WSL2's clock drifts and drops ~6% of captured audio; `wsl --shutdown` resets it (the server isn't affected).
- `.env` holds secrets; never print it.
