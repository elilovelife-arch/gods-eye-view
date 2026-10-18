import * as Cesium from 'cesium';
import {
  SYNTH_OVERLAY_SOURCE_ID,
  SYNTH_OVERLAY_COHORT_LIMIT,
  SYNTH_OVERLAY_COLLISION_CAPACITY,
  kindColor,
  synthLabel,
  synthPriority,
  createSynthOverlayEntry,
  selectSynthOverlayCohort,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createSynthPlacesSource, SYNTH_PLACES_URL } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * SYNTH's live places on the globe (Eli, Oct 10 2026; the live map design, phase 2): his open leads where they are,
 * his town's headlines at the town, events near him once SYNTH has them. One pin per row, coloured by kind, with the
 * town's headlines and the newest leads labelled. Read every minute from SYNTH's own feed.
 */
export function createSynthLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SYNTH places require a snapshot source');
  if (!overlayHost) throw new TypeError('SYNTH places require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'synth',
    name: 'SYNTH · leads & local news',
    icon: '◉',
    source: 'SYNTH (your Mac)',
    updateInterval: 60000,

    init(viewer) {
      if (_viewer) throw new Error('SYNTH layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('synth');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SYNTH_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const nextEntities = [];
        const overlayEntries = [];
        for (const row of rows) {
          const color = kindColor(row.kind);
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          const newest = row.kind === 'news' ? row.items[0] || null : null;
          nextEntities.push(
            new Cesium.Entity({
              id: `synth:${row.stableId}`,
              position,
              point: {
                pixelSize: row.kind === 'news' ? 14 : 9,
                color: color.withAlpha(0.95),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              properties: {
                // Analyst seam: what the pin is and where SYNTH opens it.
                synthId: row.stableId,
                kind: row.kind,
                title: row.kind === 'news' ? row.town : row.title,
                newest: newest?.title ?? null,
                count: row.kind === 'news' ? row.items.length : null,
                open: row.kind === 'news' ? (newest?.open ?? null) : row.open,
                at: row.kind === 'news' ? (newest?.at ?? null) : row.at,
              },
            }),
          );
          overlayEntries.push(
            createSynthOverlayEntry({
              id: row.stableId,
              position,
              title: synthLabel(row),
              accent: color.toCssColorString(),
              priority: synthPriority(
                row.kind === 'news' ? { ...row, at: newest?.at } : row,
              ),
            }),
          );
        }
        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            SYNTH_OVERLAY_SOURCE_ID,
            selectSynthOverlayCohort(overlayEntries),
            {
              cohortLimit: SYNTH_OVERLAY_COHORT_LIMIT,
              collisionCapacity: SYNTH_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }
        _count = rows.length;
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

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(SYNTH_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SYNTH_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /** The layer's places as plain JSON-safe records for the analyst query engine; [] while disabled or empty. */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const entities = _dataSource.entities.values;
      if (!entities.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const now = Cesium.JulianDate.now();
      const result = [];
      for (const entity of entities) {
        if (result.length >= limit) break;
        const cartesian = entity.position
          ? entity.position.getValue(now)
          : null;
        const carto = cartesian
          ? Cesium.Cartographic.fromCartesian(cartesian)
          : null;
        const p = entity.properties;
        result.push(
          mapAnalystRecord(
            {
              id: p?.synthId?.getValue(now) ?? null,
              kind: p?.kind?.getValue(now),
              title: p?.title?.getValue(now),
              newest: p?.newest?.getValue(now),
              count: p?.count?.getValue(now),
              open: p?.open?.getValue(now),
              at: p?.at?.getValue(now),
              lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
              lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
            },
            result.length,
          ),
        );
      }
      return result;
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
