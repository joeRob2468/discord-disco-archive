/**
 * The bottom player bar. Play buttons carry a queue (`data-queue`, JSON `Track[]`) and a
 * start position (`data-index`); "Add to queue" buttons carry tracks to append
 * (`data-enqueue`). Clicks are handled by delegation, so buttons in pages swapped in by
 * htmx work too. The queue panel lists what's queued, to jump to or remove. The bar itself is `hx-preserve`d, so playback carries on
 * while browsing. A set counts as played once it starts playing.
 *
 * Built by esbuild into dist/player.js (`pnpm --filter @dsr/archive build:js`).
 */
import type { Track } from './track.ts';

/** The element with `id`, checked to be a `type`. The bar's markup is in layout.tsx. */
function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`#${id} is missing or not a ${type.name}`);
  return element;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

function parseTracks(json: string | undefined): Track[] {
  try {
    return JSON.parse(json ?? '[]') as Track[];
  } catch {
    // A malformed queue is a bug in the page; ignore the click rather than break the page.
    return [];
  }
}

function parseQueue(button: HTMLElement): { queue: Track[]; index: number } | undefined {
  const queue = parseTracks(button.dataset['queue']);
  const index = Number(button.dataset['index'] ?? 0);
  return queue.length > 0
    ? { queue, index: Math.min(Math.max(index, 0), queue.length - 1) }
    : undefined;
}

