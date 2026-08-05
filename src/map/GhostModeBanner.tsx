import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGhostModeStore } from '../sharing/ghostModeStore';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens } from '../theme/tokens';

/**
 * Says Ghost Mode is on, for as long as it is on.
 *
 * Shaped like `ConnectionBanner` and behaves like its opposite in the one way
 * that matters: that one waits before speaking and goes away on its own, this
 * one appears instantly and never leaves until the user acts. The difference
 * is who chose the state. A dropped connection is weather, and reporting it
 * early is noise; being invisible to everyone is a thing the user did, and
 * forgetting they did it is the whole failure mode of the feature.
 *
 * The map's toggle alone was not enough for that. It is a small round button
 * in a corner, in a state that lasts until it is undone -- and someone who has
 * forgotten they are hidden reads an empty map as their friends being offline,
 * which is exactly the wrong conclusion.
 */
export function GhostModeBanner() {
  const { colors, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none), [colors, radius]);

  const isGhost = useGhostModeStore((state) => state.isGhost);
  const setGhost = useGhostModeStore((state) => state.setGhost);

  if (!isGhost) return null;

  return (
    // The parent stack is `box-none`, so touches outside this reach the map.
    <View style={styles.banner}>
      <Ionicons name="eye-off" size={14} color={colors.onSurfaceVariant} />
      <Text style={styles.text}>Ghost Mode — you can't see friends, and they can't see you</Text>
      {/* One tap out, no confirmation. Going dark is a choice worth being
          deliberate about; coming back is not, and anything in the way of it is
          friction spent on the safe direction. */}
      <Pressable
        onPress={() => setGhost(false)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Turn off Ghost Mode"
        style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      >
        <Text style={styles.actionText}>Turn off</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ColorTokens, radiusNone: number) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radiusNone,
      backgroundColor: colors.surface,
      borderWidth: 1,
      // The one visual difference from the connection banner, and it is
      // carrying real weight: this state is the user's own doing, so the strip
      // is outlined in the full-strength colour rather than the hairline one
      // an ambient status gets.
      borderColor: colors.outline,
    },
    text: {
      flex: 1,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    action: {
      flexShrink: 0,
    },
    actionPressed: {
      opacity: 0.6,
    },
    actionText: {
      fontSize: 12,
      color: colors.textPrimary,
      fontWeight: '600',
    },
  });
}
