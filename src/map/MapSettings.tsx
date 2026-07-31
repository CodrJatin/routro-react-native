import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';
import { useBasemapStore } from './basemapStore';

/**
 * The map controls, in the same shape as `NotificationSettings`: a bordered
 * card of switch rows, with the dependent setting indented under the one it
 * depends on.
 *
 * Hydration is not triggered here. The root layout already hydrates this store
 * at launch, because the map screen needs the preference before Settings has
 * ever been opened.
 */
export function MapSettings() {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none), [colors, radius]);

  const isBasemapEnabled = useBasemapStore((state) => state.isEnabled);
  const setBasemapEnabled = useBasemapStore((state) => state.setEnabled);
  const arePlaceLabelsEnabled = useBasemapStore((state) => state.arePlaceLabelsEnabled);
  const setPlaceLabelsEnabled = useBasemapStore((state) => state.setPlaceLabelsEnabled);

  const trackColor = { false: colors.border, true: colors.accent };

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLabel}>
            <Ionicons
              name={isBasemapEnabled ? 'earth' : 'git-network-outline'}
              size={16}
              color={colors.textPrimary}
            />
            <View style={styles.rowLabelText}>
              <Text style={styles.rowTextStrong}>Real map</Text>
              <Text style={styles.rowHint}>
                Streets, water and landmarks under the metro lines. Loads over the internet.
              </Text>
            </View>
          </View>
          <Switch
            value={isBasemapEnabled}
            onValueChange={setBasemapEnabled}
            trackColor={trackColor}
            thumbColor={colors.onPrimary}
            ios_backgroundColor={colors.border}
          />
        </View>

        {/* Dimmed rather than hidden with the basemap off, matching the alert
            rows: the simple map has no place names to draw either way, and a
            row that vanishes is harder to find again than one that greys. */}
        <View style={[styles.row, styles.rowIndented, !isBasemapEnabled && styles.rowDisabled]}>
          <View style={styles.rowLabel}>
            <Ionicons name="text-outline" size={16} color={colors.textSecondary} />
            <View style={styles.rowLabelText}>
              <Text style={styles.rowText}>Place names</Text>
              <Text style={styles.rowHint}>
                Neighbourhoods and landmarks from the basemap.
              </Text>
            </View>
          </View>
          <Switch
            value={isBasemapEnabled && arePlaceLabelsEnabled}
            onValueChange={setPlaceLabelsEnabled}
            disabled={!isBasemapEnabled}
            trackColor={trackColor}
            thumbColor={colors.onPrimary}
            ios_backgroundColor={colors.border}
          />
        </View>
      </View>

      <Text style={styles.footnote}>
        Metro lines, station names and routing work with no internet connection either way.
      </Text>
    </>
  );
}

function createStyles(colors: ColorTokens, radiusNone: number) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowIndented: {
      paddingLeft: 22,
      backgroundColor: colors.surfaceContainerLow,
    },
    rowDisabled: {
      opacity: 0.45,
    },
    rowLabel: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    rowLabelText: {
      flex: 1,
      gap: 2,
    },
    rowTextStrong: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    rowText: {
      color: colors.textPrimary,
      fontSize: 14,
    },
    rowHint: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
    },
    footnote: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
  });
}
