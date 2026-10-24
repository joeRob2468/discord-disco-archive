/**
 * Public URLs. Sessions (albums) are addressed by their UUID, and sets live under their
 * session by the set's UUID: `/sessions/<session>/sets/<set>`.
 */
import type { SetSummary } from '../catalog/catalog.ts';

export const sessionUrl = (sessionId: string): string =>
  `/sessions/${encodeURIComponent(sessionId)}`;

export const setUrl = (set: Pick<SetSummary, 'sessionId' | 'uuid'>): string =>
  `${sessionUrl(set.sessionId)}/sets/${set.uuid}`;

export interface SearchFilters {
  q?: string | undefined;
  sessionId?: string | undefined;
  userId?: string | undefined;
  page?: number | undefined;
}

export function searchUrl(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.sessionId) params.set('session', filters.sessionId);
  if (filters.userId) params.set('streamer', filters.userId);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return `/search${query ? `?${query}` : ''}`;
}
