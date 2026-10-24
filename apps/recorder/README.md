# @dsr/recorder

The bot, session rules, browser-driven Go Live capture and post-processing, in one process. Runs in a container with Xvfb, PulseAudio and noVNC (`Dockerfile`, `docker/`). Design: [docs/design.md](../../docs/design.md).

| Path                           | Responsibility                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.ts`                  | Composition root: bot, session manager, browser, controller, processor, health monitor, retention sweep.                                   |
| `src/config.ts`                | Env config in sections: `discord`, `browser`, `capture`, `processing`, `session`.                                                          |
| `src/bot/`                     | discord.js client, `/record` definition and handlers, reply and notice text, Go Live event mapping, recorder access check.                 |
| `src/session/`                 | `SessionManager` (active session, handover rules, restart grace), `StreamTracker` (who is live), target channel choice.                    |
| `src/browser/`                 | `launch.ts` (Playwright persistent context), `discord-web.ts` (every Discord selector and page step), `health.ts` (logout/captcha checks). |
| `src/capture/`                 | `controller.ts` (voice, streams, one capture per set or segment, rejoin after drops) and `session-record.ts` (`session.json`).             |
| `src/pipeline/`                | `process-set.ts` (analyse, trim, level, export, settle `partial`), `processor.ts` (one job at a time), `retention.ts` (cleanup).           |
| `src/reprocess.ts`             | Re-level a session folder's `processing`/`failed` sets, or all with `--all`.                                                               |
| `src/smoke.ts`, `src/probe.ts` | Open Discord for logging in; step through the browser actions against a live channel (for fixing selectors).                               |
