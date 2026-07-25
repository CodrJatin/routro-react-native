import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { forwardRef, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getCompiledGraph } from '../engine/graph';
import type { CompiledStation } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

interface Props {
  station: CompiledStation | null;
  onClose: () => void;
}

export const StationDetailSheet = forwardRef<BottomSheet, Props>(function StationDetailSheet(
  { station, onClose },
  ref,
) {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none), [colors, radius]);
  const lines = getCompiledGraph().lines;
  const lineChips = useMemo(
    () => station?.lines.map((lineId) => lines[lineId]).filter(Boolean) ?? [],
    [station, lines],
  );

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={['32%']}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        {station && (
          <>
            <Text style={styles.name}>{station.name}</Text>
            {lineChips.length > 1 && <Text style={styles.interchangeBadge}>Interchange Station</Text>}
            <View style={styles.chipRow}>
              {lineChips.map((line) => (
                <View key={line.id} style={styles.chip}>
                  <View style={[styles.chipDot, { backgroundColor: line.color }]} />
                  <Text style={styles.chipText}>{line.name}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
});

function createStyles(colors: ColorTokens, radiusNone: number) {
  return StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surfaceElevated,
    },
    handleIndicator: {
      backgroundColor: colors.border,
    },
    content: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 8,
      gap: 12,
    },
    name: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '700',
    },
    interchangeBadge: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radiusNone,
      paddingVertical: 6,
      paddingHorizontal: 12,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    chipText: {
      color: colors.textPrimary,
      fontSize: 13,
    },
  });
}
