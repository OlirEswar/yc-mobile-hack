import { createConvexSource } from './convexSource';
import { createMockSource } from './mockSource';
import type { WorldSource } from './WorldSource';

export type { WorldSource } from './WorldSource';

/**
 * EXPO_PUBLIC_DATA_SOURCE=mock|convex picks the source. With no setting, the live backend is used
 * when EXPO_PUBLIC_CONVEX_URL is present and the mock otherwise.
 */
export function createWorldSource(): WorldSource {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  const wanted = process.env.EXPO_PUBLIC_DATA_SOURCE ?? (url ? 'convex' : 'mock');
  if (wanted === 'convex' && url) return createConvexSource(url);
  return createMockSource();
}
