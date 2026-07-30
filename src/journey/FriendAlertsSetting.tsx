import { useEffect } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useFriendAlertsStore } from './friendAlerts';

/**
 * The one user-facing control for friend alerts.
 *
 * Off by default and kept out of the journey flow deliberately: a journey
 * already interrupts for getting off and changing lines, and stacking
 * unrequested alerts about other people on top is how someone ends up
 * switching MetroSync's notifications off entirely -- taking the "get off at
 * the next stop" alert with them.
 */
export function FriendAlertsSetting() {
  const { colors } = useTheme();
  const isEnabled = useFriendAlertsStore((state) => state.isEnabled);
  const setEnabled = useFriendAlertsStore((state) => state.setEnabled);
  const hydrate = useFriendAlertsStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const styles = createStyles(colors.surface, colors.border, colors.textPrimary, colors.textSecondary);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.label}>Alert me about friends</Text>
        <Switch value={isEnabled} onValueChange={setEnabled} />
      </View>
      <Text style={styles.hint}>
        While you are following a journey, get a notification when a friend who is sharing comes
        within two stops, or arrives at a station.
      </Text>
    </View>
  );
}

function createStyles(surface: string, border: string, textPrimary: string, textSecondary: string) {
  return StyleSheet.create({
    card: {
      backgroundColor: surface,
      borderWidth: 1,
      borderColor: border,
      padding: 14,
      gap: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    label: {
      flex: 1,
      color: textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    hint: {
      color: textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
  });
}
