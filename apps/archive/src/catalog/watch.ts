/**
 * Keeps the catalog in step with the recordings volume: a debounced sync on file
 * changes, plus a periodic full sync because file events don't always cross bind mounts
 * (notably Docker on WSL).
 */
import { watch, type FSWatcher } from 'node:fs';
import type { Logger } from '@dsr/core';
import type { Db } from '../db/database.ts';
import { syncCatalog } from './sync.ts';

const DEBOUNCE_MS = 2000;

export interface CatalogWatcher {
  /** Run a sync now (coalesced with any in flight). */
  sync(): Promise<void>;
  close(): void;
}

export function watchCatalog(
  db: Db,
  recordingsDir: string,
  intervalMs: number,
  logger: Logger,
): CatalogWatcher {
  let running: Promise<void> | undefined;
  let queued = false;
  /** Last counts, so a sync that changed something is logged at info, the rest at debug. */
  let last = '';

  const sync = async (): Promise<void> => {
    if (running) {
      queued = true;
      return running;
    }
    running = (async () => {
      try {
        const result = await syncCatalog(db, recordingsDir, logger);
        const counts = {
          sessions: result.sessions,
          sets: result.sets,
          invalid: result.invalid.length,
        };
        const key = JSON.stringify(counts);
        if (key === last) logger.debug(counts, 'catalog synced');
        else logger.info(counts, 'catalog synced: recordings changed');
        last = key;
      } catch (error) {
        logger.error({ err: error }, 'catalog sync failed');
      } finally {
        running = undefined;
        if (queued) {
          queued = false;
          void sync();
        }
      }
    })();
    return running;
  };

  let debounce: NodeJS.Timeout | undefined;
  const onChange = (_event: string, filename: string | null): void => {
    if (filename && !filename.endsWith('session.json')) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => void sync(), DEBOUNCE_MS);
  };

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(recordingsDir, { recursive: true }, onChange);
    watcher.on('error', (error) => {
      logger.warn({ err: error }, 'file watching stopped; relying on periodic sync');
    });
  } catch (error) {
    logger.warn({ err: error }, 'file watching unavailable; relying on periodic sync');
  }

  const interval = setInterval(() => void sync(), intervalMs);
  interval.unref();

  return {
    sync,
    close: () => {
      watcher?.close();
      clearInterval(interval);
      clearTimeout(debounce);
    },
  };
}
