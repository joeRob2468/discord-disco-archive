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

  describe('stats', () => {
    const uuid = (id: string) => catalog.getSet(id, false)?.uuid ?? '';

    it('totals each DJ and sorts by any column', () => {
      catalog.recordPlay(uuid('set-2'));
      const [owl, cafe] = catalog.listStreamers(false);
      expect(owl).toMatchObject({
        userId: DJ_A,
        setCount: 2,
        totalSeconds: 7200,
        firstPlayedAt: '2026-11-14T21:00:00.000Z',
        lastPlayedAt: '2026-11-21T21:00:00.000Z',
        plays: 0,
      });
      expect(cafe).toMatchObject({ userId: DJ_B, totalSeconds: 5430, plays: 1 });
      const byPlays = catalog.listStreamers(false, { by: 'plays', dir: 'desc' });
      expect(byPlays.map((s) => s.userId)).toEqual([DJ_B, DJ_A]);
    });

    it('totals sessions over the sets the viewer can see', () => {
      catalog.updateSet('set-2', { hidden: true }, 'test');
      const visible = catalog.listSessionStats(false);
      expect(visible.map((s) => [s.session.id, s.sets, s.djs, s.seconds])).toEqual([
        ['session-2', 1, 1, 3600],
        ['session-1', 1, 1, 3600],
      ]);
      const all = catalog.listSessionStats(true, { by: 'length', dir: 'desc' });
      expect(all.map((s) => [s.session.id, s.sets, s.seconds])).toEqual([
        ['session-1', 2, 9030],
        ['session-2', 1, 3600],
      ]);
    });

    it('records file sizes and failure reasons for the admin overview', async () => {
      await recordings.write(
        'failed',
        makeSession({
          id: 'session-3',
          sets: [
            makeSet({
              id: 'set-4',
              userId: DJ_B,
              status: 'failed',
              error: 'ffmpeg exited 1',
              // The master was never written.
              files: { rawAudio: 'raw/set-4.wav' },
            }),
          ],
        }),
        true,
      );
      await syncCatalog(db, recordings.dir);
      catalog.updateSet('set-1', { hidden: true }, 'test');

      // Fixture files contain `media:<path>`.
      const bytes = (file: string) => `media:${file}`.length;
      expect(catalog.getSet('set-4', true)?.fileSizes).toEqual({
        rawAudio: bytes('raw/set-4.wav'),
      });
      const overview = catalog.overview();
      expect(overview).toMatchObject({ sessions: 3, sets: 4, hiddenSets: 1, djs: 2 });
      expect(overview.storage.rawAudio).toBe(bytes('raw/set-4.wav'));
      expect(overview.storage.mp3).toBe(
        ['set-1', 'set-2', 'set-3'].reduce((n, id) => n + bytes(`leveled/${id}.mp3`), 0),
      );
      expect(catalog.unfinishedSets().map((set) => [set.id, set.error])).toEqual([
        ['set-4', 'ffmpeg exited 1'],
      ]);
    });

    it('filters sets by status and visibility, and sorts them', () => {
      catalog.updateSet('set-3', { hidden: true }, 'test');
      const ids = (page: { items: { id: string }[] }) => page.items.map((set) => set.id);
      expect(ids(catalog.search({ hidden: true }, true))).toEqual(['set-3']);
      expect(ids(catalog.search({ status: 'failed' }, true))).toEqual([]);
      expect(ids(catalog.search({ sort: { by: 'length', dir: 'desc' } }, true))).toEqual([
        'set-2',
        'set-3',
        'set-1',
      ]);
      expect(ids(catalog.search({ sort: { by: 'dj', dir: 'asc' } }, true))[0]).toBe('set-2');
    });
  });

  describe('album order', () => {
    const order = () => catalog.listSessionSets('session-1', true).map((set) => set.id);

    it('moves sets within their album, survives a sync, and resets', async () => {
      expect(order()).toEqual(['set-1', 'set-2']);
      catalog.moveSet('session-1', 'set-2', -1, 'test');
      expect(order()).toEqual(['set-2', 'set-1']);
      expect(catalog.getSet('set-2', true)).toMatchObject({ position: 0, reordered: true });
      // Moving past either end does nothing.
      catalog.moveSet('session-1', 'set-2', -1, 'test');
      expect(order()).toEqual(['set-2', 'set-1']);

      await syncCatalog(db, recordings.dir);
      expect(order()).toEqual(['set-2', 'set-1']);
      expect(catalog.recentAudit(1)[0]?.changes['order']).toEqual({
        from: ['set-1', 'set-2'],
        to: ['set-2', 'set-1'],
      });

      catalog.resetSetOrder('session-1', 'test');
      expect(order()).toEqual(['set-1', 'set-2']);
      expect(() => {
        catalog.moveSet('session-1', 'set-3', 1, 'test');
      }).toThrow(NotFoundError);
    });
  });

  describe('sync', () => {
    it("logs the recorder's changes in the activity feed", async () => {
      const recorderEntries = () =>
        catalog
          .recentAudit(50)
          .filter((e) => e.actor === 'recorder')
          .map((e) => [e.entity, e.entityId, e.changes]);
      // The fixture's first sync: every session and set is new.
      expect(recorderEntries()).toContainEqual([
        'set',
        'set-2',
        { recorded: { from: null, to: 'Café Sunrise, ready' } },
      ]);
      const before = catalog.recentAudit(50).length;

      // Unchanged: nothing new.
      await syncCatalog(db, recordings.dir);
      expect(catalog.recentAudit(50)).toHaveLength(before);

      // Retitled, cleaned up (raw gone) and a set failing, as the recorder would write it.
      await recordings.write(
        '2026-11-21_disco-room',
        makeSession({
          id: 'session-2',
          title: 'Disco Room Finale',
          startedAt: '2026-11-21T20:00:00.000Z',
          sets: [
            makeSet({
              id: 'set-3',
              userId: DJ_A,
              displayName: 'Night Owl II',
              status: 'failed',
              error: 'ffmpeg exited 1',
              files: { rawAudio: 'raw/set-3.wav' },
            }),
          ],
        }),
      );
      await recordings.remove('2026-11-14_halloween-disco');
      await syncCatalog(db, recordings.dir);
      const latest = recorderEntries().slice(0, 5);
      expect(latest).toContainEqual([
        'session',
        'session-2',
        { title: { from: null, to: 'Disco Room Finale' } },
      ]);
      expect(latest).toContainEqual([
        'set',
        'set-3',
        {
          status: { from: 'ready', to: 'failed' },
          error: { from: null, to: 'ffmpeg exited 1' },
          files: { from: ['m4a', 'master', 'mp3'], to: ['rawAudio'] },
        },
      ]);
      expect(latest).toContainEqual([
        'session',
        'session-1',
        { missing: { from: false, to: true } },
      ]);
      expect(latest).toContainEqual(['set', 'set-1', { missing: { from: false, to: true } }]);
    });

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

    it("shows a set's given name ahead of the DJ's, without renaming the DJ", async () => {
      // A later set on DJ A's stream, split off or uploaded under another DJ's name.
      await recordings.write(
        '2026-11-28_disco',
        makeSession({
          id: 'session-3',
          startedAt: '2026-11-28T20:00:00.000Z',
          sets: [
            makeSet({
              id: 'set-4',
              userId: DJ_A,
              displayName: 'Afterglow',
              nameGiven: true,
              startedAt: '2026-11-28T21:00:00.000Z',
              endedAt: '2026-11-28T22:00:00.000Z',
            }),
          ],
        }),
      );
      await syncCatalog(db, recordings.dir);
      catalog.updateStreamer(DJ_A, { displayName: 'Owl' }, 'test');
      expect(catalog.getSet('set-4', false)?.name).toBe('Afterglow');
      expect(catalog.getSet('set-1', false)?.name).toBe('Owl');
      // Though it's DJ A's latest set, their own recorded name stays.
      expect(catalog.getStreamer(DJ_A, false)?.recordedName).toBe('Night Owl II');
      catalog.updateSet('set-4', { displayName: 'Afterglow b2b Owl' }, 'test');
      expect(catalog.getSet('set-4', false)?.name).toBe('Afterglow b2b Owl');
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

      // The sync's own "recorded" entries come first; only one admin entry follows.
      const [entry, ...rest] = catalog.recentAudit(10).filter((e) => e.actor === 'admin');
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
