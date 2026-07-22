import { StyleSheet } from 'react-native';
import { colors } from './colors';

/** Style fragments reused verbatim across several screens/components --
 * spread into a component's own StyleSheet.create() rather than imported as
 * standalone style objects, so callers can still add/override fields. */
export const shared = StyleSheet.create({
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
  },
});
