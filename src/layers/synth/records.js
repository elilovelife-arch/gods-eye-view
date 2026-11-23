/**
 * SYNTH's live places (Eli, Oct 10 2026: "News events around me flights and information tide to gods eye. Everything
 * live!"): the GeoJSON SYNTH serves at /app/live/places, validated whole before it replaces the last good snapshot.
 * A feed that isn't a FeatureCollection of points of a known kind is refused (null), so a half-read feed never
 * replaces a good one. Headlines share their town's point and are gathered into one row per point, newest first.
 */
export const SYNTH_KINDS = Object.freeze(['lead', 'news', 'event']);

/** A non-empty trimmed string, or null for anything else. */
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** Only SYNTH's own pages (a same-origin path) or an https article; anything else is dropped, never followed. */
const link = (v) =>
  typeof v === 'string' && /^(\/(?!\/)|https:\/\/)/.test(v) ? v : null;

/**
 * Validate SYNTH's whole feed and turn it into rows: one per lead or event, and one per town for its headlines (newest
 * first). Returns null for a feed that is not a FeatureCollection of points of a known kind, so the layer keeps its
 * last good snapshot instead of drawing half a feed.
 * @param {Object} geojson - what /app/live/places answered
 * @returns {Array<Object>|null}
 */
export function normalizeSynthSnapshot(geojson) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features))
    return null;
  const rows = [];
  const ids = new Set();
  const towns = new Map();
  for (const [index, feature] of geojson.features.entries()) {
    const coordinates = feature?.geometry?.coordinates;
    const p = feature?.properties;
    if (
      feature?.geometry?.type !== 'Point' ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      !SYNTH_KINDS.includes(p.kind)
    )
      return null;
    const [lon, lat] = coordinates;
    if (
      !Number.isFinite(lon) ||
      Math.abs(lon) > 180 ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90
    )
      return null;
    const at = Number.isFinite(p.at) ? p.at : null;
    if (p.kind === 'news') {
      const key = `${lon},${lat}`;
      let row = towns.get(key);
      if (!row) {
        row = {
          stableId: `news:${key}`,
          kind: 'news',
          lon,
          lat,
          town: text(p.town),
          items: [],
        };
        towns.set(key, row);
        rows.push(row);
      }
      const title = text(p.title);
      if (title)
        row.items.push({
          title,
          open: link(p.open),
          at,
          source: text(p.source),
        });
      continue;
    }
    const stableId = `${p.kind}:${p.id == null || p.id === '' ? `n${index + 1}` : String(p.id)}`;
    if (ids.has(stableId)) return null;
    ids.add(stableId);
    rows.push({
      stableId,
      kind: p.kind,
      lon,
      lat,
      title: text(p.title),
      open: link(p.open),
      at,
      status: text(p.status),
    });
  }
  for (const row of towns.values())
    row.items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return rows;
}
