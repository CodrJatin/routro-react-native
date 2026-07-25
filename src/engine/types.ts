// ---- Raw source data shapes (data/osm-*.json, as scraped from OSM) ----

export type LineId = string;
export type StationId = string; // raw graph node id (may be a per-line "platform" id)

export interface RawEdge {
  to: StationId;
  time_seconds: number;
  line: LineId;
}

export type RawGraph = Record<StationId, RawEdge[]>;

export interface RawStation {
  id: StationId;
  name: string;
  lat: number;
  lon: number;
  lines: LineId[];
}

export type RawStations = Record<StationId, RawStation>;

export interface RawLine {
  id: LineId;
  name: string;
  color: string;
  highlightColor: string;
}

export type RawLines = Record<LineId, RawLine>;

// ---- Compiled graph (assets/data/metro-graph.json, bundled with the app) ----

export interface CompiledEdge {
  to: StationId;
  time: number; // seconds
  line: LineId | null; // null only for synthesized transfer/walk edges
  isTransfer: boolean;
}

/** A physical station. May be backed by multiple raw graph nodes ("platforms")
 * when the source data modeled one interchange as separate per-line nodes. */
export interface CompiledStation {
  id: StationId; // canonical id, stable across recompiles
  name: string;
  lat: number;
  lon: number;
  lines: LineId[];
  platformIds: StationId[];
  /** True if this station has no known edges/line in the source data --
   * excluded from pathfinding, shown as "route unavailable" in the UI. */
  isOrphan: boolean;
}

export interface LintReport {
  longEdges: { from: StationId; to: StationId; time: number; line: LineId }[];
  mergedGroups: { canonicalId: StationId; platformIds: StationId[] }[];
  stitchedJunctions: { from: StationId; to: StationId; distanceMeters: number; time: number }[];
  invalidLineColors: { lineId: LineId; field: 'color' | 'highlightColor'; value: string }[];
  /** Stations with zero edges and no known line in the source data. Kept in
   * the compiled output (for search/map display) but excluded from
   * pathfinding -- routing to/from these must be reported as unavailable. */
  orphanStations: StationId[];
}

export interface CompiledGraph {
  formatVersion: number;
  generatedAt: string;
  /** adjacency list keyed by raw/platform node id */
  nodes: Record<StationId, CompiledEdge[]>;
  /** physical stations keyed by canonical station id */
  stations: Record<StationId, CompiledStation>;
  /** raw/platform node id -> canonical station id */
  nodeToStation: Record<StationId, StationId>;
  lines: RawLines;
  lint: LintReport;
}

// ---- Pathfinding ----

export type RouteMode = 'fastest' | 'min-interchange';

export interface ItineraryStep {
  stationId: StationId;
  stationName: string;
  lat: number;
  lon: number;
}

export interface ItineraryLeg {
  line: LineId;
  boardingStation: ItineraryStep;
  intermediateStations: ItineraryStep[];
  alightingStation: ItineraryStep;
  legTimeSeconds: number;
  /** Walk/platform-change time consumed getting here from the previous leg's
   * alighting station. 0 for the first leg (trip origin, no transfer yet). */
  transferSecondsBefore: number;
}

export interface RouteResult {
  mode: RouteMode;
  legs: ItineraryLeg[];
  totalTimeSeconds: number;
  stationsPassed: number;
  interchanges: number;
  distanceMeters: number;
  fareRupees: number;
  originStationId: StationId;
  destinationStationId: StationId;
}
