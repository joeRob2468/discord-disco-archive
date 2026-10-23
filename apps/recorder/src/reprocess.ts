/**
 * Re-run post-processing for one session folder: sets left `processing` (the recorder
 * stopped mid-encode) or `failed`, or every set with `--all`, e.g. after changing the
 * loudness targets. The raw captures are never modified.
 *
 * Usage (in the container, which has ffmpeg):
 *   reprocess.ts /recordings/<session folder> [--all]
 */
import path from 'node:path';
import { createLogger } from '@dsr/core';
import { SessionRecord } from './capture/session-record.ts';
import { loadProcessingConfig } from './config.ts';
import { processSet } from './pipeline/process-set.ts';

const logger = createLogger('recorder:reprocess');
const [folder, flag] = process.argv.slice(2);
if (!folder || (flag !== undefined && flag !== '--all')) {
  throw new Error('Usage: reprocess.ts <session folder> [--all]');
}

const config = loadProcessingConfig();
const resolved = path.resolve(folder);
const record = await SessionRecord.open(path.dirname(resolved), path.basename(resolved));
const sets = record.session.sets.filter(
  (set) =>
    set.files.rawAudio !== undefined &&
    set.status !== 'recording' &&
    (flag === '--all' || set.status === 'processing' || set.status === 'failed'),
);

logger.info({ folder: resolved, sets: sets.length }, 'reprocessing');
for (const set of sets) await processSet(record, set.id, config, { logger });
logger.info('done');
