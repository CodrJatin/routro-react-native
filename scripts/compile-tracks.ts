/**
 * Copies data/osm-tracks.geojson into assets/data/tracks.geojson (the asset
 * the map screen actually bundles), minified, with each feature's `color`
 * validated as real hex -- falling back to the owning line's base color from
 * osm-lines.json when it isn't (mirrors the #gray/#aqua issue caught in the
 * graph compiler's lint).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { RawLines } from '../src/engine/types';

const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
// .json (not .geojson) so TypeScript's resolveJsonModule can import it directly.
const OUT_PATH = resolve(ROOT, 'assets/data/tracks.json');
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

interface TrackFeature {
  type: 'Feature';
  properties: {
    id: string;
    startStationId: string;
    endStationId: string;
    lineId: string;
    color: string;
  };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

function main() {
  const raw: { type: 'FeatureCollection'; features: TrackFeature[] } = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'osm-tracks.geojson'), 'utf-8'),
  );
  const lines: RawLines = JSON.parse(readFileSync(resolve(DATA_DIR, 'osm-lines.json'), 'utf-8'));

  let fixedColors = 0;
  const features = raw.features.map((f) => {
    if (HEX_RE.test(f.properties.color)) return f;
    fixedColors++;
    const fallback = lines[f.properties.lineId]?.color ?? '#888888';
    return { ...f, properties: { ...f.properties, color: fallback } };
  });

  const out = { type: 'FeatureCollection' as const, features };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out));

  console.log(`Compiled tracks -> ${OUT_PATH}`);
  console.log(`  features: ${features.length}`);
  console.log(`  colors fixed from line fallback: ${fixedColors}`);
}

main();
