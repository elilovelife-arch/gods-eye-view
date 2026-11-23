import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSynthLayer,
  createSynthPlacesSource,
  normalizeSynthSnapshot,
  synthLabel,
  synthPriority,
  kindRgba,
  SYNTH_PLACES_URL,
} from './index.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const point = (lon, lat, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});
const FEED = {
  type: 'FeatureCollection',
  near: 'you',
  town: 'Saint Paul',
  features: [
    point(-93.1, 44.94, {
      kind: 'lead',
      id: 'a1',
      title: 'Rise Bakery (bakery)',
      status: 'new',
      open: '/app#sales',
      at: 10,
    }),
    point(-93.09, 44.95, {
      kind: 'news',
      title: 'Older story',
      source: 'MPR News',
      open: 'https://news.example/1',
      at: 100,
      town: 'Saint Paul',
    }),
    point(-93.09, 44.95, {
      kind: 'news',
      title: 'Newest story',
      source: 'KARE 11',
      open: 'https://news.example/2',
      at: 200,
      town: 'Saint Paul',
    }),
  ],
};

function harness(source) {
  const events = [];
  const viewer = {};
  const { draw } = bindFakeDraw(viewer);
  const layer = createSynthLayer({
    source,
    overlayHost: {
      setEntries: (...args) => events.push(args),
      setVisible() {},
      clearSource: (id) => events.push(['clear', id]),
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  const points = () => draw.find('synth:');
  return { layer, viewer, points, events };
}

test('a SYNTH feed becomes one row per lead and one per town for its headlines, newest first', () => {
  const rows = normalizeSynthSnapshot(FEED);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    stableId: 'lead:a1',
    kind: 'lead',
    lon: -93.1,
    lat: 44.94,
    title: 'Rise Bakery (bakery)',
    open: '/app#sales',
    at: 10,
    status: 'new',
  });
  assert.equal(rows[1].kind, 'news');
  assert.deepEqual(
    rows[1].items.map((i) => i.title),
    ['Newest story', 'Older story'],
  );
  assert.equal(rows[1].town, 'Saint Paul');
});

test('a malformed feed is refused whole, and only SYNTH paths or https links are kept', () => {
  for (const bad of [
    null,
    { features: [] },
    { type: 'FeatureCollection', features: [point(-93, 44, { kind: 'spy' })] },
    {
      type: 'FeatureCollection',
      features: [point(-200, 44, { kind: 'lead' })],
    },
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: { kind: 'lead' },
        },
      ],
    },
    {
      type: 'FeatureCollection',
      features: [
        point(-93, 44, { kind: 'lead', id: 'x' }),
        point(-93, 44, { kind: 'lead', id: 'x' }),
      ],
    },
  ])
    assert.equal(normalizeSynthSnapshot(bad), null, JSON.stringify(bad));
  const rows = normalizeSynthSnapshot({
    type: 'FeatureCollection',
    features: [
      point(-93, 44, { kind: 'lead', id: 'j', open: 'javascript:alert(1)' }),
      point(-93, 44, { kind: 'lead', id: 'p', open: '//elsewhere.example/x' }),
      point(-93, 44, { kind: 'lead', id: 'h', open: 'http://plain.example' }),
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.open),
    [null, null, null],
  );
});

test("labels stay short; a town's headlines outrank events, and events outrank leads", () => {
  const [lead, news] = normalizeSynthSnapshot(FEED);
  assert.equal(synthLabel(news), '2 headlines · Saint Paul');
  assert.equal(
    synthLabel({
      kind: 'lead',
      title: 'A very long business name that keeps going past the globe',
    }).length,
    42,
  );
  assert.ok(synthPriority(news) > synthPriority({ kind: 'event', at: 9e9 }));
  assert.ok(
    synthPriority({ kind: 'event', at: 0 }) >
      synthPriority({ ...lead, at: 9e9 }),
  );
});

test('the source reads SYNTH at its own address and refuses an answer it cannot use', async () => {
  const asked = [];
  const ok = createSynthPlacesSource({
    fetchImpl: async (url, init) => {
      asked.push([url, init.credentials]);
      return { ok: true, json: async () => FEED };
    },
  });
  assert.equal((await ok.getSnapshot()).length, 2);
  assert.deepEqual(asked, [[SYNTH_PLACES_URL, 'same-origin']]);
  await assert.rejects(
    createSynthPlacesSource({
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }).getSnapshot(),
    /SYNTH HTTP 404/,
  );
  await assert.rejects(
    createSynthPlacesSource({
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }).getSnapshot(),
    /Malformed SYNTH places feed/,
  );
});

test('the layer pins every place, labels them, and keeps the last good pins when SYNTH does not answer', async () => {
  let answer = FEED;
  const { layer, points, events } = harness({
    getSnapshot: async () => {
      if (!answer) throw new Error('SYNTH HTTP 502');
      return normalizeSynthSnapshot(answer);
    },
  });
  assert.equal(await layer.update(), true);
  assert.equal(points().items.size, 2);
  assert.equal(points().show, true);
  const town = [...points().items.values()].find((item) =>
    item.id.startsWith('synth:news:'),
  );
  assert.equal(town.pixelSize, 14);
  assert.deepEqual(town.color, kindRgba('news', 0.95));
  assert.equal(town.height, 'clampGround');
  const records = layer.getAnalystRecords();
  assert.deepEqual(
    records.map((r) => [r.kind, r.title, r.newest, r.count]),
    [
      ['lead', 'Rise Bakery (bakery)', null, null],
      ['news', 'Saint Paul', 'Newest story', 2],
    ],
  );
  const [, entries] = events.find((e) => e[0] === 'synth');
  assert.deepEqual(
    entries.map((e) => e.title),
    ['2 headlines · Saint Paul', 'Rise Bakery (bakery)'],
  );
  assert.equal(layer.getStats().count, 2);
  answer = null;
  assert.equal(await layer.update(), false);
  assert.equal(points().items.size, 2, 'the last good pins stay');
  assert.equal(layer.getStats().error, 'SYNTH HTTP 502');
  layer.disable();
  assert.ok(events.some((e) => e[0] === 'clear' && e[1] === 'synth'));
  assert.equal(points().show, false);
  assert.deepEqual(layer.getAnalystRecords(), [], 'off: nothing to query');
  layer.destroy();
  assert.equal(points(), undefined, 'destroy lets the points go');
});

test('kind colours become renderer RGBA tuples', () => {
  assert.deepEqual(kindRgba('lead', 0.5), [
    0xa6 / 255,
    0xe3 / 255,
    0x7a / 255,
    0.5,
  ]);
  assert.deepEqual(kindRgba('unknown'), [1, 1, 1, 1]);
});
