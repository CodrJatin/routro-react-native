import type { CompiledGraph, CompiledStation } from './types';

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface StationSearchIndex {
  search(query: string, limit?: number): CompiledStation[];
}

/** Offline prefix/substring matcher over station names. No fuzzy-matching
 * dependency needed at this dataset size (~280 stations). */
export function buildStationSearchIndex(graph: CompiledGraph): StationSearchIndex {
  const entries = Object.values(graph.stations)
    .filter((s) => !s.isOrphan)
    .map((station) => ({ station, normalizedName: normalize(station.name) }));

  return {
    search(query: string, limit = 10): CompiledStation[] {
      const q = normalize(query);
      if (!q) return [];

      const startsWith: CompiledStation[] = [];
      const wordStartsWith: CompiledStation[] = [];
      const contains: CompiledStation[] = [];

      for (const { station, normalizedName } of entries) {
        if (normalizedName.startsWith(q)) {
          startsWith.push(station);
        } else if (normalizedName.split(' ').some((w) => w.startsWith(q))) {
          wordStartsWith.push(station);
        } else if (normalizedName.includes(q)) {
          contains.push(station);
        }
      }

      return [...startsWith, ...wordStartsWith, ...contains].slice(0, limit);
    },
  };
}
