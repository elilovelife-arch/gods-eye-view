import { normalizeSynthSnapshot } from './records.js';
export const SYNTH_PLACES_URL = '/app/live/places';

/**
 * SYNTH's own live places, read from the address God's Eye is served at (SYNTH proxies it at /globe/): no key, and
 * nothing outside SYNTH is asked. A feed that doesn't validate is refused, so the last good snapshot stays. Run on its
 * own (not through SYNTH), God's Eye gets no feed and the layer says so in its stats.
 */
export function createSynthPlacesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = SYNTH_PLACES_URL,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, {
        signal,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`SYNTH HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeSynthSnapshot(payload);
      if (!rows) throw new Error('Malformed SYNTH places feed');
      return rows;
    },
  };
}
