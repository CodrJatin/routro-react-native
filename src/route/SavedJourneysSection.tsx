import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { RawLines } from '../engine/types';
import { useSharedStyles } from '../theme/sharedStyles';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { SavedJourneyCard } from './SavedJourneyCard';
import type { SavedJourney } from './savedJourneysStore';

export function SavedJourneysSection({
  journeys,
  lines,
  onOpen,
  onRemove,
}: {
  journeys: SavedJourney[];
  lines: RawLines;
  onOpen: (journey: SavedJourney) => void;
  onRemove: (id: string) => void;
}) {
  const { colors, typography } = useTheme();
  const shared = useSharedStyles();
  const styles = useMemo(() => createStyles(colors, typography, shared), [colors, typography, shared]);

  return (
    <Animated.View
      style={styles.section}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(220)}
    >
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Saved Journeys</Text>
        <Text style={styles.headerCount}>{journeys.length}</Text>
      </View>
      <View style={styles.list}>
        {journeys.map((journey) => (
          <Animated.View
            key={journey.id}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(140)}
            layout={LinearTransition.duration(220)}
          >
            <SavedJourneyCard journey={journey} lines={lines} onOpen={onOpen} onRemove={onRemove} />
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

function createStyles(
  colors: ColorTokens,
  typography: Record<string, TypeStyle>,
  shared: ReturnType<typeof useSharedStyles>,
) {
  return StyleSheet.create({
    section: {
      gap: 10,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    headerLabel: {
      ...shared.sectionLabel,
      flexShrink: 1,
    },
    headerCount: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    list: {
      gap: 10,
    },
  });
}
