/**
 * Runs post-processing jobs one at a time in the background, so encodes never compete
 * with each other or hold up recording. `shutdown()` aborts the running job and skips
 * the rest; their sets stay `processing` and can be re-run with `reprocess.ts`.
 */
import type { Logger } from '@dsr/core';

export type Job = (signal: AbortSignal) => Promise<void>;

export class Processor {
  readonly #logger: Logger;
  readonly #abort = new AbortController();
  #queue: Promise<void> = Promise.resolve();

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  /** Resolves when the job has run (or been skipped); never rejects. */
  enqueue(name: string, job: Job): Promise<void> {
    const signal = this.#abort.signal;
    const run = async (): Promise<void> => {
      if (signal.aborted) {
        this.#logger.info({ job: name }, 'skipped: shutting down');
        return;
      }
      try {
        await job(signal);
      } catch (error) {
        this.#logger.error({ err: error, job: name }, 'job failed');
      }
    };
    this.#queue = this.#queue.then(run);
    return this.#queue;
  }

  idle(): Promise<void> {
    return this.#queue;
  }

  shutdown(): void {
    this.#abort.abort();
  }
}
