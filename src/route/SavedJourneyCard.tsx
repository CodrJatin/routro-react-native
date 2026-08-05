import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { isJourneyServiceAvailable } from '../../modules/journey-service';
import { findRoute } from '../engine/graph';
import type { RawLines } from '../engine/types';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useJourneyStore } from '../journey/journeyStore';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import type { SavedJourney } from './savedJourneysStore';

const MARKER_SIZE = 10;
const MAX_SWATCHES = 4;

export function SavedJourneyCard({
  journey,
  lines,
  onOpen,
  onStart,
  onRemove,
}: {
  journey: SavedJourney;
  lines: RawLines;
  onOpen: (journey: SavedJourney) => void;
  /** Begins this journey outright, rather than loading it into the planner for
   * the user to start from there. The card keeps both: tapping it still opens
   * the route to look at, which is what you want for a trip you haven't
   * decided on yet. */
  onStart: (journey: SavedJourney) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius, typography), [colors, radius, typography]);
  const [isStarting, setIsStarting] = useState(false);

  // Recomputed rather than snapshotted at save time, so a saved journey always
  // reflects the current graph instead of showing stale times/fares.
  const route = useMemo(
    () => findRoute(journey.originId, journey.destinationId, 'fastest'),
    [journey.originId, journey.destinationId],
  );

  // Hidden while this exact trip is the one being followed -- the live journey
  // card above already owns it, and a second "Start" for a journey already
  // running is an offer with nothing behind it. The reverse direction keeps
  // its button: that is a different trip.
  const isFollowingThis = useJourneyStore(
    (state) =>
      state.session?.originId === journey.originId &&
      state.session?.destinationId === journey.destinationId,
  );
  const canStart = isJourneyServiceAvailable && !!route && !isFollowingThis;

  async function handleStart() {
    if (isStarting) return;
    setIsStarting(true);
    try {
      await onStart(journey);
    } finally {
      setIsStarting(false);
    }
  }

  const swatchColors = route
    ? route.legs.slice(0, MAX_SWATCHES).map((leg) => lines[leg.line]?.color ?? colors.outline)
    : [];
  const overflowCount = route ? Math.max(0, route.legs.length - MAX_SWATCHES) : 0;

  return (
    <AnimatedPressable
      style={styles.card}
      onPress={() => onOpen(journey)}
      accessibilityRole="button"
      accessibilityLabel={`Plan ${journey.originName} to ${journey.destinationName}`}
    >
      <View style={styles.topRow}>
        <View style={styles.path}>
          <View style={styles.pathRow}>
            <View style={styles.originMarker} />
            <Text style={styles.stationName} numberOfLines={1} ellipsizeMode="tail">
              {journey.originName}
            </Text>
          </View>
          <View style={styles.connector} />
          <View style={styles.pathRow}>
            <View style={styles.destinationMarker} />
            <Text style={styles.stationName} numberOfLines={1} ellipsizeMode="tail">
              {journey.destinationName}
            </Text>
          </View>
        </View>

        <AnimatedPressable
          style={styles.removeButton}
          onPress={() => onRemove(journey.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove saved journey ${journey.originName} to ${journey.destinationName}`}
        >
          <Ionicons name="close" size={15} color={colors.textSecondary} />
        </AnimatedPressable>
      </View>

      <View style={styles.metaRow}>
        {swatchColors.length > 0 && (
          <View style={styles.swatchRow}>
            {swatchColors.map((color, index) => (
              <View key={index} style={[styles.swatch, { backgroundColor: color }]} />
            ))}
            {overflowCount > 0 && <Text style={styles.metaText}>+{overflowCount}</Text>}
          </View>
        )}
        <Text style={styles.metaText} numberOfLines={1}>
          {route ? formatOverview(route.totalTimeSeconds, route.fareRupees, route.legs.length - 1) : 'ROUTE UNAVAILABLE'}
        </Text>

        {/* Down here rather than beside the remove button at the top: the two
            would be a primary action and a destructive one a thumb's width
            apart, on a card people tap in a moving train. */}
        {canStart && (
          <AnimatedPressable
            style={styles.startButton}
            onPress={handleStart}
            disabled={isStarting}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Start journey from ${journey.originName} to ${journey.destinationName}`}
          >
            {isStarting ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <>
                <Ionicons name="navigate" size={12} color={colors.onPrimary} />
                <Text style={styles.startText}>START</Text>
              </>
            )}
          </AnimatedPressable>
        )}
      </View>
    </AnimatedPressable>
  );
}

function formatOverview(totalSeconds: number, fareRupees: number, changes: number): string {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  const changeText = changes === 0 ? 'DIRECT' : `${changes} CHANGE${changes === 1 ? '' : 'S'}`;
  return `${minutes} MIN · ₹${fareRupees} · ${changeText}`;
}

function createStyles(
  colors: ColorTokens,
  radius: { none: number; badge: number },
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: radius.none,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      gap: 10,
    },
    cardPressed: {
      backgroundColor: colors.surfaceContainer,
      borderColor: colors.outline,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    path: {
      // minWidth:0 lets the names actually truncate instead of forcing the row
      // wider than the card once a station name gets long.
      flex: 1,
      minWidth: 0,
    },
    pathRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    originMarker: {
      width: MARKER_SIZE,
      height: MARKER_SIZE,
      borderRadius: MARKER_SIZE / 2,
      borderWidth: 2,
      borderColor: colors.textPrimary,
    },
    destinationMarker: {
      width: MARKER_SIZE,
      height: MARKER_SIZE,
      borderRadius: radius.none,
      backgroundColor: colors.textPrimary,
    },
    connector: {
      width: 2,
      height: 10,
      marginLeft: MARKER_SIZE / 2 - 1,
      backgroundColor: colors.border,
    },
    stationName: {
      ...typography.headlineMd,
      fontSize: 15,
      lineHeight: 20,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    removeButton: {
      width: 28,
      height: 28,
      borderRadius: radius.none,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeButtonPressed: {
      opacity: 0.6,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 9,
    },
    swatchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    swatch: {
      width: 8,
      height: 8,
      borderRadius: radius.none,
    },
    // flex rather than flexShrink, so the overview takes the row's free width
    // and pins the start button to the right edge instead of letting it float
    // in beside a short summary.
    metaText: {
      ...typography.dataSm,
      color: colors.textSecondary,
      flex: 1,
      minWidth: 0,
    },
    startButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      // Enough to hold the spinner without the row changing height when the
      // label swaps out for it mid-press.
      minWidth: 66,
      height: 26,
      paddingHorizontal: 10,
      borderRadius: radius.none,
      backgroundColor: colors.accent,
      flexShrink: 0,
    },
    startText: {
      ...typography.dataSm,
      color: colors.onPrimary,
      fontWeight: '700',
    },
  });
}
