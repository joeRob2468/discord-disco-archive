# @dsr/recorder

The Discord bot, session control and browser-driven Go Live capture. It runs in a container with Xvfb, PulseAudio and noVNC (`Dockerfile`, `docker/entrypoint.sh`).

## Modules

| Path                         | Responsibility                                                                                                                                                                         | Status             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `src/config.ts`              | Env config, split into sections: `discord`, `browser`, `capture`, `processing`, `session`.                                                                                             | done               |
| `src/browser/launch.ts`      | Playwright persistent context: headed, unmuted, autoplay allowed, mic permission.                                                                                                      | done               |
| `src/smoke.ts`               | Open Discord and stay up, for logging in over noVNC.                                                                                                                                   | done               |
| `src/browser/discord-web.ts` | Page automation, and every Discord selector: open the channel, mute and deafen, join or leave voice, open a stream, set its volume, spot logouts.                                      | prototype (m4)     |
| `src/probe.ts`               | Milestone 4 prototype: runs the `discord-web.ts` steps against a live channel and saves aria snapshots, HTML and screenshots after each.                                               | prototype (m4)     |
| `src/bot/`                   | discord.js client (`bot.ts`), `/record` definition (`commands.ts`), handlers, reply text (`messages.ts`), Go Live event mapping (`voice-events.ts`), recorder access check.            | done (milestone 3) |
| `src/session/`               | `SessionManager` (active session + handover rules), `StreamTracker` (who is live), `resolveTargetChannel`. `state.json` persistence comes in milestone 9.                              | done (milestone 3) |
| `src/capture/`               | `controller.ts` (joins/leaves voice, opens streams, one ffmpeg capture per set, silence handover; all steps on one queue) and `session-record.ts` (session folder and `session.json`). | done (m4)          |
| `src/pipeline/`              | `process-set.ts` (analyse, trim, level to a FLAC master, exports, mark `ready`/`failed`) and `processor.ts` (one job at a time, aborted on shutdown).                                  | milestone 5        |
| `src/reprocess.ts`           | Re-run post-processing for a session folder: sets left `processing` or `failed`, or all with `--all`.                                                                                  | milestone 5        |
| `src/main.ts`                | Composition root: bot, sessions, browser and recording controller in one process. The container's command.                                                                             | done (m4)          |

The design is in [docs/plan.md](../../docs/plan.md).
