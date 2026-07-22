import compiledGraph from '../../assets/data/metro-graph.json';
import { findShortestPath } from './dijkstra';
import { buildRouteResult } from './itinerary';
import { buildStationSearchIndex, type StationSearchIndex } from './search';
import type { CompiledGraph, CompiledStation, RouteMode, RouteResult, StationId } from './types';

const graph = compiledGraph as unknown as CompiledGraph;

let searchIndex: StationSearchIndex | null = null;
function getSearchIndex(): StationSearchIndex {
  if (!searchIndex) searchIndex = buildStationSearchIndex(graph);
  return searchIndex;
}

export function getCompiledGraph(): CompiledGraph {
  return graph;
}

export function getStation(stationId: StationId): CompiledStation | undefined {
  return graph.stations[stationId];
}

export function listStations(): CompiledStation[] {
  return Object.values(graph.stations).filter((s) => !s.isOrphan);
}

export function searchStations(query: string, limit = 10): CompiledStation[] {
  return getSearchIndex().search(query, limit);
}

/** Returns null when no route exists (unknown station, orphaned station with
 * no known line, or a genuinely disconnected pair -- the compiler guarantees
 * the routable network is a single connected component, so in practice this
 * only fires for bad input). */
export function findRoute(
  originStationId: StationId,
  destinationStationId: StationId,
  mode: RouteMode,
): RouteResult | null {
  if (originStationId === destinationStationId) return null;
  const path = findShortestPath(graph, originStationId, destinationStationId, mode);
  if (!path) return null;
  return buildRouteResult(graph, path, mode);
}