function init(): void {
  const bar = byId('player', HTMLElement);
  const audio = byId('player-audio', HTMLAudioElement);
  const art = byId('player-art', HTMLElement);
  const title = byId('player-title', HTMLAnchorElement);
  const subtitle = byId('player-subtitle', HTMLElement);
  const toggle = byId('player-toggle', HTMLButtonElement);
  const previous = byId('player-prev', HTMLButtonElement);
  const next = byId('player-next', HTMLButtonElement);
  const seek = byId('player-seek', HTMLInputElement);
  const elapsed = byId('player-elapsed', HTMLElement);
  const duration = byId('player-duration', HTMLElement);
  const volume = byId('player-volume', HTMLInputElement);
  const stop = byId('player-stop', HTMLButtonElement);
  const queueToggle = byId('player-queue-toggle', HTMLButtonElement);
  const queuePanel = byId('player-queue', HTMLElement);
  const queueList = byId('player-queue-list', HTMLOListElement);
  const queueClear = byId('player-queue-clear', HTMLButtonElement);

  let queue: Track[] = [];
  let index = 0;
  let counted = false;
  let seeking = false;

  const current = (): Track | undefined => queue[index];

  function markPlaying(uuid: string | undefined): void {
    for (const element of document.querySelectorAll<HTMLElement>('[data-track-uuid]')) {
      element.classList.toggle('is-playing', element.dataset['trackUuid'] === uuid);
    }
  }

  function renderQueue(): void {
    queueClear.disabled = index >= queue.length - 1;
    queueList.replaceChildren(
      ...queue.map((track, position) => {
        const item = document.createElement('li');
        item.className = `flex items-center gap-1 rounded-xl ${position === index ? 'bg-base-100' : ''}`;
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left';
        jump.dataset['queueJump'] = String(position);
        const number = document.createElement('span');
        number.className = 'text-base-content/50 w-5 shrink-0 text-right text-xs tabular-nums';
        number.textContent = position === index ? '▶' : String(position + 1);
        const text = document.createElement('span');
        text.className = 'min-w-0';
        const name = document.createElement('span');
        name.className = `block truncate text-sm font-semibold ${position === index ? 'text-primary' : ''}`;
        name.textContent = track.title;
        const detail = document.createElement('span');
        detail.className = 'text-base-content/60 block truncate text-xs';
        detail.textContent = `${track.artist} · ${track.album}`;
        text.append(name, detail);
        jump.append(number, text);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-ghost btn-xs btn-circle shrink-0';
        remove.dataset['queueRemove'] = String(position);
        remove.setAttribute('aria-label', `Remove ${track.title} from the queue`);
        remove.textContent = '✕';
        item.append(jump, remove);
        return item;
      }),
    );
  }

  function render(): void {
    renderQueue();
    const track = current();
    if (!track) return;
    bar.hidden = false;
    document.body.classList.add('has-player');
    title.textContent = track.title;
    title.href = track.href;
    subtitle.textContent = `${track.artist} · ${track.album}`;
    art.style.background = track.art ? `center / cover url("${track.art}")` : track.gradient;
    previous.disabled = index === 0 && audio.currentTime < 3;
    next.disabled = index >= queue.length - 1;
    // Mark the playing set wherever it appears on the page.
    markPlaying(track.uuid);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.art ? [{ src: track.art }] : [],
      });
    }
  }

  function load(position: number, autoplay = true): void {
    const track = queue[position];
    if (!track) return;
    index = position;
    counted = false;
    audio.src = track.src;
    render();
    if (autoplay) void audio.play().catch(() => undefined);
  }

  /** Stop playback, empty the queue and hide the bar. */
  function stopAll(): void {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    queue = [];
    index = 0;
    bar.hidden = true;
    queuePanel.hidden = true;
    queueToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('has-player');
    markPlaying(undefined);
    renderQueue();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }

  function enqueue(tracks: Track[]): void {
    if (tracks.length === 0) return;
    const empty = queue.length === 0;
    queue = [...queue, ...tracks];
    // Nothing loaded yet: show the first one in the bar, ready to play.
    if (empty) load(0, false);
    else render();
  }

  function removeAt(position: number): void {
    if (position < 0 || position >= queue.length) return;
    queue = queue.filter((_, i) => i !== position);
    if (queue.length === 0) {
      stopAll();
      return;
    }
    if (position < index) index -= 1;
    else if (position === index) {
      // The playing set was removed: carry on with whatever took its place.
      load(Math.min(index, queue.length - 1), !audio.paused);
      return;
    }
    render();
  }

  function countPlay(track: Track): void {
    counted = true;
    void fetch(`/api/plays/${encodeURIComponent(track.uuid)}`, { method: 'POST' }).catch(
      () => undefined,
    );
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const add = target?.closest<HTMLElement>('[data-enqueue]');
    if (add) {
      event.preventDefault();
      event.stopPropagation();
      enqueue(parseTracks(add.dataset['enqueue']));
      // Brief confirmation on the button itself.
      add.classList.add('btn-success');
      setTimeout(() => {
        add.classList.remove('btn-success');
      }, 1200);
      return;
    }
    // Clicking outside the open queue panel closes it.
    if (
      !queuePanel.hidden &&
      target &&
      !queuePanel.contains(target) &&
      !queueToggle.contains(target)
    ) {
      queuePanel.hidden = true;
      queueToggle.setAttribute('aria-expanded', 'false');
    }
    const button = target?.closest<HTMLElement>('[data-queue]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const parsed = parseQueue(button);
    if (!parsed) return;
    const same = current()?.uuid === parsed.queue[parsed.index]?.uuid;
    if (same && !audio.paused) {
      audio.pause();
      return;
    }
    queue = parsed.queue;
    if (same) {
      index = parsed.index;
      void audio.play().catch(() => undefined);
      render();
    } else {
      load(parsed.index);
    }
  });

  stop.addEventListener('click', stopAll);
  queueToggle.addEventListener('click', () => {
    queuePanel.hidden = !queuePanel.hidden;
    queueToggle.setAttribute('aria-expanded', String(!queuePanel.hidden));
  });
  queueClear.addEventListener('click', () => {
    queue = queue.slice(0, index + 1);
    render();
  });
  queueList.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest<HTMLElement>('[data-queue-remove]');
    if (remove) {
      removeAt(Number(remove.dataset['queueRemove']));
      return;
    }
    const jump = target?.closest<HTMLElement>('[data-queue-jump]');
    if (jump) load(Number(jump.dataset['queueJump']));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !queuePanel.hidden) {
      queuePanel.hidden = true;
      queueToggle.setAttribute('aria-expanded', 'false');
    }
  });

  toggle.addEventListener('click', () => {
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  });
  previous.addEventListener('click', () => {
    if (audio.currentTime > 3 || index === 0) audio.currentTime = 0;
    else load(index - 1);
  });
  next.addEventListener('click', () => {
    load(index + 1);
  });

  seek.addEventListener('input', () => {
    seeking = true;
    elapsed.textContent = formatTime((Number(seek.value) / 1000) * audio.duration);
  });
  seek.addEventListener('change', () => {
    seeking = false;
    if (Number.isFinite(audio.duration))
      audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  });
  volume.addEventListener('input', () => {
    audio.volume = Number(volume.value);
    try {
      localStorage.setItem('volume', volume.value);
    } catch {
      // Storage may be unavailable (private mode); the volume just isn't remembered.
    }
  });
  try {
    const saved = localStorage.getItem('volume');
    if (saved !== null) {
      volume.value = saved;
      audio.volume = Number(saved);
    }
  } catch {
    // As above: fall back to full volume.
  }

  audio.addEventListener('play', () => {
    bar.dataset['state'] = 'playing';
  });
  // Count each loaded set once, when playback actually begins.
  audio.addEventListener('playing', () => {
    const track = current();
    if (track && !counted) countPlay(track);
  });
  audio.addEventListener('pause', () => {
    bar.dataset['state'] = 'paused';
  });
  audio.addEventListener('loadedmetadata', () => {
    duration.textContent = formatTime(audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    const now = audio.currentTime;
    if (!seeking && Number.isFinite(audio.duration)) {
      seek.value = String(Math.round((now / audio.duration) * 1000));
      elapsed.textContent = formatTime(now);
    }
  });
  audio.addEventListener('ended', () => {
    if (index < queue.length - 1) load(index + 1);
  });

  // Re-mark the playing set after htmx swaps in a new page.
  document.body.addEventListener('htmx:afterSettle', render);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => void audio.play());
    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      previous.click();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      next.click();
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
