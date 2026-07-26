/**
 * Compiles resources/osm-tracks.geojson into assets/data/tracks.json (the asset
 * the map screen actually bundles), minified, with two transformations:
 *
 * 1. Each feature's `color` is validated as real hex -- falling back to the
 *    owning line's base color from osm-lines.json when it isn't (mirrors the
 *    #gray/#aqua issue caught in the graph compiler's lint).
 *
 * 2. Every way is *split at the stations that lie on it*, so each output
 *    feature spans exactly one station-to-station hop and is labelled with
 *    that pair. A source OSM way runs through many stations but is labelled
 *    only with its two endpoints, which is why route highlighting could match
 *    real track geometry for barely a third of the hops it drew and rendered
 *    the rest as straight lines between station dots. The adjacency in
 *    metro-graph.json is already derived by projecting stations onto these
 *    same polylines (see lib/track-adjacency.ts) -- this reuses that
 *    projection so the drawn geometry and the routed hops agree by
 *    construction.
 *
 * Splitting is lossless for rendering: the hops plus the leftover head/tail
 * stubs cover the same geometry the unsplit way did, so the base track layer
 * looks identical.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { RawLines, RawStations } from '../src/engine/types';
import {
  cumulativeArcLength,
  projectStationOntoPolyline,
  STATION_ON_TRACK_METERS,
} from './lib/track-adjacency';

const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'resources');
// .json (not .geojson) so TypeScript's resolveJsonModule can import it directly.
const OUT_PATH = resolve(ROOT, 'assets/data/tracks.json');
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/** Track beyond the outermost station on a way is kept as its own feature so
 * the base layer doesn't visibly stop short of a terminus -- but only when
 * it's long enough to see. Below this it's projection noise. */
const MIN_STUB_METERS = 25;

/** Interpolated split points get full float precision from the arc maths;
 * ~0.1 m is far past what any zoom level resolves and keeps the asset small. */
const COORD_PRECISION = 6;

interface TrackProperties {
  id: string;
  startStationId: string;
  endStationId: string;
  lineId: string;
  color: string;
  /** True only on features that span exactly one station-to-station hop, and
   * so can be trusted as *the* geometry for that pair (see map/trackIndex.ts).
   * Head/tail stubs and unsplittable ways carry their way's endpoints, which
   * are not adjacent stations, and are for drawing only. */
  hop?: boolean;
}

