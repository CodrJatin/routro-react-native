import { describe, expect, it } from 'vitest';
import { getEmptyOfflineStyle, getMapStyle } from '../mapStyle';

const CANVAS = '#141313';

describe('getMapStyle', () => {
  it('returns the bundled offline style when the basemap is off', () => {
    const style = getMapStyle({ basemapEnabled: false, mode: 'dark', backgroundColor: CANVAS });

    // Deep-equal against the offline style rather than spot-checking: the
    // "fully offline" promise is that this branch is byte-for-byte what the
    // map rendered before the basemap setting existed.
    expect(style).toEqual(getEmptyOfflineStyle(CANVAS));
  });

  it('declares no sources when the basemap is off', () => {
    const style = getMapStyle({ basemapEnabled: false, mode: 'dark', backgroundColor: CANVAS });

    expect(typeof style).toBe('object');
    expect(Object.keys((style as { sources: object }).sources)).toHaveLength(0);
  });

  it('paints the offline background with the theme canvas color', () => {
    const light = getMapStyle({ basemapEnabled: false, mode: 'light', backgroundColor: '#f7f3f2' });

    expect(light).toMatchObject({
      layers: [{ id: 'background', paint: { 'background-color': '#f7f3f2' } }],
    });
  });

  it('returns a style URL per theme when the basemap is on', () => {
    const dark = getMapStyle({ basemapEnabled: true, mode: 'dark', backgroundColor: CANVAS });
    const light = getMapStyle({ basemapEnabled: true, mode: 'light', backgroundColor: CANVAS });

    expect(dark).toBe('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json');
    expect(light).toBe('https://basemaps.cartocdn.com/gl/positron-gl-style/style.json');
    expect(dark).not.toBe(light);
  });
});
