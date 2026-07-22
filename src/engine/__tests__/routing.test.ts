import { describe, expect, it } from 'vitest';
import { findRoute, getStation, listStations } from '../graph';

describe('findRoute', () => {
  it('returns null for identical origin and destination', () => {
    expect(findRoute('rithala', 'rithala', 'fastest')).toBeNull();
  });

  it('returns null for an unknown station id', () => {
    expect(findRoute('not-a-real-station', 'rithala', 'fastest')).toBeNull();
  });

  it('returns null when either endpoint is an orphan (no known line in source data)', () => {
    expect(findRoute('bodaki', 'rithala', 'fastest')).toBeNull();
    expect(findRoute('rithala', 'shalimar-bagh-metro-station', 'fastest')).toBeNull();
  });

  it('finds a same-line adjacent-station route with zero interchanges matching the raw edge time', () => {
    const result = findRoute('ramesh-nagar', 'patel-nagar', 'fastest');
    expect(result).not.toBeNull();
    expect(result!.interchanges).toBe(0);
    expect(result!.totalTimeSeconds).toBe(387);
    expect(result!.legs).toHaveLength(1);
    expect(result!.legs[0].line).toBe('blue-line');
    expect(result!.legs[0].intermediateStations).toHaveLength(0);
  });

  it('routes through a merged single-node interchange (Kashmere Gate) correctly', () => {
    // Kashmere Gate is a single node serving red/yellow/violet -- no transfer
    // edge exists, the line just changes at that node.
    const result = findRoute('pratap-nagar', 'mandi-house', 'fastest');
    expect(result).not.toBeNull();
    expect(result!.interchanges).toBeGreaterThanOrEqual(1);
    const boardStations = result!.legs.map((l) => l.boardingStation.stationId);
    expect(boardStations).toContain('kashmere-gate');
  });

  it('routes through a split interchange (Hauz Khas: separate yellow/magenta platform nodes)', () => {
    const yellowOnlyStation = listStations().find(
      (s) => s.lines.length === 1 && s.lines[0] === 'yellow-line' && s.id !== 'hauz-khas',
    )!;
    const magentaOnlyStation = listStations().find(
      (s) => s.lines.length === 1 && s.lines[0] === 'magenta-line',
    )!;

    const result = findRoute(yellowOnlyStation.id, magentaOnlyStation.id, 'fastest');
    expect(result).not.toBeNull();
    expect(result!.interchanges).toBeGreaterThanOrEqual(1);

    // Hauz Khas should appear as a canonical alight/board boundary between a
    // yellow-line leg and a magenta-line leg (platforms collapse to one stop).
    const hauzKhasBoundary = result!.legs.some(
      (leg, i) =>
        leg.alightingStation.stationId === 'hauz-khas' &&
        result!.legs[i + 1]?.boardingStation.stationId === 'hauz-khas',
    );
    expect(hauzKhasBoundary).toBe(true);
  });

  it('min-interchange mode never returns more interchanges than fastest mode for the same pair', () => {
    const pairs: [string, string][] = [
      ['rithala', 'chirag-delhi'],
      ['dwarka-sector-21', 'vaishali'],
      ['sikanderpur', 'samaypur-badli'],
    ];
    for (const [a, b] of pairs) {
      if (!getStation(a) || !getStation(b)) continue;
      const fastest = findRoute(a, b, 'fastest');
      const minInterchange = findRoute(a, b, 'min-interchange');
      if (!fastest || !minInterchange) continue;
      expect(minInterchange.interchanges).toBeLessThanOrEqual(fastest.interchanges);
    }
  });

  it('fastest mode never takes longer than min-interchange mode for the same pair', () => {
    const fastest = findRoute('rithala', 'chirag-delhi', 'fastest')!;
    const minInterchange = findRoute('rithala', 'chirag-delhi', 'min-interchange')!;
    expect(fastest.totalTimeSeconds).toBeLessThanOrEqual(minInterchange.totalTimeSeconds);
  });

  it('reports a positive fare and distance for a real cross-city route', () => {
    const result = findRoute('rithala', 'chirag-delhi', 'fastest')!;
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.fareRupees).toBeGreaterThanOrEqual(10);
    expect(result.fareRupees).toBeLessThanOrEqual(60);
    expect(result.stationsPassed).toBeGreaterThan(result.legs.length);
  });
});