interface TrackFeature {
  type: 'Feature';
  properties: TrackProperties;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

function main() {
  const raw: { type: 'FeatureCollection'; features: TrackFeature[] } = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'osm-tracks.geojson'), 'utf-8'),
  );
  const lines: RawLines = JSON.parse(readFileSync(resolve(DATA_DIR, 'osm-lines.json'), 'utf-8'));
  const stations: RawStations = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'osm-stations.json'), 'utf-8'),
  );
  const stationIds = Object.keys(stations);

  let fixedColors = 0;
  let unsplit = 0;
  const stubs: TrackFeature[] = [];

  // One hop can be covered by several overlapping ways; keep the tightest fit,
  // the same tie-break lib/track-adjacency.ts uses when choosing which way's
  // timing to believe. Without it the pair would get whichever way happened to
  // come last, including ways that bridge the pair the long way round.
  const bestHopByPair = new Map<string, { feature: TrackFeature; length: number }>();

  for (const feature of raw.features) {
    const { lineId, startStationId, endStationId } = feature.properties;

    const color = HEX_RE.test(feature.properties.color)
      ? feature.properties.color
      : ((): string => {
          fixedColors++;
          return lines[lineId]?.color ?? '#888888';
        })();

    const coords = feature.geometry.coordinates;
    const cumLen = coords.length >= 2 ? cumulativeArcLength(coords) : [0];
    const wayLength = cumLen[cumLen.length - 1];

    // Stations that (a) serve this line and (b) actually lie on this polyline.
    const onTrack: { id: string; arc: number }[] = [];
    if (wayLength > 0) {
      for (const id of stationIds) {
        const station = stations[id];
        if (!station.lines.includes(lineId)) continue;
        const { arc, dist } = projectStationOntoPolyline(station.lat, station.lon, coords, cumLen);
        if (dist <= STATION_ON_TRACK_METERS) onTrack.push({ id, arc });
      }
    }
    onTrack.sort((a, b) => a.arc - b.arc);

    // Nothing to split against -- a degenerate way, or one no station sits on
    // (a depot spur, a stretch whose stations the line-membership filter
    // rejected). Keep it whole so the map still draws it.
    if (onTrack.length < 2) {
      unsplit++;
      stubs.push({
        type: 'Feature',
        properties: { id: feature.properties.id, startStationId, endStationId, lineId, color },
        geometry: { type: 'LineString', coordinates: coords },
      });
      continue;
    }

    const head = onTrack[0];
    const tail = onTrack[onTrack.length - 1];
    if (head.arc >= MIN_STUB_METERS) {
      stubs.push(
        stubFeature(`${feature.properties.id}-head`, startStationId, head.id, lineId, color, sliceByArc(coords, cumLen, 0, head.arc)),
      );
    }
    if (wayLength - tail.arc >= MIN_STUB_METERS) {
      stubs.push(
        stubFeature(`${feature.properties.id}-tail`, tail.id, endStationId, lineId, color, sliceByArc(coords, cumLen, tail.arc, wayLength)),
      );
    }

    for (let i = 1; i < onTrack.length; i++) {
      const from = onTrack[i - 1];
      const to = onTrack[i];
      if (from.id === to.id) continue;
      const length = to.arc - from.arc;
      if (length <= 0) continue;

      const pairKey = [from.id, to.id].sort().join('|') + '|' + lineId;
      const existing = bestHopByPair.get(pairKey);
      if (existing && existing.length <= length) continue;

      bestHopByPair.set(pairKey, {
        length,
        feature: {
          type: 'Feature',
          properties: {
            id: `${from.id}--${to.id}--${lineId}`,
            startStationId: from.id,
            endStationId: to.id,
            lineId,
            color,
            hop: true,
          },
          geometry: { type: 'LineString', coordinates: sliceByArc(coords, cumLen, from.arc, to.arc) },
        },
      });
    }
  }

  const hops = [...bestHopByPair.values()].map((entry) => entry.feature);
  const features = [...hops, ...stubs];

  const out = { type: 'FeatureCollection' as const, features };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out));

  console.log(`Compiled tracks -> ${OUT_PATH}`);
  console.log(`  source ways: ${raw.features.length}`);
  console.log(`  station-to-station hops: ${hops.length}`);
  console.log(`  head/tail stubs + unsplit ways: ${stubs.length} (${unsplit} unsplit)`);
  console.log(`  colors fixed from line fallback: ${fixedColors}`);
}

function stubFeature(
  id: string,
  startStationId: string,
  endStationId: string,
  lineId: string,
  color: string,
  coordinates: [number, number][],
): TrackFeature {
  return {
    type: 'Feature',
    properties: { id, startStationId, endStationId, lineId, color },
    geometry: { type: 'LineString', coordinates },
  };
}

/** The piece of `coords` between two arc-length positions, with the cut ends
 * interpolated so the slice starts and stops exactly where the stations
 * project rather than at the nearest vertex. */
function sliceByArc(
  coords: [number, number][],
  cumLen: number[],
  fromArc: number,
  toArc: number,
): [number, number][] {
  const sliced: [number, number][] = [pointAtArc(coords, cumLen, fromArc)];
  for (let i = 0; i < coords.length; i++) {
    if (cumLen[i] > fromArc && cumLen[i] < toArc) sliced.push(coords[i]);
  }
  sliced.push(pointAtArc(coords, cumLen, toArc));

  // A cut landing on (or within rounding of) a vertex would otherwise repeat
  // it, and MapLibre draws zero-length segments as a dot under round caps.
  return sliced.filter((point, i) => i === 0 || point[0] !== sliced[i - 1][0] || point[1] !== sliced[i - 1][1]);
}

/** Position along the polyline at `arc` metres from its start. */
function pointAtArc(coords: [number, number][], cumLen: number[], arc: number): [number, number] {
  if (arc <= 0) return coords[0];
  const total = cumLen[cumLen.length - 1];
  if (arc >= total) return coords[coords.length - 1];

  let i = 1;
  while (i < cumLen.length - 1 && cumLen[i] < arc) i++;
  const span = cumLen[i] - cumLen[i - 1];
  const t = span === 0 ? 0 : (arc - cumLen[i - 1]) / span;
  const [lon0, lat0] = coords[i - 1];
  const [lon1, lat1] = coords[i];
  return [round(lon0 + (lon1 - lon0) * t), round(lat0 + (lat1 - lat0) * t)];
}

function round(value: number): number {
  return Number(value.toFixed(COORD_PRECISION));
}

main();
