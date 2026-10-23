import { spawn, type ChildProcess } from 'node:child_process';

/** How much of stderr to keep for error messages and filter output parsing. */
const STDERR_TAIL_BYTES = 64 * 1024;

const BASE_ARGS = ['-hide_banner', '-nostdin', '-y'];

export class FfmpegError extends Error {
  readonly exitCode: number | null;
  readonly stderrTail: string;

  constructor(exitCode: number | null, stderrTail: string, options?: ErrorOptions) {
    const lastLine = stderrTail.trim().split('\n').at(-1) ?? '';
    super(`ffmpeg exited with ${exitCode ?? 'signal'}: ${lastLine}`, options);
    this.name = 'FfmpegError';
    this.exitCode = exitCode;
    this.stderrTail = stderrTail;
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  /** ffmpeg binary; defaults to `ffmpeg` on PATH. */
  binary?: string;
}

function collectTail(child: ChildProcess): () => string {
  let tail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    tail = (tail + chunk).slice(-STDERR_TAIL_BYTES);
  });
  return () => tail;
}

/**
 * Run ffmpeg to completion. Resolves with the stderr tail (filters such as loudnorm
 * print their results there); rejects with `FfmpegError` on a non-zero exit.
 */
export function runFfmpeg(args: readonly string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary ?? 'ffmpeg', [...BASE_ARGS, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const tail = collectTail(child);

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(tail());
      else reject(new FfmpegError(code, tail()));
    });
  });
}

/** A long-running ffmpeg process, such as a live capture. */
export interface FfmpegProcess {
  readonly pid: number | undefined;
  /** Resolves when ffmpeg exits cleanly; rejects with `FfmpegError` otherwise. */
  readonly done: Promise<void>;
  /**
   * Ask ffmpeg to finish (sends `q` on stdin) so the output file is finalised, then
   * escalate to SIGTERM and SIGKILL if it hasn't exited after `timeoutMs`.
   */
  stop(timeoutMs?: number): Promise<void>;
}

export interface SpawnOptions extends RunOptions {
  /** Called with each stderr line as it arrives, e.g. for live filter output. */
  onLine?: (line: string) => void;
}

/** Split a stream of chunks into lines; ffmpeg ends progress lines with `\r`. */
function onLines(child: ChildProcess, onLine: (line: string) => void): void {
  let partial = '';
  child.stderr?.on('data', (chunk: string) => {
    const lines = (partial + chunk).split(/\r\n|\r|\n/);
    partial = lines.pop() ?? '';
    for (const line of lines) if (line !== '') onLine(line);
  });
}

export function spawnFfmpeg(args: readonly string[], options: SpawnOptions = {}): FfmpegProcess {
  // stdin stays open (no -nostdin) so `stop()` can send `q`.
  const child = spawn(options.binary ?? 'ffmpeg', ['-hide_banner', '-y', ...args], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  const tail = collectTail(child);
  if (options.onLine) onLines(child, options.onLine);
  let stopping = false;

  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      // ffmpeg exits 255 when it stops on a signal; after stop() that is still a clean finish.
      if (code === 0 || (stopping && code === 255)) resolve();
      else reject(new FfmpegError(code, tail()));
    });
  });

  const stop = async (timeoutMs = 10_000): Promise<void> => {
    if (child.exitCode !== null) return done;
    stopping = true;
    child.stdin.end('q');

    const escalate = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), timeoutMs).unref();
    }, timeoutMs);
    escalate.unref();

    try {
      await done;
    } finally {
      clearTimeout(escalate);
    }
  };

  return { pid: child.pid, done, stop };
}
