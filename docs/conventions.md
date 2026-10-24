# Conventions

These are the rules for working in this repo, for people and coding agents alike. [development.md](development.md) covers setup and scripts; this file covers _how code should look and be organised_.

## Architecture rules

- **Apps own I/O; packages own logic.** `packages/*` export functions, classes and schemas and do nothing at import time. Each app has one composition root (`src/main.ts`, or `src/smoke.ts` for the recorder until milestone 4) that loads config, creates loggers and wires modules.
- **Dependencies point one way:** `apps/*` → `packages/*`. Packages never import apps. `@dsr/media` doesn't depend on `@dsr/core`.
- **Config:** each app has exactly one `src/config.ts`, a zod schema read through `@dsr/core`'s `parseEnv`, split into sections so a module only needs its own keys. Nothing else reads `process.env` (the logger's `LOG_LEVEL` is the one exception). Every key is documented in `.env.example` and in docs/plan.md's configuration table.
- **Data contracts:**
  - `session.json` and `state.json` (schemas in `@dsr/core/session.ts`) are the recorder → archive contract. Only the recorder writes them, always with `writeJsonFileAtomic`. The one exception: the archive's admin delete (`apps/archive/src/recordings.ts`) removes a set's entry, also atomically, and only for sessions that have ended unless forced.
  - `archive.db` belongs to the archive. Sync writes only `recorded_*` and structural columns; edits write only edit columns.
  - Any schema change needs `SCHEMA_VERSION` handling (JSON) or a new migration (SQLite). Never edit a shipped migration.
- **Archive layering:** routes → `Catalog` → SQL. Routes never run SQL or open files directly. Media is served only through paths the catalog returns, after the path-containment check.
- **ffmpeg:** argument lists, filter strings and output parsing live in `@dsr/media`. The recorder decides _when_ to run them.
- **Storage:** app state in `/config` (`APP_DATA_DIR`), media in `/recordings` (`RECORDINGS_HOST_DIR`). See plan.md's "Storage layout". Don't add other host paths.

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
- **Views:** server-rendered `hono/jsx`, styled with **daisyUI 5 component classes on Tailwind CSS 4** (dark theme by default), built from `views/app.css` by the Tailwind CLI. Interactivity comes from **htmx** (forms, sorting and filtering, inline edits: routes return HTML fragments) and `hx-boost` navigation. The only hand-written client script is the audio player (`apps/archive/src/client/`), in TypeScript with its own DOM tsconfig (the server program stays Node-only), bundled by esbuild into `dist/player.js` (`build:js`). No client-side framework.

## Testing

- Vitest, with tests next to the code (`foo.ts` → `foo.test.ts`). `pnpm check` must pass before every commit.
- Test behaviour through public APIs: `Catalog` against `openMemoryDatabase()` plus fixture recordings (`src/test/fixtures.ts`), and the HTTP app with `app.request()`.
- Every bug fix gets a test that fails without the fix.
- Anything needing Discord, a real browser or PulseAudio is verified manually against the milestones in plan.md, and the result is noted there or in research.md.

## Security

- **Secrets** live only in `.env` (git-ignored). Never commit them, log them or print them. When inspecting containers, print env var _names_, never values.
- **Ports:** never publish on `0.0.0.0`; compose binds to `127.0.0.1`. On the server, the archive is reached through Traefik and noVNC through an SSH tunnel.
- **Archive:** admin routes 404 for non-admins, form posts are CSRF-checked, cookies are signed and `HttpOnly`, password comparison is constant-time, and redirects pass through `safeNext`. User-supplied links must be http(s).
- **The recorder account is a self-bot (ToS risk).** Keep automation minimal and never automate login or captchas.

## Git

- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `build:`, `ci:`, with an optional scope (`feat(archive):`, `fix(recorder):`, `chore(deps):`). Use the imperative mood, a subject of 72 characters or less, and a body explaining _why_ when it isn't obvious.
- **One commit per logical change.** A feature together with its tests and docs is one commit; unrelated changes are separate commits.
- **No AI attribution** in commits or PRs (no `Co-Authored-By` trailers, no "Generated with" footers).
- `main` is the only branch for now; branch per feature once there's a remote.

## Docs

- Every design decision goes in `docs/plan.md`, and every external fact with its source and the date checked in `docs/research.md`. Unverified assumptions go in research.md's "Unverified / to test" table.
- Each package's README lists its modules. Keep it current when adding or removing a module.
- Docs use placeholders (`example.com`, `<server>`) and no install-specific values such as real domains, IPs or IDs.
