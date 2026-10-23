# @dsr/recorder

The Discord bot, session control and browser-driven Go Live capture. It runs in a container with Xvfb, PulseAudio and noVNC (`Dockerfile`, `docker/entrypoint.sh`).

## Modules

| Path                         | Responsibility                                                                                                                                                              | Status             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/config.ts`              | Env config, split into sections: `discord`, `browser`, `capture`, `processing`, `session`.                                                                                  | done               |
| `src/browser/launch.ts`      | Playwright persistent context: headed, unmuted, autoplay allowed, mic permission.                                                                                           | done               |
| `src/smoke.ts`               | Milestone 1: open Discord and stay up for login and audio checks.                                                                                                           | done               |
| `src/browser/discord-web.ts` | Page automation, and every Discord selector: open the channel, mute and deafen, join or leave voice, open a stream, set its volume, spot logouts.                           | prototype (m4)     |
| `src/probe.ts`               | Milestone 4 prototype: runs the `discord-web.ts` steps against a live channel and saves aria snapshots, HTML and screenshots after each.                                    | prototype (m4)     |
| `src/bot/`                   | discord.js client (`bot.ts`), `/record` definition (`commands.ts`), handlers, reply text (`messages.ts`), Go Live event mapping (`voice-events.ts`), recorder access check. | done (milestone 3) |
| `src/session/`               | `SessionManager` (active session + handover rules), `StreamTracker` (who is live), `resolveTargetChannel`. `state.json` persistence comes in milestone 9.                   | done (milestone 3) |
| `src/capture/`               | Builds the capture arguments and runs them with `@dsr/media`'s `spawnFfmpeg`.                                                                                               | milestone 4        |
| `src/pipeline/`              | After each set: loudnorm, exports, updating `session.json` and the set list.                                                                                                | milestone 5        |
| `src/main.ts`                | Composition root. Milestone 3: bot + sessions, logging target changes. Browser and capture get wired in milestone 4.                                                        | partial            |

The design is in [docs/plan.md](../../docs/plan.md).
