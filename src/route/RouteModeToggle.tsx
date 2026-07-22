import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RouteMode } from '../engine/types';
import { colors } from '../theme/colors';

const OPTIONS: { mode: RouteMode; label: string }[] = [
  { mode: 'fastest', label: 'Fastest Route' },
  { mode: 'min-interchange', label: 'Min. Interchange' },
];

export function RouteModeToggle({
  mode,
  onChange,
}: {
  mode: RouteMode;
  onChange: (mode: RouteMode) => void;
}) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((option) => {
        const active = option.mode === mode;
        return (
          <Pressable
            key={option.mode}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(option.mode)}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.accent,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
});
