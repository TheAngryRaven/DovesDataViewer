import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseWaybackConfig,
  waybackToLeafletUrl,
  fetchWaybackReleases,
  DEFAULT_SATELLITE_TILE_URL,
} from './satelliteImagery';

const WMTS = (n: number) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${n}/{level}/{row}/{col}`;

describe('waybackToLeafletUrl', () => {
  it('rewrites Esri WMTS placeholders to Leaflet ones', () => {
    expect(waybackToLeafletUrl(WMTS(10842))).toBe(
      'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10842/{z}/{y}/{x}',
    );
  });

  it('leaves an already-Leaflet URL untouched', () => {
    expect(waybackToLeafletUrl(DEFAULT_SATELLITE_TILE_URL)).toBe(DEFAULT_SATELLITE_TILE_URL);
  });
});

describe('parseWaybackConfig', () => {
  const raw = {
    '10842': { itemTitle: 'World Imagery (Wayback 2026-05-28)', itemURL: WMTS(10842) },
    '49059': { itemTitle: 'World Imagery (Wayback 2026-04-30)', itemURL: WMTS(49059) },
    '22869': { itemTitle: 'World Imagery (Wayback 2024-03-26)', itemURL: WMTS(22869) },
  };

  it('parses releaseNum, date and a Leaflet tile URL', () => {
    const out = parseWaybackConfig(raw);
    expect(out).toHaveLength(3);
    const first = out[0];
    expect(first.releaseNum).toBe(10842);
    expect(first.date).toBe('2026-05-28');
    expect(first.tileUrl).toContain('{z}/{y}/{x}');
    expect(first.tileUrl).not.toContain('{level}');
  });

  it('sorts releases newest-first by date', () => {
    const dates = parseWaybackConfig(raw).map((r) => r.date);
    expect(dates).toEqual(['2026-05-28', '2026-04-30', '2024-03-26']);
  });

  it('skips entries with no date or no tile URL', () => {
    const out = parseWaybackConfig({
      '1': { itemTitle: 'No date here', itemURL: WMTS(1) },
      '2': { itemTitle: 'World Imagery (Wayback 2020-01-01)' }, // no itemURL
      '3': { itemTitle: 'World Imagery (Wayback 2021-06-15)', itemURL: WMTS(3) },
    });
    expect(out.map((r) => r.date)).toEqual(['2021-06-15']);
  });

  it('ignores non-numeric keys', () => {
    const out = parseWaybackConfig({
      foo: { itemTitle: 'World Imagery (Wayback 2022-02-02)', itemURL: WMTS(5) },
    });
    expect(out).toHaveLength(0);
  });
});

describe('fetchWaybackReleases (memoisation + retry)', () => {
  const RAW = {
    '10842': { itemTitle: 'World Imagery (Wayback 2026-05-28)', itemURL: WMTS(10842) },
    '49059': { itemTitle: 'World Imagery (Wayback 2026-04-30)', itemURL: WMTS(49059) },
    '22869': { itemTitle: 'World Imagery (Wayback 2024-03-26)', itemURL: WMTS(22869) },
  };
  const okResponse = () => ({ ok: true, json: async () => RAW });

  afterEach(() => vi.unstubAllGlobals());

  // Guards the property the StrictMode-safe hook relies on: a second call while
  // the first is in flight reuses the same promise (one network request).
  it('memoises the promise across calls', async () => {
    vi.resetModules();
    const mod = await import('./satelliteImagery');
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const p1 = mod.fetchWaybackReleases();
    const p2 = mod.fetchWaybackReleases();
    expect(p1).toBe(p2);

    const out = await p1;
    expect(out).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The cache must clear on failure, otherwise a transient error would wedge the
  // picker permanently (it could never retry).
  it('clears the cache after a failed fetch so a retry can succeed', async () => {
    vi.resetModules();
    const mod = await import('./satelliteImagery');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(mod.fetchWaybackReleases()).rejects.toThrow();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const out = await mod.fetchWaybackReleases();
    expect(out).toHaveLength(3);
  });
});
