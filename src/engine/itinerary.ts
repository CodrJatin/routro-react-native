import type { PathResult } from './dijkstra';
import { estimateFareRupees } from './fare';
import type { CompiledGraph, ItineraryLeg, ItineraryStep, RouteMode, RouteResult } from './types';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toStep(graph: CompiledGraph, nodeId: string): ItineraryStep {
  const station = graph.stations[graph.nodeToStation[nodeId]];
  return {
    stationId: station.id,
    stationName: station.name,
    lat: station.lat,
    lon: station.lon,
  };
}

export function buildRouteResult(
  graph: CompiledGraph,
  path: PathResult,
  mode: RouteMode,
): RouteResult {
  const { nodePath, edgePath } = path;

  const legs: ItineraryLeg[] = [];
  let i = 0;
  while (i < edgePath.length) {
    if (edgePath[i].isTransfer) {
      i++;
      continue;
    }
    const line = edgePath[i].line!;
    const legStart = i;
    let legTime = 0;
    while (i < edgePath.length && !edgePath[i].isTransfer && edgePath[i].line === line) {
      legTime += edgePath[i].time;
      i++;
    }
    const legNodes = nodePath.slice(legStart, i + 1);
    legs.push({
      line,
      boardingStation: toStep(graph, legNodes[0]),
      intermediateStations: legNodes.slice(1, -1).map((n) => toStep(graph, n)),
      alightingStation: toStep(graph, legNodes[legNodes.length - 1]),
      legTimeSeconds: legTime,
    });
  }

  // Distinct physical stations along the route (collapses same-station platform hops).
  const canonicalSeq = nodePath.map((n) => graph.nodeToStation[n]);
  const collapsedStationIds = canonicalSeq.filter((id, idx) => idx === 0 || id !== canonicalSeq[idx - 1]);

  let distanceMeters = 0;
  for (let s = 1; s < collapsedStationIds.length; s++) {
    const a = graph.stations[collapsedStationIds[s - 1]];
    const b = graph.stations[collapsedStationIds[s]];
    distanceMeters += haversineMeters(a.lat, a.lon, b.lat, b.lon);
  }

  return {
    mode,
    legs,
    totalTimeSeconds: path.totalTimeSeconds,
    stationsPassed: collapsedStationIds.length,
    interchanges: path.interchanges,
    distanceMeters,
    fareRupees: estimateFareRupees(distanceMeters),
    originStationId: collapsedStationIds[0],
    destinationStationId: collapsedStationIds[collapsedStationIds.length - 1],
  };
}
