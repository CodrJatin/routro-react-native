import { listStations } from '../engine/graph';
import type { CompiledStation } from '../engine/types';

/** Below this every station stays an unlabelled dot -- at Delhi's station
 * spacing, labelling them any further out is an unreadable mat of overlapping
 * text rather than information. Interchanges get no head start; they're told
 * apart by the bold label style in StationLabels.tsx instead. */
export const STATION_LABEL_MIN_ZOOM = 12;

/** Hard ceiling on labels drawn at once. Each one is a real React Native view
 * (see StationLabels.tsx for why), so an unbounded count is a frame-rate
 * problem. The viewport filter already keeps the usual number well under this;
 * this only catches the pathological case -- a very wide, very tall viewport
 * that still clears the zoom threshold. */
export const MAX_STATION_LABELS = 60;

export interface LabelViewport {
  zoom: number;
  /** [west, south, east, north], as MapLibre reports it. */
  bounds: [number, number, number, number];
}

/**
 * The stations whose names should be drawn for the current viewport.
 *
 * Kept out of the component (and off any MapLibre import) so the zoom
 * thresholds and the cap can be tested directly.
 */
export function selectLabelledStations({ zoom, bounds }: LabelViewport): CompiledStation[] {
  if (zoom < STATION_LABEL_MIN_ZOOM) return [];

  const [west, south, east, north] = bounds;

  const visible = listStations().filter(
    (station) =>
      station.lon >= west && station.lon <= east && station.lat >= south && station.lat <= north,
  );

  if (visible.length <= MAX_STATION_LABELS) return visible;

  // Over the cap, interchanges are what survives -- dropping the stations a
  // rider uses to change lines would be the worst possible truncation.
  // Otherwise the order is the graph's own, which is stable across renders, so
  // a label doesn't flicker in and out between two frames of the same view.
  return visible
    .slice()
    .sort((a, b) => Number(b.lines.length > 1) - Number(a.lines.length > 1))
    .slice(0, MAX_STATION_LABELS);
}
