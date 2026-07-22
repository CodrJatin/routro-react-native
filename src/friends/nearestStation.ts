import { listStations } from '../engine/graph';
import { haversineMeters } from '../engine/geo';

export interface NearestStation {
  name: string;
  distanceMeters: number;
}

export function findNearestStation(lat: number, lon: number): NearestStation | null {
  let best: NearestStation | null = null;
  for (const station of listStations()) {
    const distanceMeters = haversineMeters(lat, lon, station.lat, station.lon);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { name: station.name, distanceMeters };
    }
  }
  return best;
}
