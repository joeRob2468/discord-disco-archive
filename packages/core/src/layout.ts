/**
 * Directory layout of the recordings volume. See docs/plan.md, "Output layout".
 */
import path from 'node:path';

export const STATE_FILE = 'state.json';
export const SESSION_FILE = 'session.json';
export const SETLIST_FILE = 'setlist.csv';
export const RAW_DIR = 'raw';
export const LEVELED_DIR = 'leveled';

export interface SessionPaths {
  dir: string;
  sessionFile: string;
  setlistFile: string;
  rawDir: string;
  leveledDir: string;
}

export function statePath(recordingsDir: string): string {
  return path.join(recordingsDir, STATE_FILE);
}

export function sessionPaths(recordingsDir: string, sessionDir: string): SessionPaths {
  const dir = path.join(recordingsDir, sessionDir);
  return {
    dir,
    sessionFile: path.join(dir, SESSION_FILE),
    setlistFile: path.join(dir, SETLIST_FILE),
    rawDir: path.join(dir, RAW_DIR),
    leveledDir: path.join(dir, LEVELED_DIR),
  };
}
