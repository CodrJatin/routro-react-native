/**
 * Build-time graph compiler.
 *
 * Turns the raw OSM extract in /data into assets/data/metro-graph.json, the
 * single artifact the app bundles and loads offline. Raw data problems fixed
 * here (see /data analysis in project history):
 *
 *  1. 14 interchange stations are modeled as separate per-line nodes with no
 *     edge between them (e.g. "hauz-khas-yellow-line-" / "hauz-khas-magenta-line-").
 *     Left alone, this splits the network into 10 disconnected components.
 *     We group them by physical station and synthesize short transfer edges.
 *  2. After that merge, 3 components remain (Aqua Line/Noida spur, Rapid
 *     Metro Gurgaon spur, main network). Each pair's closest cross-component
 *     stations are real interchanges missing an edge in the source data
 *     (confirmed geographically: Noida Sector 51<->52 ~253m, Sikanderpur<->
 *     Sikanderpur RMRG ~144m). We stitch components whose closest pair is
 *     under STITCH_MAX_METERS, and refuse to guess beyond that threshold.
 *  3. Some edges have implausibly long ride times (probably collapsed
 *     intermediate stations in the source). These aren't fixed automatically
 *     -- they're just surfaced in the lint report for manual review.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type {
  CompiledEdge,
  CompiledGraph,
  CompiledStation,
  LintReport,
  RawGraph,
  RawLines,
  RawStations,
  StationId,
} from '../src/engine/types';

const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const OUT_PATH = resolve(ROOT, 'assets/data/metro-graph.json');

const TRANSFER_WALK_SECONDS = 150; // co-located platforms (same station complex)
const STITCH_MAX_METERS = 350; // ceiling for auto-stitching disconnected components
const WALK_SPEED_M_PER_S = 1.2;
const STITCH_BUFFER_SECONDS = 60;

const LONG_EDGE_THRESHOLD_SECONDS = 800;

// Suffix words the source data appends to split an interchange into per-line nodes.
const LINE_SUFFIX_WORDS = [
  'red',
  'yellow',
  'blue',
  'green',
  'violet',
  'pink',
  'magenta',
  'grey',
  'orange',
  'aqua',
];
const SPLIT_SUFFIX_RE = new RegExp(`-(${LINE_SUFFIX_WORDS.join('|')})-line-?$`);

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

function titleCaseBase(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function findConnectedComponents(
  nodeIds: string[],
  adjacency: Map<string, Set<string>>,
): Set<string>[] {
  const seen = new Set<string>();
  const components: Set<string>[] = [];
  for (const start of nodeIds) {
    if (seen.has(start)) continue;
    const component = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      component.add(node);
      for (const neighbor of adjacency.get(node) ?? []) stack.push(neighbor);
    }
    components.push(component);
  }
  return components;
}

function main() {
  const rawStations: RawStations = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'osm-stations.json'), 'utf-8'),
  );
  const rawGraph: RawGraph = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'osm-graph.json'), 'utf-8'),
  );
  const rawLines: RawLines = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'osm-lines.json'), 'utf-8'),
  );

  const lint: LintReport = {
    longEdges: [],
    mergedGroups: [],
    stitchedJunctions: [],
    invalidLineColors: [],
    orphanStations: [],
  };

  // --- detect orphan stations: zero edges AND no known line in source data.
  // These are real gaps in the scrape, not something we can safely infer an
  // edge for -- fabricating a connection would be guessing, not compiling.
  const edgeTargets = new Set<string>();
  for (const edges of Object.values(rawGraph)) for (const e of edges) edgeTargets.add(e.to);
  const orphanIds = new Set(
    Object.keys(rawStations).filter(
      (id) => (rawGraph[id]?.length ?? 0) === 0 && !edgeTargets.has(id),
    ),
  );
  lint.orphanStations = Array.from(orphanIds);

  // --- lint: invalid CSS colors (e.g. "#gray", "#aqua" are not valid hex) ---
  const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
  for (const line of Object.values(rawLines)) {
    if (!HEX_RE.test(line.color)) {
      lint.invalidLineColors.push({ lineId: line.id, field: 'color', value: line.color });
    }
    if (!HEX_RE.test(line.highlightColor)) {
      lint.invalidLineColors.push({
        lineId: line.id,
        field: 'highlightColor',
        value: line.highlightColor,
      });
    }
  }

  // --- lint: implausibly long ride edges ---
  for (const [from, edges] of Object.entries(rawGraph)) {
    for (const e of edges) {
      if (e.time_seconds > LONG_EDGE_THRESHOLD_SECONDS && from < e.to) {
        lint.longEdges.push({ from, to: e.to, time: e.time_seconds, line: e.line });
      }
    }
  }

  // --- group split interchange nodes by physical station ---
  const groups = new Map<string, StationId[]>();
  for (const id of Object.keys(rawStations)) {
    const match = SPLIT_SUFFIX_RE.test(id);
    const base = match ? id.replace(SPLIT_SUFFIX_RE, '') : id;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(id);
  }

  const nodeToStation: Record<StationId, StationId> = {};
  const stations: Record<StationId, CompiledStation> = {};

  for (const [base, platformIds] of groups) {
    const isSplit = platformIds.length > 1;
    const canonicalId = isSplit ? base : platformIds[0];
    const platforms = platformIds.map((id) => rawStations[id]);

    const lat = platforms.reduce((s, p) => s + p.lat, 0) / platforms.length;
    const lon = platforms.reduce((s, p) => s + p.lon, 0) / platforms.length;
    const lines = Array.from(new Set(platforms.flatMap((p) => p.lines)));
    const name = isSplit ? titleCaseBase(base) : platforms[0].name;

    stations[canonicalId] = {
      id: canonicalId,
      name,
      lat,
      lon,
      lines,
      platformIds,
      isOrphan: platformIds.every((id) => orphanIds.has(id)),
    };
    for (const id of platformIds) nodeToStation[id] = canonicalId;

    if (isSplit) {
      lint.mergedGroups.push({ canonicalId, platformIds });
    }
  }

  // --- build adjacency, copying raw ride edges ---
  const nodes: Record<StationId, CompiledEdge[]> = {};
  for (const id of Object.keys(rawStations)) nodes[id] = [];
  for (const [from, edges] of Object.entries(rawGraph)) {
    for (const e of edges) {
      nodes[from].push({ to: e.to, time: e.time_seconds, line: e.line, isTransfer: false });
    }
  }

  // --- synthesize transfer edges between platforms of the same split station ---
  for (const group of lint.mergedGroups) {
    const { platformIds } = group;
    for (let i = 0; i < platformIds.length; i++) {
      for (let j = i + 1; j < platformIds.length; j++) {
        const a = platformIds[i];
        const b = platformIds[j];
        nodes[a].push({ to: b, time: TRANSFER_WALK_SECONDS, line: null, isTransfer: true });
        nodes[b].push({ to: a, time: TRANSFER_WALK_SECONDS, line: null, isTransfer: true });
      }
    }
  }

  // --- stitch remaining disconnected components via nearest geo pair ---
  const adjacency = new Map<string, Set<string>>();
  for (const id of Object.keys(nodes)) adjacency.set(id, new Set());
  for (const [from, edges] of Object.entries(nodes)) {
    for (const e of edges) {
      adjacency.get(from)!.add(e.to);
      adjacency.get(e.to)?.add(from);
    }
  }

  const routableNodeIds = Object.keys(nodes).filter((id) => !orphanIds.has(id));
  let components = findConnectedComponents(routableNodeIds, adjacency);
  components.sort((a, b) => b.size - a.size);

  // Iteratively stitch the largest remaining gap until nothing is left within
  // range, merging the newly-joined component back into the main one each time.
  while (components.length > 1) {
    const main = components[0];
    let best: { dist: number; a: string; b: string; comp: Set<string> } | null = null;

    for (const comp of components.slice(1)) {
      for (const a of comp) {
        const sa = rawStations[a];
        for (const b of main) {
          const sb = rawStations[b];
          const dist = haversineMeters(sa.lat, sa.lon, sb.lat, sb.lon);
          if (!best || dist < best.dist) best = { dist, a, b, comp };
        }
      }
    }

    if (!best || best.dist > STITCH_MAX_METERS) {
      const remaining = components.slice(1).reduce((sum, c) => sum + c.size, 0);
      throw new Error(
        `Graph has ${components.length} disconnected components; ${remaining} node(s) ` +
          `could not be auto-stitched within ${STITCH_MAX_METERS}m. Nearest candidate was ` +
          `${best ? `${best.dist.toFixed(0)}m (${best.a} <-> ${best.b})` : 'none'}. ` +
          `Add a manual junction or raise STITCH_MAX_METERS deliberately.`,
      );
    }

    const time = Math.round(best.dist / WALK_SPEED_M_PER_S) + STITCH_BUFFER_SECONDS;
    nodes[best.a].push({ to: best.b, time, line: null, isTransfer: true });
    nodes[best.b].push({ to: best.a, time, line: null, isTransfer: true });
    lint.stitchedJunctions.push({ from: best.a, to: best.b, distanceMeters: best.dist, time });

    adjacency.get(best.a)!.add(best.b);
    adjacency.get(best.b)!.add(best.a);
    for (const n of best.comp) main.add(n);
    components = components.filter((c) => c !== best!.comp);
  }

  const compiled: CompiledGraph = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    nodes,
    stations,
    nodeToStation,
    lines: rawLines,
    lint,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(compiled));

  const totalEdges = Object.values(nodes).reduce((s, e) => s + e.length, 0);
  console.log(`Compiled graph -> ${OUT_PATH}`);
  console.log(`  stations (physical): ${Object.keys(stations).length}`);
  console.log(`  raw nodes (platforms): ${Object.keys(nodes).length}`);
  console.log(`  edges: ${totalEdges}`);
  console.log(`  merged interchange groups: ${lint.mergedGroups.length}`);
  console.log(`  stitched junctions: ${lint.stitchedJunctions.length}`);
  console.log(`  long-edge lint warnings: ${lint.longEdges.length}`);
  console.log(`  invalid line-color warnings: ${lint.invalidLineColors.length}`);
  console.log(`  final connected components: ${components.length} (must be 1)`);

  if (components.length !== 1) {
    throw new Error('Post-stitch graph is still disconnected -- this should be unreachable.');
  }
}

main();
