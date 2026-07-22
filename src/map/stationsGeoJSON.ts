import { listStations } from '../engine/graph';

export interface StationFeatureProperties {
  id: string;
  name: string;
  isInterchange: boolean;
}

export function buildStationsGeoJSON(): GeoJSON.FeatureCollection<GeoJSON.Point, StationFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: listStations().map((station) => ({
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

