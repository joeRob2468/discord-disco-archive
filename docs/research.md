# Research

Verified facts behind [design.md](design.md), with sources. Last checked 2026-10-23.

## Discord

- **Go Live is visible to bots:** voice states carry `self_stream` (discord.js `VoiceState.streaming`, `null` = false), delivered under the non-privileged `GUILD_VOICE_STATES` intent. Bots can't watch the stream itself. [Voice State](https://docs.discord.com/developers/resources/voice), [Gateway](https://docs.discord.com/developers/events/gateway)
- **Slash commands:** guild commands update instantly; `default_member_permissions` sets who can use them and server admins can override it per role or channel; replies are due within 3 s and the token lasts 15 min. [Application Commands](https://docs.discord.com/developers/interactions/application-commands), [Receiving and Responding](https://docs.discord.com/developers/interactions/receiving-and-responding)
- **Self-bots are forbidden** and can get the account terminated. [Discord Support](https://support.discord.com/hc/articles/115002192352)
- **All voice and video is end-to-end encrypted (DAVE)** since March 2026. Using the real web client means Discord's own code decrypts it. [Discord blog](https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted)
- **Self-deafen silences voice chat but not Go Live audio** (confirmed by the user). Setting a member's user volume to 0% also works (verified by capture).
- **Notification sounds** are a per-browser setting (User Settings → Notifications → Disable All Notification Sounds). With it on and the recorder deafened, joins, leaves and an @mention captured as digital silence (−91 dB).

## Discord web client (selectors in `apps/recorder/src/browser/discord-web.ts`)

- Opening `discord.com/channels/<guild>/<channel>` and clicking the sidebar entry joins voice. Mute and deafen (`switch "Mute"`/`"Deafen"` in the "User status and settings" region) can be set before joining and stay on.
- Call tiles carry the user ID (`data-selenium-video-tile="<user id>"`); labels use the username, not the server nickname. A stream opens with its tile's `Watch Stream` button.
- **Stream volume** defaults to 50% (the slider in the stream tile's context menu); 85–100% measured about 17 dB louder. Its steps are uneven, so the controller accepts ±0.5.
- **Discord remembers a stream mute** per streamer for the account, and a muted stream records silence. Never click the call view's `Control volume` button: it mutes the stream.
- No captcha or automation warning appeared in many automated joins.

## Audio

- **Chromium plays Discord's stream audio in mono** (it downmixes Opus without `stereo=1` in the SDP, which Discord doesn't send); Firefox and the desktop app play stereo. Verified with a left/right test: Chrome's side channel was −87 to −91 dB, Firefox's −27 to −39 dB. [Discord community](https://support.discord.com/hc/da/community/posts/23128064608151-Fix-stereo-audio-for-Chromium-based-browsers-perhaps-WebRTC-SDP-issue), [MediaMTX #2043](https://github.com/bluenviron/mediamtx/issues/2043). Patching the SDP in the page didn't work.
- **Firefox plays into PulseAudio at float32 48 kHz stereo.** Playwright's Firefox ignores `-width`/`-height`; `--kiosk` with `viewport: null` fills the Xvfb screen.
- **ffmpeg capture:** `-c:a pcm_f32le` before `-f pulse -i` reads float32 from PulseAudio (the default is s16). A null sink's monitor is `<sink>.monitor`. [ffmpeg devices](https://ffmpeg.org/ffmpeg-devices.html)
- **WSL2's monotonic clock drifts** (~7% slow, often after the host sleeps), so PulseAudio plays slow and ~6% of the stream audio is dropped. `wsl --shutdown` resets it; the bare-metal server is unaffected (captures match their wall time).

## Leveling

- **loudnorm's pass 2 only stays linear** if the measured LRA is within `LRA` and the gain wouldn't push peaks over `TP`; otherwise it silently compresses. So pass 2 is a fixed gain plus `alimiter` at 192 kHz (ceiling 0.3 dB under the target): masters land at −14.0 to −14.4 LUFS with true peaks at or under −1.3 dBTP. MP3 exports keep the loudness. [loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)
- Don't pass pass 1's `offset` to pass 2 (dynamic mode applies it as extra gain).
- With loudnorm, ffmpeg's last `time=` lags the input by ~3 s; take the duration from the `Duration:` line.
- The chain is transparent: raw, master and exports measure the same loudness range and high-frequency energy.

## Platform

- **Playwright** mutes Chromium by default (`--mute-audio`; removed with `ignoreDefaultArgs`). Its Docker image is pinned to the npm version; run with `--init` and `--ipc=host`. Its SIGTERM handler kills the browser, so the recorder closes it itself. [Playwright Docker](https://playwright.dev/docs/docker)
- **pnpm doesn't hoist**, so each image runs from its package folder for `tsx` to resolve.
- **`better-sqlite3`** ships prebuilt binaries with FTS5; `unicode61 remove_diacritics 2` matches `cafe*` against "Café". `node:sqlite` is still experimental on Node 24.
- **`@hono/node-server`'s `serveStatic`** handles Range requests (206) but types `.m4a` as `application/octet-stream`, so the media route sets the type itself.
- **Node `--env-file`:** an unquoted `#` starts a comment, so quote values containing `#`.
- **Cloudflare:** the video/large-file restriction applies to content served through its CDN. DNS-only records bypass it. If the archive ever moves behind the proxy or a Tunnel, re-check. [Cloudflare blog](https://blog.cloudflare.com/updated-tos/)
- **daisyUI** sets `scrollbar-gutter` on `:root`, which beats layered rules; ours is unlayered.

## Unverified

| Question                                                        | Why it matters                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| Is the first 1–3 s of a capture lost while ffmpeg starts?       | Short starts were logged on the server; later segments were OK. |
| Does Discord's captcha appear as `iframe[src*="hcaptcha.com"]`? | That's how `browser/health.ts` detects it.                      |
| Does an AFK timeout or AFK bot move the deafened recorder?      | It would drop out of voice mid-event (it rejoins).              |
| Does the stream-end event arrive before the audio stops?        | The tail of a set could be cut.                                 |
| Does Discord flag Playwright-driven sessions over time?         | Risk to the recorder account.                                   |

## Rejected

- **A bot recording the DJ's mic:** every DJ would need to route their mix through voice with processing off; lower quality.
- **OBS on a desktop:** needs an operator. Kept as a manual fallback.
- **Postgres** for the archive: a single-process app doesn't need a database server.
- **Self-bot libraries** watching streams through the raw API: same ToS risk, more fragile, and they'd need DAVE.
- **Cloudflare Tunnel** for the archive: traffic would pass through Cloudflare's network (see Platform).
