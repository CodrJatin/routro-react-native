import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from './ThemeProvider';

/** Style fragments reused verbatim across several screens/components --
 * spread into a component's own StyleSheet.create() rather than imported as
 * standalone style objects, so callers can still add/override fields. */
export function useSharedStyles() {
  const { colors, radius, typography } = useTheme();

  return useMemo(
    () =>
      StyleSheet.create({
        sectionLabel: {
          ...typography.labelCaps,
          color: colors.textSecondary,
        },
        textInput: {
          ...typography.bodyMd,
          backgroundColor: colors.surface,
          borderRadius: radius.none,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          color: colors.textPrimary,
        },
      }),
    [colors, radius, typography],
  );
}
