/**
 * The bottom player bar. Play buttons carry a queue (`data-queue`, JSON `Track[]`) and a
 * start position (`data-index`); clicks are handled by delegation, so buttons in pages
 * swapped in by htmx work too. The bar itself is `hx-preserve`d, so playback carries on
 * while browsing. A set counts as played after 30 s of actual listening.
 *
 * Built by esbuild into dist/player.js (`pnpm --filter @dsr/archive build:js`).
 */
import type { Track } from './track.ts';

const PLAY_COUNT_SECONDS = 30;

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

function parseQueue(button: HTMLElement): { queue: Track[]; index: number } | undefined {
  try {
    const queue = JSON.parse(button.dataset['queue'] ?? '[]') as Track[];
    const index = Number(button.dataset['index'] ?? 0);
    return queue.length > 0
      ? { queue, index: Math.min(Math.max(index, 0), queue.length - 1) }
      : undefined;
  } catch {
    // A malformed queue is a bug in the page; ignore the click rather than break the page.
    return undefined;
  }
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

  let queue: Track[] = [];
  let index = 0;
  let listened = 0;
  let lastTime = 0;
  let counted = false;
  let seeking = false;

  const current = (): Track | undefined => queue[index];

  function render(): void {
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
    for (const element of document.querySelectorAll<HTMLElement>('[data-track-uuid]')) {
      element.classList.toggle('is-playing', element.dataset['trackUuid'] === track.uuid);
    }
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
    listened = 0;
    lastTime = 0;
    counted = false;
    audio.src = track.src;
    render();
    if (autoplay) void audio.play().catch(() => undefined);
  }

  function countPlay(track: Track): void {
    counted = true;
    void fetch(`/api/plays/${encodeURIComponent(track.uuid)}`, { method: 'POST' }).catch(
      () => undefined,
    );
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
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
  audio.addEventListener('pause', () => {
    bar.dataset['state'] = 'paused';
  });
  audio.addEventListener('loadedmetadata', () => {
    duration.textContent = formatTime(audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    const now = audio.currentTime;
    // Count only real listening: small forward steps while playing, not seeks.
    const step = now - lastTime;
    if (!audio.paused && step > 0 && step < 2) listened += step;
    lastTime = now;
    const track = current();
    if (track && !counted && listened >= PLAY_COUNT_SECONDS) countPlay(track);
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
