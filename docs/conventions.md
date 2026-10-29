# Conventions

How code in this repo should look and be organised. Setup and scripts are in [development.md](development.md).

## Architecture rules

- **Apps own I/O; packages own logic.** `packages/*` export functions, classes and schemas and do nothing at import time. Each app has one composition root (`src/main.ts`) that loads config, creates loggers and wires modules.
- **Dependencies point one way:** `apps/*` → `packages/*`. Packages never import apps. `@dsr/media` doesn't depend on `@dsr/core`.
- **Config:** each app has exactly one `src/config.ts`, a zod schema read through `@dsr/core`'s `parseEnv`, split into sections so a module only needs its own keys. Nothing else reads `process.env` (the logger's `LOG_LEVEL` is the one exception). Every key is documented in `.env.example` and design.md's configuration table.
- **Data contracts:**
  - `session.json` (schema in `@dsr/core/session.ts`) is the recorder → archive contract. Only the recorder writes it, always with `writeJsonFileAtomic` and re-reading it first (`SessionRecord`); the one exception is the archive's admin delete (`apps/archive/src/recordings.ts`), which removes a set's entry the same way.
  - Uploaded sets go the other way: the archive writes the audio and an import request (`importRequestSchema`) into the session's `uploads/` (`apps/archive/src/uploads.ts`), and the recorder adds the set. `state.json` (`recorderStateSchema`) is the recorder's own.
  - `archive.db` belongs to the archive. Sync writes only `recorded_*` and structural columns; edits write only edit columns.
  - Schema changes: additive optional fields in `session.json`, or `SCHEMA_VERSION` handling; a new migration in SQLite. Never edit a shipped migration.
- **Archive layering:** routes → `Catalog` → SQL. Routes never run SQL or open files directly. Media is served only through paths the catalog returns, after the path-containment check.
- **ffmpeg:** argument lists, filter strings and output parsing live in `@dsr/media`. The recorder decides _when_ to run them.
- **Storage:** app state in `/config` (`APP_DATA_DIR`), media in `/recordings` (`RECORDINGS_HOST_DIR`). Don't add other host paths.

## TypeScript

- **ESM only.** Relative imports include the `.ts` or `.tsx` extension. Workspace packages export `./src/index.ts`; there's no build step, and `tsx` runs everything.
- **`erasableSyntaxOnly`:** no `enum` (use `as const` objects or string unions), no `namespace`, no constructor parameter properties (declare fields explicitly).
- **`verbatimModuleSyntax`:** `import type` / inline `type` for types. ESLint enforces it.
- **Strict everything:** `strict`, `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature` (use `env['KEY']`). No `any`. Narrow `unknown` with zod or type guards. `as` casts are acceptable only on SQLite row results and parsed JSON whose shape the schema guarantees.
- **Validate at the edges:** env, `session.json`, form and query input. Inside, trust the types.
- **Errors:** throw `Error` subclasses with a `name` (`ConfigError`, `JsonFileError`, `FfmpegError`, `NotFoundError`). Pass `cause` when wrapping. Never swallow an error without logging it, or a comment saying why it's safe to ignore.
- **Private class state** uses `#private` fields.
- **Async:** no floating promises. Use `void` only for deliberate fire-and-forget, such as signal handlers and timers.
- **Logging:** pino, from `createLogger(name)`, with structured fields first: `logger.info({ setId }, 'message')`. Errors go under `err`. No `console.*` in app code.

## Style

- **Prettier** (100 columns, single quotes, trailing commas) and **ESLint** (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`). Don't hand-format: run `pnpm format`. Use `// prettier-ignore` only for argument lists that read better grouped, such as ffmpeg flags.
- **Naming:** `camelCase` values, `PascalCase` types, classes and components, `SCREAMING_SNAKE_CASE` module constants, kebab-case file names (`json-file.ts`). zod schemas are `fooSchema`, with their type `Foo = z.infer<typeof fooSchema>`. SQL columns and tables are `snake_case`; map them to camelCase at the `Catalog` boundary.
- **Comments:** a short module docblock saying _why_ the module exists, JSDoc on exported things whose purpose isn't obvious, and inline comments only for non-obvious reasons (a quirk, a workaround, a security check). Don't narrate the code.
- **Functions** are small and pure where possible, taking dependencies as arguments (`createApp({ config, catalog })`, `new Catalog(db)`) rather than importing singletons.
- **Views:** server-rendered `hono/jsx`, styled with **daisyUI 5 component classes on Tailwind CSS 4** (dark theme only), built from `views/app.css` by the Tailwind CLI. Interactivity comes from **htmx** (forms, sorting and filtering, inline edits: routes return HTML fragments) and `hx-boost` navigation. Client scripts: the audio player (`apps/archive/src/client/`), in TypeScript with its own DOM tsconfig (the server program stays Node-only), and the admin scripts (`admin.ts`: image picker, tag chips), bundled by esbuild into `dist/` (`build:js`); and the small inline page script in `views/layout.tsx` (background glow timing, dialogs, pending buttons, uploads). No client-side framework.

## Testing

- Vitest, with tests next to the code (`foo.ts` → `foo.test.ts`). `pnpm check` must pass before every commit.
- Test behaviour through public APIs: `Catalog` against `openMemoryDatabase()` plus fixture recordings (`src/test/fixtures.ts`), and the HTTP app with `app.request()`.
- Every bug fix gets a test that fails without the fix.
- Anything needing Discord, a real browser or PulseAudio is tested live on the server, with the result noted in status.md. Browser and ffmpeg calls can be mocked to test the controller's decisions (`capture/controller.test.ts`).

## Security

- **Secrets** live only in `.env` (git-ignored). Never commit them, log them or print them. When inspecting containers, print env var _names_, never values.
- **Ports:** never publish on `0.0.0.0`; compose binds to `127.0.0.1`. On the server, the archive is reached through Traefik and noVNC through an SSH tunnel.
- **Archive:** admin routes 404 for non-admins, form posts are CSRF-checked, cookies are signed and `HttpOnly`, password comparison is constant-time, logins are rate limited per client, and redirects pass through `safeNext`. User-supplied links must be http(s).
- **The recorder account is a self-bot (ToS risk).** Keep automation minimal and never automate login or captchas.

## Git

- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `build:`, `ci:`, with an optional scope (`feat(archive):`, `fix(recorder):`, `chore(deps):`). Use the imperative mood, a subject of 72 characters or less, and a body explaining _why_ when it isn't obvious.
- **One commit per logical change.** A feature together with its tests and docs is one commit; unrelated changes are separate commits.
- **No AI attribution** in commits or PRs (no `Co-Authored-By` trailers, no "Generated with" footers).
- `main` is the only branch, pushed to the private GitHub repo the server pulls from.

## Docs

- Docs describe the current state, briefly and without history: how things work in design.md, external facts with sources in research.md (unverified ones in its table), what works and what's next in status.md, how to run and fix the server in operations.md.
- Each package's README lists its modules. Keep it current when adding or removing a module.
- Docs use placeholders (`example.com`, `<server>`) and no install-specific values such as real domains, IPs or IDs.
