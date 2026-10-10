import * as Cesium from 'cesium';
export const SYNTH_OVERLAY_SOURCE_ID = 'synth';
export const SYNTH_OVERLAY_COHORT_LIMIT = 48;
export const SYNTH_OVERLAY_COLLISION_CAPACITY = 32;
export const SYNTH_LABEL_MAX = 42;

/** SYNTH's own colours (the live map design): leads green, news blue, events amber. */
export const SYNTH_KIND_COLORS = Object.freeze({ lead: '#a6e37a', news: '#6ab0ff', event: '#f0b36b' });

/** The Cesium colour for a kind of place (lead, news, event); white for anything else. */
export function kindColor(kind) {
  return Cesium.Color.fromCssColorString(SYNTH_KIND_COLORS[kind] || '#ffffff');
}

/**
 * The label for one row, short enough for the globe: a lead's or an event's name, or for a town's headlines how many
 * there are and where (the newest one is in the analyst record). Pure.
 */
export function synthLabel(row) {
  let label;
  if (row?.kind === 'news') {
    const n = row.items?.length || 0;
    label = `${n} ${n === 1 ? 'headline' : 'headlines'}${row.town ? ` · ${row.town}` : ''}`;
  } else {
    label = row?.title || (row?.kind === 'event' ? 'Event' : 'Lead');
  }
  return label.length > SYNTH_LABEL_MAX ? `${label.slice(0, SYNTH_LABEL_MAX - 1).trimEnd()}…` : label;
}

/** A town's headlines are always labelled, then events, then the newest leads. Pure. */
export function synthPriority(row) {
  const base = { news: 3_000_000, event: 2_000_000, lead: 1_000_000 }[row?.kind] || 0;
  return base + Math.min(999_999, Math.floor((row?.at || 0) / 10_000));
}

/** Build the source-owned presentation for one SYNTH label. */
export function createSynthOverlayEntry({ id, position, title, accent, priority }) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent,
    priority,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 12,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the highest-priority labels, with stable identity as the tie-break. */
export function selectSynthOverlayCohort(entries, limit = SYNTH_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(SYNTH_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}

/**
 * Map one SYNTH place to a JSON-safe analyst record (analyst query engine seam). Pure; missing fields are null.
 * @param {Object|null|undefined} raw - {id, kind, title, open, at, count, newest, lat, lon}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.id) || `SYNTH-${String(index).padStart(4, '0')}`,
    kind: text(raw?.kind),
    title: text(raw?.title),
    newest: text(raw?.newest),
    count: num(raw?.count),
    open: text(raw?.open),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: Number.isFinite(raw?.at) ? raw.at * 1000 : null, // SYNTH sends epoch seconds
  };
}

export { normalizeSynthSnapshot, SYNTH_KINDS } from './records.js';
