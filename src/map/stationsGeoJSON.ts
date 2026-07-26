import { listStations } from '../engine/graph';
import type { CompiledStation, StationId } from '../engine/types';

export interface StationFeatureProperties {
  id: string;
  name: string;
  isInterchange: boolean;
}

type StationCollection = GeoJSON.FeatureCollection<GeoJSON.Point, StationFeatureProperties>;

export function buildStationsGeoJSON(): StationCollection {
  return collect(listStations());
}

/** The same features for a subset of stations, so a second layer can restyle
 * exactly those (stations already behind you on the active route) without the
 * base layer -- or its tap handling -- being rebuilt. */
export function buildStationSubsetGeoJSON(ids: ReadonlySet<StationId>): StationCollection {
  return collect(listStations().filter((station) => ids.has(station.id)));
}

function collect(stations: CompiledStation[]): StationCollection {
  return {
    type: 'FeatureCollection',
    features: stations.map((station) => ({
      type: 'Feature',
      properties: {
        id: station.id,
        name: station.name,
        isInterchange: station.lines.length > 1,
      },
      geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
    })),
  };
}

