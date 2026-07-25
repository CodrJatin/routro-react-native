import { listStations } from '../engine/graph';
import { haversineMeters } from '../engine/geo';
import type { LineId } from '../engine/types';

export interface NearestStation {
  name: string;
  distanceMeters: number;
  lines: LineId[];
}

export function findNearestStation(lat: number, lon: number): NearestStation | null {
  let best: NearestStation | null = null;
  for (const station of listStations()) {
    const distanceMeters = haversineMeters(lat, lon, station.lat, station.lon);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { name: station.name, distanceMeters, lines: station.lines };
    }
  }
  return best;
}
