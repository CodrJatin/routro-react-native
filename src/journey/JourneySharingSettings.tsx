import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SquareSwitch } from '../components/SquareSwitch';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';
import { useJourneySharingStore } from './journeySharingPrefs';

/**
 * The one control over how much of a journey friends see.
 *
 * Off does not stop location sharing -- friends still see the live dot, they
 * just stop seeing where it is going. That distinction is the whole reason this
 * switch exists, so the hint says it in as many words rather than leaving the
 * user to infer which of the two they are turning off.
 *
 * Shaped like the notification card next to it: a bordered row, not a panel.
 */
export function JourneySharingSettings() {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none), [colors, radius]);

  const shareJourney = useJourneySharingStore((state) => state.shareJourney);
  const setShareJourney = useJourneySharingStore((state) => state.setShareJourney);
  const hydrate = useJourneySharingStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLabel}>
            <Ionicons
              name={shareJourney ? 'navigate' : 'navigate-outline'}
              size={16}
              color={colors.textPrimary}
            />
            <View style={styles.rowLabelText}>
              <Text style={styles.rowTextStrong}>Share where you're going</Text>
              <Text style={styles.rowHint}>
                Friends you are sharing your location with can see your destination and route, and
                when you reach each stop.
              </Text>
            </View>
          </View>
          <SquareSwitch
            value={shareJourney}
            onValueChange={setShareJourney}
            accessibilityLabel="Share where you're going"
          />
        </View>
      </View>

      <Text style={styles.footnote}>
        Only while you are sharing your location and following a journey. Turning location sharing
        off hides your destination too.
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
