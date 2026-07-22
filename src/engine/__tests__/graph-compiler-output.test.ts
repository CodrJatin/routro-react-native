import { describe, expect, it } from 'vitest';
import { getCompiledGraph } from '../graph';

describe('compiled graph invariants', () => {
  const graph = getCompiledGraph();

  it('has no invalid line colors left unflagged (regression: #gray/#aqua source bug)', () => {
    // The compiler must have caught these -- we assert the lint report knows
    // about them, not that they were auto-fixed (they weren't; source data
    // needs a real color, not a guess).
    const flaggedFields = graph.lint.invalidLineColors.map((c) => `${c.lineId}.${c.field}`);
    expect(flaggedFields).toContain('rapid-metrorail-gurgaon-s55-sikandarpur.highlightColor');
    expect(flaggedFields).toContain('aqua-line-noida-sector-51-depot.highlightColor');
  });

  it('routable network (excluding known data-gap orphans) is a single connected component', () => {
    const routableIds = Object.keys(graph.nodes).filter((id) => {
      const stationId = graph.nodeToStation[id];
      return !graph.stations[stationId]?.isOrphan;
    });

    const adjacency = new Map<string, Set<string>>();
    for (const id of routableIds) adjacency.set(id, new Set());
    for (const [from, edges] of Object.entries(graph.nodes)) {
      if (!adjacency.has(from)) continue;
      for (const e of edges) {
        if (!adjacency.has(e.to)) continue;
        adjacency.get(from)!.add(e.to);
        adjacency.get(e.to)!.add(from);
      }
    }

    const start = routableIds[0];
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const neighbor of adjacency.get(n) ?? []) stack.push(neighbor);
    }

    const unreached = routableIds.filter((id) => !seen.has(id));
    expect(unreached).toEqual([]);
  });

  it('records exactly the 6 known data-gap orphan stations', () => {
    expect(graph.lint.orphanStations.sort()).toEqual(
      [
        'bodaki',
        'junpat-village',
        'noida-office',
        'noida-sector-44',
        'noida-sector-70',
        'shalimar-bagh-metro-station',
      ].sort(),
    );
  });

  it('merges every split interchange group into one canonical station with >1 platform', () => {
    expect(graph.lint.mergedGroups.length).toBeGreaterThanOrEqual(12);
    for (const group of graph.lint.mergedGroups) {
      const station = graph.stations[group.canonicalId];
      expect(station).toBeDefined();
      expect(station.platformIds.length).toBe(group.platformIds.length);
      expect(station.platformIds.length).toBeGreaterThan(1);
    }
  });

  it('stitches the Aqua Line and Rapid Metro Gurgaon spurs at real geographic junctions', () => {
    const pairs = graph.lint.stitchedJunctions.map((j) => [j.from, j.to].sort().join('|'));
    expect(pairs).toContain(['noida-sector-51', 'noida-sector-52'].sort().join('|'));
    expect(pairs).toContain(['sikanderpur', 'sikanderpur-rmrg-station'].sort().join('|'));
    for (const j of graph.lint.stitchedJunctions) {
      expect(j.distanceMeters).toBeLessThan(350);
    }
  });
});
