# @dsr/archive

The web archive of recorded sessions: browse, search, play and download sets, and edit, archive or delete them as an admin. It uses Hono, server-rendered with `hono/jsx` (htmx and one player script, no client-side framework), plus SQLite (`better-sqlite3`). Recordings are only read, except by admin deletes (`src/recordings.ts`); the database lives in `/config` (`ARCHIVE_DATA_DIR`).

Design: [docs/design.md, "Archive" and "Storage"](../../docs/design.md#archive).

## Modules

| Path                     | Responsibility                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`            | Composition root: config, database, catalog watcher, HTTP server, graceful shutdown.                                                                                                                           |
| `src/app.ts`             | `createApp(deps)`: middleware (secure headers, CSRF, auth, viewer gate), routes, error handling. Tests call `app.request()` on it.                                                                             |
| `src/config.ts`          | Env config, including password/secret cross-checks.                                                                                                                                                            |
| `src/db/`                | `database.ts` opens the database (WAL, foreign keys) and runs migrations. `migrations.ts` holds the append-only schema, including the `set_view` and `session_view` views that resolve edits.                  |
| `src/catalog/sync.ts`    | Mirrors `session.json` files into `recorded_*` columns, flags missing items, rebuilds the search index.                                                                                                        |
| `src/catalog/watch.ts`   | Debounced `fs.watch` plus a periodic full sync.                                                                                                                                                                |
| `src/catalog/catalog.ts` | `Catalog`: every read query and every edit (with audit log and reindexing). The only place with SQL for app data.                                                                                              |
| `src/catalog/search.ts`  | FTS5 query building (`toMatchQuery`) and reindexing.                                                                                                                                                           |
| `src/auth/auth.ts`       | Shared-password roles (viewer and admin), signed session cookie, `safeNext`.                                                                                                                                   |
| `src/routes/`            | `browse.tsx` (GET pages), `admin.tsx` (admin panel, edit posts, image uploads), `session.tsx` (login/logout), `media.ts` (file streaming), `params.ts` (input parsing).                                        |
| `src/views/`             | `layout.tsx` (shell, menu, player bar), page views (`home`, `search`, `album`, `tables`, `admin`, `pages`), `cards.tsx`, `edit.tsx` (admin dialogs), `play.tsx`, `art.ts`, `links.ts`, `format.ts`, `app.css`. |
| `src/client/`            | The player script (TypeScript, DOM tsconfig), bundled into `dist/player.js`.                                                                                                                                   |
| `src/recordings.ts`      | Permanent deletes: a set's files and `session.json` entry, or a session folder. The only writes to the recordings volume.                                                                                      |
| `src/test/fixtures.ts`   | Temporary recordings volume with `session.json` and media, for tests.                                                                                                                                          |

## Rules

- Routes never touch SQL or the filesystem directly. They go through `Catalog`, or `serveStatic` with a path that came from the catalog.
- Edit columns are never written by sync, and `recorded_*` columns are never written by edits.
- Anything admin-only goes through `requireAdmin` on the route itself. Non-admins get 404, not 403.
- Schema changes are a **new** entry in `migrations.ts`; never edit a shipped one.

## Running

```sh
pnpm --filter @dsr/archive dev      # from the repo root's .env; http://localhost:3000
docker compose up --build archive
```
