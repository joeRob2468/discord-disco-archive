# @dsr/core

Shared domain model and utilities for the recorder and the archive. It has no side effects at import.

| Module         | Contents                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `session.ts`   | zod schemas and types for `session.json` (one per session folder) and `state.json` (active session). The contract between the apps. |
| `layout.ts`    | Recordings volume layout: file and folder names, and `sessionPaths()`.                                                              |
| `naming.ts`    | `slugify`, local-time date and timestamp formatting, and session folder and set file names.                                         |
| `json-file.ts` | `readJsonFile(path, schema)` (validated) and `writeJsonFileAtomic` (temp file + fsync + rename).                                    |
| `env.ts`       | `parseEnv` and env value helpers (`withDefault`, `optional`, `envBoolean`, `envInteger`, `envList`, …).                             |
| `logger.ts`    | `createLogger(name)`: pino JSON to stdout, level from `LOG_LEVEL`.                                                                  |

Dates in names use the process time zone, so set `TZ`.
