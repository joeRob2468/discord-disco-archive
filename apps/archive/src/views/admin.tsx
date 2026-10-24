/**
 * The admin panel: an overview (totals, storage use, sets that need attention), every
 * set as a filterable table with quick archive buttons, and the edit activity log.
 */
import type { SetStatus } from '@dsr/core';
import type { Child } from 'hono/jsx';
import type { AuthState } from '../auth/auth.ts';
import type { AuditEntry, Overview, Page, SetSort, SetSummary, Sort } from '../catalog/catalog.ts';
import { setArt } from './art.ts';
import { Art, StatusBadges } from './cards.tsx';
import { EditButton, EditSetDialog } from './edit.tsx';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatHours,
  plural,
} from './format.ts';
import { Icon, Layout } from './layout.tsx';
import { searchUrl, sessionUrl, setUrl } from './links.ts';
import { naturalDir, SortHeader, TablePanel, withQuery } from './tables.tsx';

const TABS = [
  ['/admin', 'Overview'],
  ['/admin/sets', 'Sets'],
  ['/admin/activity', 'Activity'],
] as const;

function AdminLayout(props: {
  auth: AuthState;
  title: string;
  tab: (typeof TABS)[number][0];
  children?: Child;
}) {
  return (
    <Layout title={`${props.title} · Admin`} auth={props.auth}>
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold">Admin</h1>
        <div role="tablist" class="tabs tabs-box">
          {TABS.map(([href, label]) => (
            <a
              role="tab"
              class={`tab plain ${href === props.tab ? 'tab-active' : ''}`}
              href={href}
              aria-selected={href === props.tab ? 'true' : 'false'}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
      {props.children}
    </Layout>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div class="panel rounded-2xl p-4">
      <p class="text-base-content/60 text-xs font-semibold tracking-widest uppercase">{label}</p>
      <p class="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {detail && <p class="text-base-content/60 mt-1 text-xs">{detail}</p>}
    </div>
  );
}

const sum = (...values: (number | undefined)[]): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

export function OverviewPage(props: {
  auth: AuthState;
  overview: Overview;
  unfinished: SetSummary[];
}) {
  const { auth, overview, unfinished } = props;
  const { storage } = overview;
  const raw = sum(storage.rawAudio, storage.rawVideo);
  const masters = sum(storage.master);
  const exports = sum(storage.mp3, storage.m4a, storage.mp4);
  return (
    <AdminLayout auth={auth} title="Overview" tab="/admin">
      <section class="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Sessions" value={String(overview.sessions)} />
        <Stat
          label="Sets"
          value={String(overview.sets)}
          detail={overview.hiddenSets > 0 ? `${String(overview.hiddenSets)} archived` : undefined}
        />
        <Stat label="DJs" value={String(overview.djs)} />
        <Stat label="Recorded" value={formatHours(overview.seconds)} />
        <Stat label="Plays" value={String(overview.plays)} />
      </section>

      <h2 class="mt-8 mb-3 text-xl font-bold">Storage</h2>
      <section class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Raw captures" value={formatBytes(raw)} detail="WAV (and MKV)" />
        <Stat label="Masters" value={formatBytes(masters)} detail="FLAC" />
        <Stat label="Exports" value={formatBytes(exports)} detail="MP3, M4A, MP4" />
        <Stat label="Total" value={formatBytes(raw + masters + exports)} />
      </section>
      <p class="text-base-content/60 mt-2 text-xs">
        Sizes as of the last catalog sync; uploaded images aren't counted.
      </p>

      <h2 class="mt-8 mb-3 text-xl font-bold">Needs attention</h2>
      {unfinished.length === 0 ? (
        <p class="text-base-content/60">Every set is processed and ready.</p>
      ) : (
        <TablePanel>
          <thead>
            <tr>
              <th>Set</th>
              <th>Session</th>
              <th>Started</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {unfinished.map((set) => (
              <tr>
                <td>
                  <a class="font-semibold" href={setUrl(set)}>
                    {set.title ?? set.name}
                  </a>
                </td>
                <td>
                  <a href={sessionUrl(set.sessionId)}>{set.sessionTitle}</a>
                </td>
                <td class="whitespace-nowrap">{formatDateTime(set.startedAt)}</td>
                <td>
                  <span
                    class={`badge badge-sm ${set.status === 'failed' ? 'badge-error' : 'badge-warning'}`}
                  >
                    {set.status}
                  </span>
                  {set.error && <p class="text-error mt-1 max-w-md text-xs">{set.error}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      <p class="text-base-content/60 mt-2 text-xs">
        Failed or interrupted sets are re-run on the recorder with <code>reprocess.ts</code>.
      </p>
    </AdminLayout>
  );
}

export interface AdminSetFilters {
  q?: string | undefined;
  status?: SetStatus | undefined;
  hidden?: boolean | undefined;
  sort: Sort<SetSort>;
  page?: number | undefined;
}

export const setDefaultDir = naturalDir(['dj', 'title', 'session', 'status']);

export function adminSetsUrl(filters: AdminSetFilters): string {
  return withQuery('/admin/sets', {
    q: filters.q,
    status: filters.status,
    visibility: filters.hidden === undefined ? undefined : filters.hidden ? 'archived' : 'visible',
    sort: filters.sort.by,
    dir: filters.sort.dir,
    page: filters.page && filters.page > 1 ? String(filters.page) : undefined,
  });
}

const totalBytes = (set: SetSummary): number => sum(...Object.values(set.fileSizes));

/** Archive or unarchive in one click; "as recorded" is in the edit dialog. */
function ArchiveButton({ set, next }: { set: SetSummary; next: string }) {
  return (
    <form class="inline" method="post" action={`/sets/${encodeURIComponent(set.id)}/edit`}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="hidden" value={set.hidden ? 'visible' : 'hidden'} />
      <button class="btn btn-ghost btn-sm" type="submit">
        {set.hidden ? 'Unarchive' : 'Archive'}
      </button>
    </form>
  );
}

function SetsTable({ list, filters }: { list: Page<SetSummary>; filters: AdminSetFilters }) {
  const current = adminSetsUrl(filters);
  const href = (sort: Sort<SetSort>) => adminSetsUrl({ ...filters, sort, page: 1 });
  const header = (label: string, by: SetSort, className?: string) => (
    <SortHeader
      label={label}
      by={by}
      sort={filters.sort}
      href={href}
      defaultDir={setDefaultDir}
      class={className}
    />
  );
  return (
    <div id="admin-sets">
      <p class="text-base-content/60 mb-3 text-sm">{plural(list.total, 'set')}</p>
      <TablePanel>
        <thead>
          <tr>
            {header('Set', 'title')}
            {header('DJ', 'dj')}
            {header('Session', 'session')}
            {header('Date', 'date')}
            {header('Length', 'length', 'text-right')}
            {header('Status', 'status')}
            {header('Plays', 'plays', 'text-right')}
            {header('Size', 'size', 'text-right')}
            <th />
          </tr>
        </thead>
        <tbody>
          {list.items.map((set) => (
            <tr class="hover:bg-base-100">
              <td>
                <a class="plain flex items-center gap-3" href={setUrl(set)}>
                  <Art seed={set.uuid} image={setArt(set)} class="size-10 shrink-0 rounded-lg" />
                  <span class="font-semibold">{set.title ?? set.name}</span>
                </a>
              </td>
              <td>
                <a href={searchUrl({ userId: set.userId })}>{set.name}</a>
              </td>
              <td>
                <a href={sessionUrl(set.sessionId)}>{set.sessionTitle}</a>
              </td>
              <td class="whitespace-nowrap">{formatDate(set.startedAt)}</td>
              <td class="text-right tabular-nums">{formatDuration(set.durationSeconds)}</td>
              <td class="whitespace-nowrap">
                {set.status === 'ready' ? 'ready' : ''}
                <StatusBadges set={set} />
              </td>
              <td class="text-right tabular-nums">{set.plays}</td>
              <td class="text-right whitespace-nowrap tabular-nums">
                {formatBytes(totalBytes(set))}
              </td>
              <td class="text-right whitespace-nowrap">
                <ArchiveButton set={set} next={current} />
                <EditButton kind="set" id={set.id} />
                <EditSetDialog set={set} next={current} />
              </td>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      {list.total === 0 && <p class="text-base-content/60 py-8 text-center">No sets match.</p>}
      {list.pages > 1 && (
        <div class="join mt-6 flex justify-center">
          {list.page > 1 && (
            <a class="btn join-item" href={adminSetsUrl({ ...filters, page: list.page - 1 })}>
              «
            </a>
          )}
          <span class="btn join-item btn-disabled">
            Page {list.page} of {list.pages}
          </span>
          {list.page < list.pages && (
            <a class="btn join-item" href={adminSetsUrl({ ...filters, page: list.page + 1 })}>
              »
            </a>
          )}
        </div>
      )}
    </div>
  );
}

const STATUSES: SetStatus[] = ['recording', 'processing', 'ready', 'failed'];

export function AdminSetsPage(props: {
  auth: AuthState;
  list: Page<SetSummary>;
  filters: AdminSetFilters;
}) {
  const { auth, list, filters } = props;
  return (
    <AdminLayout auth={auth} title="Sets" tab="/admin/sets">
      <form
        class="mb-4 flex flex-wrap items-center gap-2"
        action="/admin/sets"
        method="get"
        hx-get="/admin/sets"
        hx-target="#admin-sets"
        hx-select="#admin-sets"
        hx-swap="outerHTML"
        hx-push-url="true"
        hx-trigger="input changed delay:300ms from:find input[type=search], change from:find select, submit"
      >
        <input type="hidden" name="sort" value={filters.sort.by} />
        <input type="hidden" name="dir" value={filters.sort.dir} />
        <label class="input panel w-full rounded-xl border-0 sm:w-72">
          <Icon name="search" class="size-4 opacity-60" />
          <input
            class="grow"
            type="search"
            name="q"
            value={filters.q ?? ''}
            placeholder="Filter by DJ, title, session…"
            aria-label="Filter sets"
          />
        </label>
        <select class="select panel w-auto rounded-xl border-0" name="status" aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((status) => (
            <option value={status} selected={filters.status === status}>
              {status}
            </option>
          ))}
        </select>
        <select
          class="select panel w-auto rounded-xl border-0"
          name="visibility"
          aria-label="Visibility"
        >
          <option value="">Visible and archived</option>
          <option value="visible" selected={filters.hidden === false}>
            Visible
          </option>
          <option value="archived" selected={filters.hidden === true}>
            Archived
          </option>
        </select>
      </form>
      <SetsTable list={list} filters={filters} />
    </AdminLayout>
  );
}

/** Where an audit entry's subject lives now. */
function entryLink(entry: AuditEntry): string {
  if (entry.entity === 'session') return sessionUrl(entry.entityId);
  if (entry.entity === 'streamer') return searchUrl({ userId: entry.entityId });
  // Redirects to the set's page under its session.
  return `/sets/${encodeURIComponent(entry.entityId)}`;
}

const ENTITY_LABELS: Record<string, string> = { session: 'Session', set: 'Set', streamer: 'DJ' };

const FIELD_LABELS: Record<string, string> = {
  display_name: 'name',
  hidden: 'archived',
  recorded: 'recorded',
  files: 'files',
};

/** A changed value, readably: lists joined, empty as a dash, archive state in words. */
function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'hidden') return value === 1 || value === true ? 'archived' : 'visible';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function Change({ field, change }: { field: string; change: { from: unknown; to: unknown } }) {
  // One-sided events read better as a sentence than as "from → to".
  if (field === 'deleted') return <div class="text-error text-sm">Deleted permanently</div>;
  if (field === 'recorded') {
    return (
      <div class="text-sm">Recorded {change.to === true ? '' : formatValue(field, change.to)}</div>
    );
  }
  if (field === 'order') {
    return <div class="text-sm">Sets reordered</div>;
  }
  return (
    <div class="text-sm break-words">
      <span class="font-semibold">{FIELD_LABELS[field] ?? field.replace(/_/g, ' ')}</span>:{' '}
      <span class="text-base-content/60">{formatValue(field, change.from)}</span> →{' '}
      <span>{formatValue(field, change.to)}</span>
    </div>
  );
}

/** What the entry is about: its current name, or what it was called before it went. */
function Subject({ entry }: { entry: AuditEntry }) {
  const kind = ENTITY_LABELS[entry.entity] ?? entry.entity;
  const gone = entry.changes['deleted']?.from;
  const name = entry.label ?? (typeof gone === 'string' ? gone : entry.entityId);
  return (
    <div class="min-w-0">
      <p class="text-base-content/60 text-xs">{kind}</p>
      {entry.exists ? (
        <a href={entryLink(entry)}>{name}</a>
      ) : (
        <span class="text-base-content/70">{name}</span>
      )}
    </div>
  );
}

const ACTOR_FILTERS = [
  [undefined, 'Everything'],
  ['admin', 'Archive edits'],
  ['recorder', 'Recorder'],
] as const;

export function ActivityPage(props: {
  auth: AuthState;
  entries: AuditEntry[];
  actor: 'admin' | 'recorder' | undefined;
}) {
  const { auth, entries, actor } = props;
  return (
    <AdminLayout auth={auth} title="Activity" tab="/admin/activity">
      <div class="mb-4 flex flex-wrap gap-2">
        {ACTOR_FILTERS.map(([value, label]) => (
          <a
            class={`btn btn-sm rounded-xl ${actor === value ? 'btn-primary' : 'btn-ghost'}`}
            href={withQuery('/admin/activity', { actor: value })}
          >
            {label}
          </a>
        ))}
      </div>
      {entries.length === 0 ? (
        <p class="text-base-content/60">Nothing yet.</p>
      ) : (
        <TablePanel>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr class="align-top">
                <td class="whitespace-nowrap">{formatDateTime(entry.at)}</td>
                <td>
                  <span
                    class={`badge badge-sm ${entry.actor === 'recorder' ? 'badge-info badge-soft' : 'badge-ghost'}`}
                  >
                    {entry.actor}
                  </span>
                </td>
                <td>
                  <Subject entry={entry} />
                </td>
                <td>
                  <div class="flex flex-col gap-1">
                    {Object.entries(entry.changes).map(([field, change]) => (
                      <Change field={field} change={change} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      <p class="text-base-content/60 mt-2 text-xs">
        The recorder's entries come from its session.json files: new sessions and sets, titles,
        processing results and its cleanup of raw captures. Logins and errors are only in the
        container logs.
      </p>
    </AdminLayout>
  );
}
