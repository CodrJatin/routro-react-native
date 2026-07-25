import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.canvas,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 8,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '600',
    },
    note: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },
  });
}
