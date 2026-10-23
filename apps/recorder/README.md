# @dsr/recorder

The Discord bot, session control and browser-driven Go Live capture. It runs in a container with Xvfb, PulseAudio and noVNC (`Dockerfile`, `docker/entrypoint.sh`).

## Modules

| Path                         | Responsibility                                                                                | Status        |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ------------- |
| `src/config.ts`              | Env config, split into sections: `discord`, `browser`, `capture`, `processing`, `session`.    | done          |
| `src/browser/launch.ts`      | Playwright persistent context: headed, unmuted, autoplay allowed, mic permission.             | done          |
| `src/smoke.ts`               | Milestone 1: open Discord and stay up for login and audio checks.                             | done          |
| `src/browser/discord-web.ts` | Page automation: join or leave voice, mute members, open a stream, spot logouts.              | milestone 2/4 |
| `src/bot/`                   | discord.js client, `/record` command registration and handlers, stream start/end events.      | milestone 3   |
| `src/session/`               | Session manager (state machine), picking the target channel, pre-flight checks, `state.json`. | milestone 3/4 |
| `src/capture/`               | Builds the capture arguments and runs them with `@dsr/media`'s `spawnFfmpeg`.                 | milestone 4   |
| `src/pipeline/`              | After each set: loudnorm, exports, updating `session.json` and the set list.                  | milestone 5   |
| `src/main.ts`                | Composition root that wires all of the above.                                                 | milestone 4   |

The design is in [docs/plan.md](../../docs/plan.md).
