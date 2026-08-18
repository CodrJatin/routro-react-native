import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';
import { formatDiagnostics, getLogEntries } from './logBuffer';

/** How long the confirmation stays up. Long enough to read, short enough that
 * the row is back to its normal label before anyone looks again. */
const CONFIRM_MS = 2000;

/**
 * Copies the recent warnings and errors, with just enough build context to
 * make sense of them.
 *
 * The point is to turn "it stopped working on the metro" into something
 * actionable. Everything here is redacted on the way into the buffer (see
 * `logBuffer.ts`) rather than on the way out, so there is no path that
 * produces an unredacted copy.
 *
 * Deliberately not `__DEV__`-gated, unlike the panels below it in Settings: a
 * dev build is the one place this is *least* useful, since the console is
 * right there.
 */
export function CopyDiagnostics() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [didCopy, setDidCopy] = useState(false);

  async function handleCopy() {
    const text = formatDiagnostics({
      app: `Routro ${Constants.expoConfig?.version ?? 'unknown'}`,
      platform: `${Platform.OS} ${String(Platform.Version)}`,
      // Which JS bundle is actually running, which is the first thing worth
      // knowing about a report that does not match the current code.
      runtimeVersion: Updates.runtimeVersion,
      updateId: Updates.isEmbeddedLaunch ? 'embedded' : Updates.updateId,
      channel: Updates.channel,
      capturedAt: new Date().toISOString(),
    });
    await Clipboard.setStringAsync(text);
    setDidCopy(true);
    setTimeout(() => setDidCopy(false), CONFIRM_MS);
  }

  const count = getLogEntries().length;

  return (
    <Pressable style={styles.row} onPress={handleCopy} accessibilityRole="button">
      <View style={styles.label}>
        <Ionicons
          name={didCopy ? 'checkmark' : 'clipboard-outline'}
          size={16}
          color={didCopy ? colors.success : colors.textPrimary}
        />
        <Text style={styles.text}>{didCopy ? 'Copied' : 'Copy diagnostics'}</Text>
      </View>
      {/* The count is the honest version of what this does: it says plainly
          that there may be nothing to send, rather than implying a report was
          gathered when the session has been uneventful. */}
      <Text style={styles.value}>{count === 0 ? 'nothing logged' : `${count} entries`}</Text>
    </Pressable>
  );
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
    },
    label: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    text: {
      fontSize: 14,
      color: colors.textPrimary,
    },
    value: {
      fontSize: 13,
      color: colors.textSecondary,
    },
  });
}
