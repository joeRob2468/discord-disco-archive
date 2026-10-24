import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../db/database.ts';
import {
  createRecordings,
  DJ_A,
  DJ_B,
  makeSession,
  makeSet,
  standardFixture,
  type RecordingsFixture,
} from '../test/fixtures.ts';
import { Catalog, NotFoundError, normalizeLinks, normalizeTags } from './catalog.ts';
import { setUuid } from './ids.ts';
import { syncCatalog } from './sync.ts';

describe('catalog', () => {
  let recordings: RecordingsFixture;
  let db: Db;
  let catalog: Catalog;

  beforeEach(async () => {
    recordings = await createRecordings();
    await standardFixture(recordings);
    db = openMemoryDatabase();
    catalog = new Catalog(db);
    await syncCatalog(db, recordings.dir);
  });

  afterEach(async () => {
    db.close();
    await recordings.cleanup();
  });

  describe('set UUIDs and plays', () => {
    it('gives every set a stable UUID it can be found by', () => {
      const set = catalog.getSet('set-1', false);
      expect(set?.uuid).toBe(setUuid('session-1', 'set-1'));
      expect(catalog.getSetByUuid(set?.uuid ?? '', false)?.id).toBe('set-1');
    });

    it('counts plays and ranks popular sets by them', () => {
      const uuid = (id: string) => catalog.getSet(id, false)?.uuid ?? '';
      expect(catalog.recordPlay(uuid('set-1'))).toBe(true);
      expect(catalog.recordPlay(uuid('set-3'))).toBe(true);
      expect(catalog.recordPlay(uuid('set-3'))).toBe(true);
      expect(catalog.recordPlay('00000000-0000-5000-8000-000000000000')).toBe(false);
      expect(catalog.getSet('set-3', false)?.plays).toBe(2);
      expect(catalog.popularSets(2, 30, false).map((set) => set.id)).toEqual(['set-3', 'set-1']);
    });

    it('filters the set list by session', () => {
      const page = catalog.search({ sessionId: 'session-1' }, false);
      expect(page.items.map((set) => set.id).sort()).toEqual(['set-1', 'set-2']);
    });
  });

  describe('sync', () => {
    it('imports sessions newest first, with titles falling back to the channel name', () => {
      const page = catalog.listSessions(1, false);
      expect(page.total).toBe(2);
      expect(page.items.map((s) => [s.id, s.title, s.visibleSets])).toEqual([
        ['session-2', 'disco-room', 1],
        ['session-1', 'Halloween Disco', 2],
      ]);
    });

    it("keeps each streamer's most recent display name", () => {
      expect(catalog.getStreamer(DJ_A, false)?.name).toBe('Night Owl II');
      expect(catalog.getStreamer(DJ_A, false)?.setCount).toBe(2);
    });

    it('computes set duration and order within a session', () => {
      const sets = catalog.listSessionSets('session-1', false);
      expect(sets.map((s) => [s.id, s.position, s.durationSeconds])).toEqual([
        ['set-1', 0, 3600],
        ['set-2', 1, 5430],
      ]);
    });

    it('flags folders that disappear as missing and keeps their edits', async () => {
      catalog.updateSession('session-2', { title: 'Renamed' }, 'test');
      await recordings.remove('2026-11-21_disco-room');
      await syncCatalog(db, recordings.dir);

      expect(catalog.getSession('session-2', false)).toBeUndefined();
      expect(catalog.getSession('session-2', true)).toMatchObject({
        missing: true,
        title: 'Renamed',
      });
      expect(catalog.getSet('set-3', false)).toBeUndefined();
    });

    it('preserves archive edits when the recorder rewrites session.json', async () => {
      catalog.updateSet('set-1', { title: 'Spooky Mix' }, 'test');
      await recordings.write(
        '2026-11-14_halloween-disco',
        makeSession({
          id: 'session-1',
          title: 'Halloween Disco (fixed)',
          sets: [makeSet({ id: 'set-1', userId: DJ_A, displayName: 'Night Owl' })],
        }),
      );
      await syncCatalog(db, recordings.dir);

      expect(catalog.getSet('set-1', false)?.title).toBe('Spooky Mix');
      expect(catalog.getSession('session-1', false)?.title).toBe('Halloween Disco (fixed)');
      // set-2 is no longer in the file.
      expect(catalog.getSet('set-2', false)).toBeUndefined();
    });

    it('skips invalid session files and reports them', async () => {
      await recordings.write('broken', { nope: true } as never);
      const result = await syncCatalog(db, recordings.dir);
      expect(result.invalid.map((i) => i.dir)).toEqual(['broken']);
      expect(result.sessions).toBe(2);
    });
  });

  describe('edits', () => {
    it('resolves names: set edit, then streamer edit, then recorded', () => {
      catalog.updateStreamer(DJ_A, { displayName: 'Owl' }, 'test');
      expect(catalog.getSet('set-1', false)?.name).toBe('Owl');

      catalog.updateSet('set-1', { displayName: 'Owl b2b Friend' }, 'test');
      expect(catalog.getSet('set-1', false)?.name).toBe('Owl b2b Friend');
      expect(catalog.getSet('set-3', false)?.name).toBe('Owl');

      catalog.updateSet('set-1', { displayName: '  ' }, 'test');
      expect(catalog.getSet('set-1', false)?.name).toBe('Owl');
    });

    it('hides sets from everyone but admins, and can revert to the recorded value', () => {
      catalog.updateSet('set-2', { hidden: true }, 'test');
      expect(catalog.getSet('set-2', false)).toBeUndefined();
      expect(catalog.getSet('set-2', true)).toMatchObject({ hidden: true, hiddenOverride: true });
      expect(catalog.getSession('session-1', false)?.visibleSets).toBe(1);
      expect(catalog.getStreamer(DJ_B, false)).toBeUndefined();

      catalog.updateSet('set-2', { hidden: null }, 'test');
      expect(catalog.getSet('set-2', false)?.hiddenOverride).toBeUndefined();
    });

    it('hides every set of a hidden session', () => {
      catalog.updateSession('session-1', { hidden: true }, 'test');
      expect(catalog.listSessions(1, false).total).toBe(1);
      expect(catalog.getSet('set-1', false)).toBeUndefined();
      expect(catalog.search({}, false).total).toBe(1);
    });

    it('records changed fields in the audit log', () => {
      catalog.updateSet(
        'set-1',
        { title: 'Spooky Mix', tags: ['House', 'house', 'Disco!'] },
        'admin',
      );
      catalog.updateSet('set-1', { title: 'Spooky Mix' }, 'admin'); // no-op, not logged

      const [entry, ...rest] = catalog.recentAudit(10);
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({
        actor: 'admin',
        entity: 'set',
        entityId: 'set-1',
        changes: {
          title: { from: null, to: 'Spooky Mix' },
          tags: { from: [], to: ['disco', 'house'] },
        },
      });
    });

    it('throws NotFoundError for unknown IDs', () => {
      expect(() => {
        catalog.updateSet('nope', { title: 'x' }, 'test');
      }).toThrow(NotFoundError);
    });
  });

  describe('search', () => {
    it('matches names as accent-insensitive prefixes', () => {
      expect(catalog.search({ q: 'cafe sun' }, false).items.map((s) => s.id)).toEqual(['set-2']);
    });

    it('matches session titles, edited titles, notes and tags', () => {
      catalog.updateSet('set-3', { description: 'Tracklist: Daft Punk - One More Time' }, 'test');
      catalog.updateSet('set-1', { tags: ['italo disco'] }, 'test');

      expect(catalog.search({ q: 'halloween' }, false).total).toBe(2);
      expect(catalog.search({ q: 'daft punk' }, false).items.map((s) => s.id)).toEqual(['set-3']);
      expect(catalog.search({ q: 'italo' }, false).items.map((s) => s.id)).toEqual(['set-1']);
    });

    it('reindexes sets when their session or streamer is renamed', () => {
      catalog.updateSession('session-2', { title: 'Winter Warmup' }, 'test');
      catalog.updateStreamer(DJ_B, { displayName: 'Sunrise Collective' }, 'test');
      expect(catalog.search({ q: 'winter' }, false).items.map((s) => s.id)).toEqual(['set-3']);
      expect(catalog.search({ q: 'collective' }, false).items.map((s) => s.id)).toEqual(['set-2']);
    });

    it('filters by streamer, tag and date range', () => {
      catalog.updateSet('set-3', { tags: ['house'] }, 'test');
      expect(catalog.search({ userId: DJ_A }, false).items.map((s) => s.id)).toEqual([
        'set-3',
        'set-1',
      ]);
      expect(catalog.search({ tag: 'house' }, false).items.map((s) => s.id)).toEqual(['set-3']);
      expect(catalog.search({ from: '2026-11-20' }, false).items.map((s) => s.id)).toEqual([
        'set-3',
      ]);
      expect(catalog.search({ to: '2026-11-14' }, false).total).toBe(2);
    });

    it('ignores punctuation-only queries instead of failing', () => {
      expect(catalog.search({ q: '"*()' }, false).total).toBe(3);
    });
  });
});

describe('normalisation', () => {
  it('cleans tags', () => {
    expect(normalizeTags([' Deep  House ', 'deep house', '#techno', ''])).toEqual([
      'deep house',
      'techno',
    ]);
  });

  it('keeps only http(s) links', () => {
    expect(normalizeLinks(['https://soundcloud.com/x', 'javascript:alert(1)', 'nope'])).toEqual([
      'https://soundcloud.com/x',
    ]);
  });
});
