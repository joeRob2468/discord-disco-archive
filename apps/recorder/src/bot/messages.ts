/**
 * User-facing message text. Pure, so wording can be tested and changed in one place.
 * Mentions are rendered but never ping (replies are sent with `allowedMentions: none`).
 */
import type {
  SessionInfo,
  SessionStatus,
  SwitchReason,
  Target,
  TargetChange,
} from '../session/session-manager.ts';

/** `1h02m`, `4m`, `0m`. */
export function formatElapsed(fromMs: number, toMs: number): string {
  const minutes = Math.max(0, Math.floor((toMs - fromMs) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

const relative = (date: Date): string => `<t:${Math.floor(date.getTime() / 1000)}:R>`;

export function sessionStarted(session: SessionInfo, firstTarget: Target | undefined): string {
  const title = session.title ? `: **${session.title}**` : '';
  const first = firstTarget
    ? `\n🎧 First up: **${firstTarget.displayName}** (already live).`
    : '\nWaiting for someone to go live.';
  return (
    `🔴 Recording session started in <#${session.channelId}> by <@${session.startedBy.userId}>${title}.\n` +
    'Go Live streams in this channel will be recorded.' +
    first
  );
}

export function sessionResumed(
  session: SessionInfo,
  sets: number,
  firstTarget: Target | undefined,
): string {
  const name = session.title ?? session.channelName;
  const first = firstTarget
    ? `\n🎧 Recording **${firstTarget.displayName}** (already live).`
    : '\nWaiting for someone to go live.';
  return (
    `🔁 Resumed recording session **${name}** in <#${session.channelId}> ` +
    `(${String(sets)} ${sets === 1 ? 'set' : 'sets'} so far); new sets are added to it.` +
    first
  );
}

export function sessionStopped(session: SessionInfo, now: Date): string {
  return `⏹️ Recording session ended after ${formatElapsed(session.startedAt.getTime(), now.getTime())}.`;
}

export function titleChanged(title: string): string {
  return `📝 Session title: **${title}**`;
}

const REASONS: Record<SwitchReason, string> = {
  'already-live': 'already live when recording started',
  'went-live': 'went live',
  'stopped-streaming': 'stopped streaming',
  silence: 'went silent',
  requested: 'requested',
  'session-stopped': 'session stopped',
  'stream-dropped': 'stream dropped',
  resumed: 'came back',
};

export function switched(change: TargetChange): string {
  const from = change.from ? `**${change.from.displayName}**` : 'nobody';
  const to = change.to ? `**${change.to.displayName}**` : 'nobody';
  let reason = REASONS[change.reason];
  if (change.reason === 'requested' && change.requestedBy)
    reason = `requested by <@${change.requestedBy}>`;
  if (change.reason === 'stopped-streaming' && change.from)
    reason = `${change.from.displayName} stopped streaming`;
  return `🔀 Switched from ${from} to ${to}: ${reason}.`;
}

/**
 * The automatic channel notice for a target change, or undefined when none is needed:
 * the start reply already names an already-live first target, and the stop reply covers
 * the end of the session.
 */
export function targetChanged(change: TargetChange): string | undefined {
  if (change.reason === 'already-live' || change.reason === 'session-stopped') return undefined;
  if (change.reason === 'stream-dropped' && change.from) {
    return (
      `⏳ **${change.from.displayName}**'s stream dropped. Keeping their set open for ` +
      `${String(change.holdSeconds ?? 0)} s in case it comes back.`
    );
  }
  if (change.reason === 'resumed' && change.to) {
    return `▶️ **${change.to.displayName}** is back. Continuing the same set.`;
  }
  if (change.from && change.to) return switched(change);
  if (change.to) return `🔴 Now recording **${change.to.displayName}**.`;
  if (change.from) {
    return `⏸️ **${change.from.displayName}** stopped streaming. Waiting for the next stream.`;
  }
  return undefined;
}

export function status(current: SessionStatus, now: Date): string {
  const { session, target, held, live } = current;
  const lines = [
    `🔴 Recording <#${session.channelId}>${session.title ? `: **${session.title}**` : ''} for ${formatElapsed(session.startedAt.getTime(), now.getTime())}.`,
    target
      ? `🎧 Recording: **${target.displayName}** (since ${relative(target.since)})`
      : held
        ? `⏳ Waiting for **${held.displayName}** to come back (their set is still open)`
        : '🎧 Recording: nobody is live',
  ];
  const others = live.filter((stream) => stream.userId !== target?.userId);
  if (others.length > 0) {
    lines.push(
      `📡 Also live: ${others.map((s) => `**${s.displayName}** (${relative(s.since)})`).join(', ')}`,
    );
  }
  return lines.join('\n');
}
