import { SegmentedToggle } from '../components/SegmentedToggle';
import type { RouteMode } from '../engine/types';

const OPTIONS: { value: RouteMode; label: string }[] = [
  { value: 'fastest', label: 'Fastest Route' },
  { value: 'min-interchange', label: 'Min. Interchange' },
];

export function RouteModeToggle({
  mode,
  onChange,
}: {
  mode: RouteMode;
  onChange: (mode: RouteMode) => void;
}) {
  return <SegmentedToggle options={OPTIONS} value={mode} onChange={onChange} />;
}
