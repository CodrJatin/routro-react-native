import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SquareSwitch } from '../components/SquareSwitch';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';
import { useGhostModeStore } from './ghostModeStore';

/**
 * The whole of the Sharing section, now that there is only one decision left
 * in it.
 *
 * It replaced two switches -- one for location, one for the destination
 * attached to it -- and the merge was the point rather than a side effect. The
 * old pair asked the user to reason about a middle state where friends could
 * watch them cross the city but not learn where they were going, which the
 * dot already gives away by the third stop. One switch, one sentence, one
 * thing to remember having done.
 *
 * The map's own button is the one people will actually use. This exists
 * because Ghost Mode is app-wide, and a state that outlives the screen you set
 * it on should be findable somewhere other than that screen.
 */
export function GhostModeSettings() {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none), [colors, radius]);

  const isGhost = useGhostModeStore((state) => state.isGhost);
  const setGhost = useGhostModeStore((state) => state.setGhost);

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLabel}>
            <Ionicons
              name={isGhost ? 'eye-off' : 'eye-outline'}
              size={16}
              color={colors.textPrimary}
            />
            <View style={styles.rowLabelText}>
              <Text style={styles.rowTextStrong}>Ghost Mode</Text>
              <Text style={styles.rowHint}>
                Nothing goes out and nothing comes in: friends can't see where you are, and you
                can't see them. To them you look offline.
              </Text>
            </View>
          </View>
          <SquareSwitch
            value={isGhost}
            onValueChange={setGhost}
            accessibilityLabel="Ghost Mode"
          />
        </View>
      </View>

      <Text style={styles.footnote}>
        Otherwise Routro shares your location with your friends whenever the app is open, and for
        the whole of a journey you've started. Ghost Mode switches itself off when you close the
        app.
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
