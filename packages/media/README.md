# @dsr/media

ffmpeg wrappers. This package knows _how_ to measure, level and encode. Callers decide _when_. It needs `ffmpeg` on `PATH` (the recorder image installs it).

| Module        | Contents                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ffmpeg.ts`   | `runFfmpeg(args)` runs to completion and resolves with the stderr tail. `spawnFfmpeg(args)` is for long-running captures; its `stop()` sends `q` so files are finalised, then escalates. |
| `loudnorm.ts` | Two-pass EBU R128: `measureLoudness` (pass 1), `parseMeasurement`, and `normalizeFilter` (pass 2 with `linear=true`).                                                                    |
| `encode.ts`   | `encodeMaster` (leveled 24-bit FLAC), `encodeMp3`, `encodeM4a` and `muxMp4` (captured H.264 + leveled AAC, faststart).                                                                   |

Background on the leveling approach: [docs/plan.md, "Leveling"](../../docs/plan.md#leveling).
