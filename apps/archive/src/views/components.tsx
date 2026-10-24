/** Media links shared by the set pages. */
import type { SetSummary } from '../catalog/catalog.ts';

export const mediaUrl = (setId: string, format: string, download = false): string =>
  `/media/${encodeURIComponent(setId)}/${format}${download ? '?download=1' : ''}`;

export function Downloads({ set }: { set: SetSummary }) {
  const formats = [
    ['mp3', 'MP3'],
    ['master', 'FLAC'],
    ['m4a', 'AAC'],
    ['mp4', 'Video (MP4)'],
    ['rawAudio', 'WAV (raw)'],
  ] as const;
  const available = formats.filter(([key]) => set.files[key] !== undefined);
  if (available.length === 0) return null;
  return (
    <div class="flex flex-wrap gap-2">
      {available.map(([key, label]) => (
        // A real download, not an hx-boost page swap.
        <a
          class="btn btn-sm btn-soft"
          hx-boost="false"
          href={mediaUrl(set.id, key === 'rawAudio' ? 'raw' : key, true)}
        >
          Download {label}
        </a>
      ))}
    </div>
  );
}
