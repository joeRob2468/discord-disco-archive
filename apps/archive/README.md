# @dsr/archive

The web archive of recorded sessions, built with Hono and server-rendered with `hono/jsx`. It reads the recordings volume **read-only** and treats each `session.json` as the source of truth.

| Path            | Responsibility                                                                       | Status          |
| --------------- | ------------------------------------------------------------------------------------ | --------------- |
| `src/config.ts` | Env config: recordings dir, port, public URL.                                        | done            |
| `src/app.ts`    | Routes. Built by `createApp(deps)` so tests can call `app.request()` without a port. | `/healthz` only |
| `src/main.ts`   | Starts the HTTP server and shuts down gracefully on SIGINT/SIGTERM.                  | done            |
| `src/catalog/`  | Scans `*/session.json`, indexes by session and by streamer, watches for changes.     | milestone 7     |
| `src/views/`    | Session list, session page, streamer list, streamer page, players.                   | milestone 7     |
| `src/auth/`     | Optional shared password (`ARCHIVE_PASSWORD`), later Discord login.                  | milestone 7+    |

Media files are served with `@hono/node-server`'s `serveStatic`, which supports Range requests, so seeking works in long sets. The design is in [docs/plan.md, "Archive site"](../../docs/plan.md#archive-site).
