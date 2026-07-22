/** Approximate DMRC-style distance-slab fare, in rupees. This is a slab
 * lookup on straight-line station-to-station distance (not exact published
 * fares, which vary by card type/time-of-day) -- adequate for an estimate,
 * not for ticketing. */
const FARE_SLABS_KM: { maxKm: number; fare: number }[] = [
  { maxKm: 2, fare: 10 },
  { maxKm: 5, fare: 20 },
  { maxKm: 12, fare: 30 },
  { maxKm: 21, fare: 40 },
  { maxKm: 32, fare: 50 },
];
const FARE_BEYOND_MAX_SLAB = 60;

export function estimateFareRupees(distanceMeters: number): number {
  const km = distanceMeters / 1000;
  for (const slab of FARE_SLABS_KM) {
    if (km <= slab.maxKm) return slab.fare;
  }
  return FARE_BEYOND_MAX_SLAB;
}
