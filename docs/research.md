# Research Notes

This file holds the facts behind [plan.md](plan.md), with sources. Official docs are used where they exist. Anything marked **unverified** has to be confirmed during the milestone tests.

Last checked: 2026-10-23.

## Confirmed

### Bots can't watch Go Live, but they can see it start and stop

- The voice state object has a `self_stream` field, "whether this user is streaming using 'Go Live'". [Discord docs: Voice State](https://docs.discord.com/developers/resources/voice)
- `VOICE_STATE_UPDATE` is delivered under the `GUILD_VOICE_STATES` (1 << 7) intent. That intent is **not privileged**; the privileged ones are `GUILD_PRESENCES`, `GUILD_MEMBERS` and `MESSAGE_CONTENT`. [Discord docs: Gateway](https://docs.discord.com/developers/events/gateway)
- discord.js shows this as `VoiceState.streaming` (`boolean | null`). The client event is `voiceStateUpdate(oldState, newState)`. [discord.js VoiceState](https://discord.js.org/docs/packages/discord.js/main/VoiceState:Class), [discord.js Client](https://discord.js.org/docs/packages/discord.js/main/Client:Class)
- In the raw API types the field is optional, so treat `null` or a missing value as `false`. [discord-api-types APIVoiceState](https://discord.js.org/docs/packages/discord-api-types/main/v10/APIVoiceState:Interface)
- The current discord.js release is **14.27.0**, which needs Node >= 18. (npm registry, `discord.js/latest`)

### Slash commands

- **Guild vs global:** guild commands "update **instantly**", so we register `/record` as a guild command. Global commands take time to propagate. [Discord docs: Application Commands](https://docs.discord.com/developers/interactions/application-commands)
- **`default_member_permissions`** is a permission bitfield string that sets who can use a command by default. `"0"` means admins only. Server admins can override it per role, user or channel in Server Settings → Integrations, and apps can't change those overrides with a bot token. [Discord docs: Application Commands](https://docs.discord.com/developers/interactions/application-commands)
- **Subcommands:** once a command has subcommands, the base command can't be run on its own. That fits `/record start|stop|status`. [Discord docs: Application Commands](https://docs.discord.com/developers/interactions/application-commands)
- **Interactions:** the initial response is due within **3 seconds**, or the token is invalidated. Tokens last **15 minutes** for follow-ups. The `EPHEMERAL` flag (`1 << 6`) makes a message visible only to the user. The interaction carries `channel` / `channel_id` for the channel it was sent from. [Discord docs: Receiving and Responding](https://docs.discord.com/developers/interactions/receiving-and-responding)
- **discord.js:** `BaseChannel.isVoiceBased()` is a type guard for voice and stage channels. [discord.js BaseChannel](https://discord.js.org/docs/packages/discord.js/14.27.0/BaseChannel:Class), [discord.js ChatInputCommandInteraction](https://discord.js.org/docs/packages/discord.js/main/ChatInputCommandInteraction:Class)
- **Unverified:** the docs don't say outright that `channel_id` is the voice channel itself when a command is typed in a voice channel's built-in text chat. It's expected, since that chat _is_ the voice channel, but test it in milestone 3. The "the person's current voice channel" fallback covers it if not.

### Self-bots are forbidden

- "Automating normal user accounts (generally called 'self-bots') outside of the OAuth2/bot API is forbidden, and can result in an account termination if found." [Discord Support](https://support.discord.com/hc/articles/115002192352)
- Driving the web client with Playwright isn't named, but falls under "automating normal user accounts". **Use a throwaway recorder account.**

### All voice and video is end-to-end encrypted (DAVE)

- Discord finished the migration in early March 2026. E2EE is now standard for all voice and video calls except Stage channels. [Discord blog](https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted), [Help Net Security](https://www.helpnetsecurity.com/2026/05/19/discord-voice-and-video-call-encryption/)
- Clients and apps without DAVE support have been unable to join calls since 2026-03-01. [ElevenForum summary](https://www.elevenforum.com/t/starting-march-1st-2026-clients-and-apps-without-dave-support-will-no-longer-be-able-to-participate-in-discord-calls.39488/latest)
- DAVE was designed with browsers in mind and uses the WebRTC Encoded Transform API. [Discord blog: Bringing DAVE to all platforms](https://discord.com/blog/bringing-dave-to-all-discord-platforms)
- **What this means here:** using the real web client means Discord's own code handles decryption, so we never implement DAVE. This is one more reason against having a bot receive voice directly. The optional RTC-hook idea (plan.md) has to read tracks _after_ the decryption transform. **Unverified** that the receiver's track is already decrypted audio; it should be, because the transform runs before decoding.

### Go Live works in browsers

- Discord said Go Live "fully works in all supported browsers". [Discord blog: Server Video](https://discord.com/blog/wave-hello-to-server-video). This post is old, so current behaviour is confirmed in milestone 2.
- Community complaints about browser audio concern _sending_ audio from a browser, not watching. [Discord community](https://support.discord.com/hc/it/community/posts/360050692412-Add-Go-Live-Support-for-Browsers)

### Playwright

- Official Docker image: `mcr.microsoft.com/playwright:v1.64.0-noble` (Ubuntu 24.04); `-jammy` and `-resolute` variants also exist. Pin the image to the npm `playwright` version. Run with `--init` and `--ipc=host`; without `--ipc=host`, Chromium can run out of memory. [Playwright Docker](https://playwright.dev/docs/docker)
- The Docker docs don't cover headed mode or Xvfb, so we add Xvfb ourselves.
- **Playwright passes `--mute-audio` to Chromium by default.** Remove it with `ignoreDefaultArgs: ['--mute-audio']`, or there's no audio to capture. [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)
- `launchPersistentContext(userDataDir, …)` keeps cookies and local storage, so the login survives restarts. Only one browser instance can use a given `userDataDir`. Don't point it at a personal Chrome profile. [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)
- Bundled Chromium lacks some codecs that Chrome bundles "due to various licensing considerations"; use `channel: 'chrome'` if a site needs them. Headed mode uses the regular Chromium build; headless uses a separate headless shell. [Playwright Browsers](https://playwright.dev/docs/browsers)

### ffmpeg

- `pulse` input: the `-i` argument is a PulseAudio source name (list them with `pactl list sources`). Defaults are 48 kHz and 2 channels; the `wallclock` timestamps option is on by default. A null sink's monitor source is named `<sink>.monitor`. [ffmpeg devices: pulse](https://ffmpeg.org/ffmpeg-devices.html)
- `x11grab`: options include `framerate`, `video_size` and `draw_mouse` (set it to `0` to hide the pointer). Example: `ffmpeg -f x11grab -framerate 25 -video_size cif -i :0.0 out.mpg`. [ffmpeg devices: x11grab](https://ffmpeg.org/ffmpeg-devices.html)
- `loudnorm` (EBU R128) [ffmpeg filters: loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm):
  - `I` -70…-5 (default -24), `LRA` 1…50 (default 7), `TP` -9…0 (default -2).
  - `measured_I`, `measured_LRA`, `measured_TP`, `measured_thresh` take values from the first pass. `offset` is the gain applied before the true-peak limiter.
  - `linear` defaults to true. It needs all `measured_*` values, and falls back to dynamic mode when the targets can't be met linearly.
  - `print_format`: `summary`, `json` or `none`. Pass 1 uses `json`.

### Node

- Node 20.6+ supports `--env-file=.env`, and 22.9+ adds `--env-file-if-exists`. Both are stable since v22.21.0 / v24.10.0. Real environment variables override the file. The current LTS lines are 22.x and 24.x. [Node CLI docs](https://nodejs.org/api/cli.html)
- File syntax: `KEY=VALUE`, `#` comments (also at the end of a line), optional quotes, quoted multi-line values, and an `export` prefix, which is ignored.
- **Caveat:** an unquoted `#` starts a comment, so quote any value that contains `#`, such as the VNC password.

### Archive access and hosting

- **Discord OAuth2** (if the archive uses "Login with Discord"): the authorization-code grant goes through `https://discord.com/oauth2/authorize`, then a POST to `https://discord.com/api/oauth2/token`. Validate `state`, and check that `iss` is `https://discord.com`. The `guilds.members.read` scope allows `GET /users/@me/guilds/{guild.id}/member`, which returns the user's member object (roles included) for one server. That's enough to limit access to server members or a role. [Discord docs: OAuth2](https://docs.discord.com/developers/topics/oauth2)
- **Cloudflare and video:** Cloudflare's 2023 terms update says the video and large-file restriction applies only to content served through its **CDN**, unless the content is hosted on Cloudflare products such as Stream or R2. [Cloudflare blog: updated ToS](https://blog.cloudflare.com/updated-tos/). The home server's records are "DNS only", so traffic doesn't pass through the CDN and the restriction doesn't apply. **If the archive is ever moved behind the orange-cloud proxy or a Cloudflare Tunnel, re-check this.** Whether Tunnel counts is unclear, and community reports conflict. [Lemmy thread (anecdotal)](https://lemmy.imagisphe.re/post/1477461/4120287)
- **Cloudflare Tunnel** connects outbound only and needs no inbound ports. [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/). It isn't used by the media stack repo; see below.
- **Tailscale Funnel**, as an alternative, has "non-configurable bandwidth limits" that aren't published, and only listens on ports 443, 8443 and 10000. That makes it a poor fit for serving hour-long sets publicly. [Tailscale docs](https://tailscale.com/docs/features/tailscale-funnel)

### Home server setup

These facts come from the media stack repo (`origin/main` at `9dd11ab`, fetched 2026-10-23), not from the live server:

- Traefik (`image: traefik`) on host ports 80/443 uses the Docker provider with `exposedbydefault=false`. Entrypoints are `web` (redirects to HTTPS) and `websecure`.
- The `letsencrypt` resolver uses Cloudflare's DNS challenge (`CF_DNS_API_TOKEN_FILE`) for a wildcard cert: `${DOMAIN}` + `*.${DOMAIN}` as the default TLS domains on `websecure`.
- The shared network `media_network` is a bridge network, `attachable: true`. Other compose files join it as an external network.
- Cloudflare DNS: an `A media` record points to the public IP, and every app has a CNAME → `media.${DOMAIN}`, all "DNS only". There's no NAT loopback, so the LAN uses a hosts file or local DNS override.
- Authentik forward auth middleware: `authentik@docker` (embedded outpost, `forward_domain` provider). Its login source is Plex.
- **No `cloudflared` / Cloudflare Tunnel appears in that repo.** Tunnels on the server belong to other stacks (see below).

Checked on the live server over SSH on 2026-10-23 (read-only):

- Ubuntu 25.04, x86_64, 16 cores, 30 GiB RAM (about 19 GiB available, swap 5.6 of 8 GiB used), Docker 28.5.1, Compose v2.40.1, TZ `America/Chicago`.
- Disk: `/` NVMe 937 GB with 746 GB free; `/mnt/media` 7.3 TB with 1.5 TB free (79% used).
- Cloudflare Tunnels: three `cloudflare/cloudflared` sidecars, one per stack (the lists app, quote-wall, the TeamSpeak manager). Each runs `tunnel --no-autoupdate run` with a token, which means a remotely managed tunnel whose ingress is set in the Cloudflare dashboard. Each sits only on its stack's own network, not `media_network`.
- Traefik routers: only the media stack's apps (Plex, the *arrs, Authentik, Audiobookshelf, CWA, Shelfmark, Seerr, DockMon, qBittorrent).
- ufw status couldn't be read (needs sudo).
- Ubuntu 25.04 is an interim release, so check its support window. It doesn't block this project.

### Recorder container (milestone 1, 2026-10-23)

- The image's `pwuser` is UID 1001, and Ubuntu's `ubuntu` user holds 1000, so bind mounts owned by the host user (1000) weren't writable. **Fixed** with `PUID`/`PGID` build args that remove `ubuntu` and renumber `pwuser`. Checked: `/config` and `/recordings` are writable.
- Installed in the image: Google Chrome 156.0.8078.47 (`playwright install chrome`), ffmpeg 6.1.1, Node 24.22.1.
- **Chrome → PulseAudio → ffmpeg works.** A 440 Hz WebAudio oscillator in Chrome (launched by `launchBrowser`, so with `--mute-audio` removed) shows up as a sink input on `recorder` (`float32le 2ch 44100Hz`, resampled by Pulse to the sink's 48 kHz). ffmpeg's capture of `recorder.monitor` measured peak 0.0 dB and mean −3.0 dB, as expected for a full-scale sine.
- Discord's web login page renders in Chrome on Xvfb.
- Startup problems fixed:
  - `tsx` didn't resolve from `/app` (pnpm doesn't hoist), so the container now runs from `/app/apps/recorder`.
  - Xvfb needs a root-owned `/tmp/.X11-unix` (1777), now created at build time.
  - `pactl` auto-started a second PulseAudio daemon. PulseAudio now runs `-n -F /etc/pulse/recorder.pa` with client autospawn disabled.
  - A restarted container kept a stale X lock and Pulse runtime dir; the entrypoint now clears both.
- **The login persists** in `/config/profile` across restarts and container recreation (checked 2026-10-23; the account shows as logged in after `docker compose restart` and after `up --build`).
- **Shutdown:** Playwright's default SIGTERM handler kills Chrome outright. We disable it (`handleSIGTERM: false`, and the same for INT and HUP) and call `context.close()` ourselves, which finishes in about 120 ms. Chrome still records `exit_type: "Crashed"` after a DevTools-protocol close (a known quirk of automated closes); `--hide-crash-restore-bubble` keeps the "Restore pages?" popup off screen. Stale `Singleton*` lock files are removed at startup, because they name the old container's hostname.
- **Open:** Chrome shows an "unsupported command-line flag: --no-sandbox" info bar, because Playwright disables the Chromium sandbox by default. It would show up in video captures (milestone 6). Options: `chromiumSandbox: true` (needs Docker seccomp/userns support), or hiding the bar.

### Discord stream capture (milestone 2, 2026-10-23)

Setup: the recorder account in a voice channel, watching a Go Live stream of a browser tab (music) from a second account, which also talked in voice.

- **Stream audio reaches the capture.** Discord's WebRTC stream audio plays through Chrome into the `recorder` sink, and ffmpeg records it from `recorder.monitor` (48 kHz stereo float32, no NaN or Inf samples).
- **Chrome uses one sink input** ("Google Chrome", "Playback") for all of Discord's audio, so voice and stream are mixed before PulseAudio sees them.
- **Baseline, streamer's user volume at 100%:** voice bursts are clearly visible, with peaks around −15 dBFS over the music. Integrated −30 LUFS, peak −12 dBFS.
- **Streamer's user volume at 0%:** no voice in the spectrogram, and the user heard none on listening back. With the stream paused while they talked, the capture was digital silence. Music-only level: −49 LUFS, peak −40 dBFS.
- **The stream volume slider defaults to 50%** on the viewer side, which accounts for part of the low level. The rest is the source (tab or system volume). Leveling copes, but a hot source is better.
- Test files (git-ignored): `data/recordings/_tests/m2-baseline.wav`, `m2-isolation.wav`.
- **Self-deafen keeps Go Live stream audio playing**, and only silences voice chat. The user confirmed this from their own use; it wasn't captured here. The recorder uses deafen as its isolation method; per-user 0% volume (captured above) is the fallback.

### Discord web client automation (milestone 4 prototype, 2026-10-23)

Run with `probe.ts` in the recorder container against a live channel, with the user streaming music from a browser tab. All selectors are in `apps/recorder/src/browser/discord-web.ts`.

- **Join flow:** opening `discord.com/channels/<guild>/<channel>` and clicking the sidebar entry `[data-list-item-id="channels___<channel id>"]` joins voice directly. There was no mic prompt (the `microphone` permission is granted at launch), and no captcha or other automation warning appeared in seven runs.
- **Mute and deafen can be set before joining.** They're `switch "Mute"` / `switch "Deafen"` (`aria-checked`) in `region "User status and settings"`, and they stay on after joining. That region also holds the voice `Disconnect` button. The call view has a second `Disconnect`, so selectors must be scoped to the region.
- **Call tiles carry the user ID:** `[data-call-tile][data-selenium-video-tile="<user id>"]`. A live user has two: an avatar tile (`button "Call tile, <username>"`) and a stream tile (`button "Call tile, stream, <username>"`). The labels use the **username**, not the server display name. While a stream is open, its tile appears twice (main view and thumbnail strip).
- **Opening a stream:** hover the stream tile and click its `Watch Stream` button. `button "Stop Watching"` appears once it's open.
- **Stream volume:** right-click the stream tile and use the `slider` in the context `menu`. It has `aria-valuenow` and moves with the arrow keys; the probe stepped it to exactly 100.
- **Don't click the call view's `Control volume` button.** A click **mutes the stream**. Its hover slider is a plain `div` with no ARIA role or value.
- **Discord remembers a stream mute** per streamer, for this account, across sessions. A muted stream records as silence (−91 dB mean, i.e. digital zero). While muted, the stream tile has a `button "Unmute"` in its overlay, which only shows on hover. The controller unmutes on every open.
- **Level, 50% → 100%:** mean −50.8 and −49.2 dB at the default 50% (two runs), −32.6 dB (peak −19.8) at 100%. That's about +17 dB, not the +6 dB a linear slider would give, so Discord's slider is probably a perceptual curve. These were different moments of the same music, so treat the number as rough.

## Unverified / to test

| Question                                                                                       | Why it matters                                                                                                                                                    | How we'll check                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Does bundled Chromium decode Discord's stream video, or do we need the `chrome` channel?       | Codecs (H.264). Chrome is amd64-only on Linux.                                                                                                                    | Try `chromium` first, then `chrome`.                                                                                     |
| Does the AFK timeout or an AFK bot move the muted and deafened recorder?                       | It could kick the recorder mid-event.                                                                                                                             | Exempt it (plan.md, "Bot setup" step 6); the controller also rejoins if it's moved. Watch for it in the first long test. |
| Go Live viewer limit and resolution                                                            | The recorder takes one viewer slot. Video quality is capped by the streamer's tier. Third-party sources conflict: 10 vs 50 viewers; 720p30 free vs 1080p60 Nitro. | Not critical; note it in the DJ guide.                                                                                   |
| Does Discord flag Playwright-driven sessions (`navigator.webdriver`, captchas)?                | Risk to the recorder account and to reliability.                                                                                                                  | Nothing seen in seven probe runs (2026-10-23). Keep watching; keep the automation minimal.                               |
| Is the decrypted Go Live track reachable through an `RTCPeerConnection` hook?                  | Only matters for the optional perfect-isolation mode.                                                                                                             | Later, only if user volumes leak.                                                                                        |
| Does a command typed in a voice channel's text chat report that voice channel as `channel_id`? | Picking the target channel (plan.md → Commands).                                                                                                                  | Milestone 3.                                                                                                             |
| What time does the stream-end event arrive compared with the audio actually stopping?          | The tail end of a set could be cut.                                                                                                                               | Add `TAIL_PADDING_SECONDS` if needed; then trim silence in post-processing.                                              |

## Rejected options

- **Bot records the DJ's mic:** DJs would have to route their mix into the mic and disable voice processing. Lower quality, and it depends on every DJ setting it up right. The receiving side also needs DAVE support in the library. Ruled out by the user.
- **OBS on a desktop:** works, but someone has to operate it. Kept as a manual fallback if the automated recorder fails during an event.
- **Self-bot libraries that watch streams through the raw API:** same ToS risk as the browser approach, more fragile, and they'd need their own DAVE implementation.
