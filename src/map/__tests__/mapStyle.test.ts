import { describe, expect, it } from 'vitest';
import { getEmptyOfflineStyle, getMapStyle } from '../mapStyle';

const CANVAS = '#141313';

/** The options every case shares, so each test states only what it varies. */
const BASE = { placeLabelsEnabled: false, backgroundColor: CANVAS } as const;

describe('getMapStyle', () => {
  it('returns the bundled offline style when the basemap is off', () => {
    const style = getMapStyle({ ...BASE, basemapEnabled: false, mode: 'dark' });

    // Deep-equal against the offline style rather than spot-checking: the
    // "fully offline" promise is that this branch is byte-for-byte what the
    // map rendered before the basemap setting existed.
    expect(style).toEqual(getEmptyOfflineStyle(CANVAS));
  });

  it('declares no sources when the basemap is off', () => {
    const style = getMapStyle({ ...BASE, basemapEnabled: false, mode: 'dark' });

    expect(typeof style).toBe('object');
    expect(Object.keys((style as { sources: object }).sources)).toHaveLength(0);
  });

  it('paints the offline background with the theme canvas color', () => {
    const light = getMapStyle({
      ...BASE,
      basemapEnabled: false,
      mode: 'light',
      backgroundColor: '#f7f3f2',
    });

    expect(light).toMatchObject({
      layers: [{ id: 'background', paint: { 'background-color': '#f7f3f2' } }],
    });
  });

  it('returns a style URL per theme when the basemap is on', () => {
    const dark = getMapStyle({
      ...BASE,
      basemapEnabled: true,
      placeLabelsEnabled: true,
      mode: 'dark',
    });
    const light = getMapStyle({
      ...BASE,
      basemapEnabled: true,
      placeLabelsEnabled: true,
      mode: 'light',
    });

    expect(dark).toBe('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json');
    expect(light).toBe('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json');
    expect(dark).not.toBe(light);
  });

  it('returns the label-free variant per theme when place names are off', () => {
    const dark = getMapStyle({ ...BASE, basemapEnabled: true, mode: 'dark' });
    const light = getMapStyle({ ...BASE, basemapEnabled: true, mode: 'light' });

    expect(dark).toBe('https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json');
    expect(light).toBe('https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json');
  });

  it('ignores the place-name choice while the basemap is off', () => {
    // Otherwise the offline map -- which has no labels either way -- would
    // still churn its style object when the setting is toggled.
    const shown = getMapStyle({ ...BASE, basemapEnabled: false, placeLabelsEnabled: true, mode: 'dark' });
    const hidden = getMapStyle({ ...BASE, basemapEnabled: false, mode: 'dark' });

    expect(shown).toEqual(hidden);
  });
});
