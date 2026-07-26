import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../../engine/geo';
import { getCompiledGraph, getStation } from '../../engine/graph';
import { findTrackSegment } from '../trackIndex';

/** How far a hop's drawn geometry may start from the station it claims to
 * start at. Platforms are wide and the track runs past them, so an exact
 * match isn't the bar -- the point is that it starts *at that station*, not
 * several stops away. */
const ENDPOINT_TOLERANCE_METERS = 200;

describe('track geometry for route highlighting', () => {
  const graph = getCompiledGraph();
  const rideEdges = Object.entries(graph.nodes).flatMap(([from, edges]) =>
    edges.filter((edge) => !edge.isTransfer).map((edge) => ({ from, to: edge.to, line: edge.line! })),
  );

  it('covers every ride edge, so no leg is drawn as a straight line', () => {
    // The straight-line fallback in routePolyline.ts used to carry ~60% of the
    // network: track features were whole OSM ways labelled with their two
    // endpoints, so a hop only matched when it happened to be a way's full
    // extent. compile-tracks.ts now splits ways at the stations on them.
    const uncovered = rideEdges.filter((edge) => !findTrackSegment(edge.from, edge.to, edge.line));

    expect(uncovered).toEqual([]);
  });

  it('returns geometry running between the two stations, in the direction traveled', () => {
    for (const edge of rideEdges) {
      const segment = findTrackSegment(edge.from, edge.to, edge.line)!;
      const from = getStation(graph.nodeToStation[edge.from])!;
      const to = getStation(graph.nodeToStation[edge.to])!;

      const [startLon, startLat] = segment[0];
      const [endLon, endLat] = segment[segment.length - 1];

      expect(haversineMeters(startLat, startLon, from.lat, from.lon)).toBeLessThan(
        ENDPOINT_TOLERANCE_METERS,
      );
      expect(haversineMeters(endLat, endLon, to.lat, to.lon)).toBeLessThan(
        ENDPOINT_TOLERANCE_METERS,
      );
    }
  });

  it('follows the track rather than cutting across it', () => {
    // A slice taken from the wrong way (or a silent regression back to
    // endpoint matching) shows up as geometry far longer than the crow-flies
    // distance. Real alignments curve; 2.5x is well clear of the worst
    // genuine dogleg in the network (~2x, Maujpur -> Yamuna Vihar).
    for (const edge of rideEdges) {
      const segment = findTrackSegment(edge.from, edge.to, edge.line)!;
      const from = getStation(graph.nodeToStation[edge.from])!;
      const to = getStation(graph.nodeToStation[edge.to])!;

      let drawn = 0;
      for (let i = 1; i < segment.length; i++) {
        drawn += haversineMeters(segment[i - 1][1], segment[i - 1][0], segment[i][1], segment[i][0]);
      }
      const straight = haversineMeters(from.lat, from.lon, to.lat, to.lon);
      if (straight < 100) continue; // ratio is meaningless for adjacent platforms

      expect(drawn / straight).toBeLessThan(2.5);
    }
  });
});
