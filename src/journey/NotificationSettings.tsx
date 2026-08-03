import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SquareSwitch } from '../components/SquareSwitch';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';
import {
  useNotificationPrefsStore,
  type NotificationPrefs,
} from './notificationPrefs';

interface ToggleRow {
  key: keyof NotificationPrefs;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
}

/** Ordered by how much they matter on a journey: the one worth being
 * interrupted for sits at the top. */
const ALERT_ROWS: ToggleRow[] = [
  {
    key: 'alighting',
    icon: 'exit-outline',
    label: 'Getting off',
    hint: 'When your stop is next, and when you arrive.',
  },
  {
    key: 'interchange',
    icon: 'git-compare-outline',
    label: 'Line changes',
    hint: 'When to change lines, and one stop before.',
  },
  {
    key: 'friends',
    icon: 'people-outline',
    label: 'Friends nearby',
    hint: 'When a friend who is sharing comes within two stops, or reaches where you are, where you are going, or where you are meeting them.',
  },
  {
    key: 'meets',
    icon: 'hand-left-outline',
    label: 'Meet requests',
    hint: 'When a friend asks to meet you at a station, and when they answer yours.',
  },
];

/**
 * The notification controls, in the shape the rest of Settings already uses:
 * a flat bordered card of rows, not a bespoke panel.
 *
 * The ongoing journey notification isn't listed. Android requires a foreground
 * service to post one, so it is not ours to switch off -- and it is also the
 * only way to see that tracking is running at all.
 */
export function NotificationSettings() {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none), [colors, radius]);

  const prefs = useNotificationPrefsStore();
  const setPref = useNotificationPrefsStore((state) => state.setPref);
  const hydrate = useNotificationPrefsStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowLabel}>
            <Ionicons
              name={prefs.enabled ? 'notifications' : 'notifications-off-outline'}
              size={16}
              color={colors.textPrimary}
            />
            <Text style={styles.rowTextStrong}>All alerts</Text>
          </View>
          <SquareSwitch
            value={prefs.enabled}
            onValueChange={(value) => setPref('enabled', value)}
            accessibilityLabel="All alerts"
          />
        </View>

        {ALERT_ROWS.map((row) => (
          <View
            key={row.key}
            // Dimmed rather than hidden when the master is off: the user can
            // still see what they have chosen, and it comes back untouched.
            style={[styles.row, styles.rowIndented, !prefs.enabled && styles.rowDisabled]}
          >
            <View style={styles.rowLabel}>
              <Ionicons name={row.icon} size={16} color={colors.textSecondary} />
              <View style={styles.rowLabelText}>
                <Text style={styles.rowText}>{row.label}</Text>
                <Text style={styles.rowHint}>{row.hint}</Text>
              </View>
            </View>
            <SquareSwitch
              value={prefs.enabled && Boolean(prefs[row.key])}
              onValueChange={(value) => setPref(row.key, value)}
              disabled={!prefs.enabled}
              accessibilityLabel={row.label}
            />
          </View>
        ))}
      </View>
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
    // The sub-toggles read as belonging to the master above them rather than
    // as four equal siblings.
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
  });
}
