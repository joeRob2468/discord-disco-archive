import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from './migrations.ts';

export type Db = Database.Database;

export const DATABASE_FILE = 'archive.db';

/** Open (creating if needed) the archive database and bring its schema up to date. */
export function openDatabase(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  return initialise(new Database(path.join(dataDir, DATABASE_FILE)));
}

/** In-memory database for tests. */
export function openMemoryDatabase(): Db {
  return initialise(new Database(':memory:'));
}

function initialise(db: Db): Db {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > migrations.length) {
    throw new Error(
      `Database schema v${current} is newer than this build (v${migrations.length}); refusing to start`,
    );
  }

  db.transaction(() => {
    for (const [index, sql] of migrations.entries()) {
      if (index < current) continue;
      db.exec(sql);
      db.pragma(`user_version = ${index + 1}`);
    }
  })();
}

/** Current time as an ISO timestamp, for `*_at` columns. */
export const now = (): string => new Date().toISOString();
