/**
 * Public IDs for sets. A set's own ID (`<timestamp>_<dj>`) is fine on disk but awkward in
 * URLs, so URLs use a UUID derived from the session ID and set ID (RFC 9562 version 5).
 * Being derived, it stays the same if the database is rebuilt from `session.json`.
 */
import { createHash } from 'node:crypto';

/** Namespace for this archive's set UUIDs (itself a random v4 UUID; never change it). */
const SET_NAMESPACE = '6d0f1c3e-4b8a-4f62-9a57-2e1d8c4b7a90';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const setUuid = (sessionId: string, setId: string): string =>
  uuidV5(SET_NAMESPACE, `${sessionId}/${setId}`);
