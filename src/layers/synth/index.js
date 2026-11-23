import { fromDegrees } from '../../geo/ellipsoid.js';
import { drawOf } from '../../render/rendererOf.js';
import { msg } from '../../i18n/marker.js';
import {
  SYNTH_OVERLAY_SOURCE_ID,
  SYNTH_OVERLAY_COHORT_LIMIT,
  SYNTH_OVERLAY_COLLISION_CAPACITY,
  kindColor,
  kindRgba,
  synthLabel,
  synthPriority,
  createSynthOverlayEntry,
  selectSynthOverlayCohort,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createSynthPlacesSource, SYNTH_PLACES_URL } from './source.js';

export const SYNTH_LAYER_ID = 'synth';
const OUTLINE = [0, 0, 0, 0.6];
/** Each layer's draw set id is its own, so several can share a renderer. */
let instances = 0;

/** The analyst fields for one row: a town's headlines are named by the town and their newest story. Pure. */
function analystFields(row) {
  if (row.kind !== 'news')
    return {
      title: row.title,
      newest: null,
      count: null,
      open: row.open,
      at: row.at,
    };
  const newest = row.items[0] || null;
  return {
    title: row.town,
    newest: newest?.title ?? null,
    count: row.items.length,
    open: newest?.open ?? null,
    at: newest?.at ?? null,
  };
}

/**
 * SYNTH's live places on the globe (Eli, Oct 10 2026; the live map design, phase 2): his open leads where they are,
 * his town's headlines at the town, events near him once SYNTH has them. One point per row (a draw set on the
 * viewer's renderer), coloured by kind, with the town's headlines and the newest leads labelled through the overlay
 * host. Read every minute from SYNTH's own feed.
 * @param {{source: {getSnapshot: Function}, overlayHost: object}} options
 */
export function createSynthLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SYNTH places require a snapshot source');
  if (!overlayHost) throw new TypeError('SYNTH places require an overlay host');
  /** The places' points, or null before `init` and after `destroy`. */
  let _points = null;
  let _request = null;
  /** The rows last drawn, so analyst reads come from the layer, not the drawing. */
  let _rows = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  return {
    id: SYNTH_LAYER_ID,
    name: 'SYNTH · leads & local news',
    icon: '◉',
    source: 'SYNTH (your Mac)',
    updateInterval: 60000,

    init(viewer) {
      if (_points) throw new Error('SYNTH layer is already initialized');
      _points = drawOf(viewer).points({
        id: `${SYNTH_LAYER_ID}:${++instances}:points`,
        show: false,
      });
      _rows = [];
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_points) _points.show = false;
      overlayHost.clearSource(SYNTH_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_points) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const items = [];
        const overlayEntries = [];
        for (const row of rows) {
          const fields = analystFields(row);
          items.push({
            id: `synth:${row.stableId}`,
            pos: { lon: row.lon, lat: row.lat },
            height: 'clampGround',
            pixelSize: row.kind === 'news' ? 14 : 9,
            color: kindRgba(row.kind, 0.95),
            outlineColor: OUTLINE,
            outlineWidth: 2,
            // On top only up close, as upstream's place layers: beyond that the
            // depth test keeps far-side points from showing through the globe.
            disableDepthTest: 2500,
          });
          overlayEntries.push(
            createSynthOverlayEntry({
              id: row.stableId,
              position: fromDegrees(row.lon, row.lat),
              title: synthLabel(row),
              accent: kindColor(row.kind),
              priority: synthPriority(
                row.kind === 'news' ? { ...row, at: fields.at } : row,
              ),
            }),
          );
        }
        _points.set(items);
        overlayHost.setEntries(
          SYNTH_OVERLAY_SOURCE_ID,
          selectSynthOverlayCohort(overlayEntries),
          {
            cohortLimit: SYNTH_OVERLAY_COHORT_LIMIT,
            collisionCapacity: SYNTH_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
        _rows = rows.slice();
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SYNTH] Fetch error:', e);
        _lastError = e?.message || msg('SYNTH places unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      _request = null;
      _enabled = false;
      overlayHost.clearSource(SYNTH_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, false);
      _points?.dispose();
      _points = null;
      _rows = [];
      _lastUpdate = null;
      _lastError = null;
    },

    /** The layer's places as plain JSON-safe records for the analyst query engine; [] while disabled or empty. */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_rows.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _rows.slice(0, limit).map((row, index) =>
        mapAnalystRecord(
          {
            id: row.stableId,
            kind: row.kind,
            ...analystFields(row),
            lat: row.lat,
            lon: row.lon,
          },
          index,
        ),
      );
    },

    getStats() {
      return {
        count: _rows.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
}
