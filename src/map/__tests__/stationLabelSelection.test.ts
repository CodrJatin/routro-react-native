import { describe, expect, it } from 'vitest';
import { listStations } from '../../engine/graph';
import {
  MAX_STATION_LABELS,
  STATION_LABEL_MIN_ZOOM,
  selectLabelledStations,
} from '../stationLabelSelection';

/** Everything, so zoom and the cap are what's under test rather than the
 * viewport filter. */
const WHOLE_NETWORK: [number, number, number, number] = [-180, -85, 180, 85];

const isInterchange = (station: { lines: string[] }) => station.lines.length > 1;

describe('station label selection', () => {
  it('draws nothing when zoomed out past the threshold', () => {
    expect(
      selectLabelledStations({ zoom: STATION_LABEL_MIN_ZOOM - 0.1, bounds: WHOLE_NETWORK }),
    ).toEqual([]);
  });

  it('labels interchange and ordinary stations alike once at the threshold', () => {
    // A realistic viewport rather than the whole network: over the cap, the
    // ordinary stations are exactly what gets dropped.
    const ordinary = listStations().find((station) => !isInterchange(station))!;
    const margin = 0.005;
    const bounds: [number, number, number, number] = [
      ordinary.lon - margin,
      ordinary.lat - margin,
      ordinary.lon + margin,
      ordinary.lat + margin,
    ];

    expect(selectLabelledStations({ zoom: STATION_LABEL_MIN_ZOOM, bounds })).toContainEqual(
      ordinary,
    );
    // ...and it is only the threshold keeping it off the map just below that.
    expect(
      selectLabelledStations({ zoom: STATION_LABEL_MIN_ZOOM - 0.1, bounds }),
    ).not.toContainEqual(ordinary);
  });

  it('leaves out stations outside the viewport', () => {
    const [first] = listStations();
    const margin = 0.002;
    const labelled = selectLabelledStations({
      zoom: 15,
      bounds: [first.lon - margin, first.lat - margin, first.lon + margin, first.lat + margin],
    });

    expect(labelled).toContainEqual(first);
    // A ~200m box around one station cannot hold the whole network.
    expect(labelled.length).toBeLessThan(listStations().length);
  });

  it('caps the count, keeping interchanges over ordinary stations', () => {
    // The whole network at full zoom is the pathological case the cap exists
    // for -- far more stations than a real viewport ever holds.
    const labelled = selectLabelledStations({ zoom: 18, bounds: WHOLE_NETWORK });
    const allInterchanges = listStations().filter(isInterchange);

    expect(listStations().length).toBeGreaterThan(MAX_STATION_LABELS);
    expect(labelled).toHaveLength(MAX_STATION_LABELS);
    expect(labelled.filter(isInterchange)).toHaveLength(
      Math.min(allInterchanges.length, MAX_STATION_LABELS),
    );
  });
});
