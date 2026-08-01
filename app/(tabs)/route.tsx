import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { findRoute, getCompiledGraph, getStation } from '../../src/engine/graph';
import { isJourneyServiceAvailable } from '../../modules/journey-service';
import { useIsJourneyActive } from '../../src/journey/journeyStore';
import { LiveJourneySection } from '../../src/journey/LiveJourneySection';
import { StartJourneyButton } from '../../src/journey/StartJourneyButton';
import { useSelfPositionStore } from '../../src/location/selfPosition';
import { useSeedSelfPosition } from '../../src/location/useSeedSelfPosition';
import type { CompiledStation, RouteMode, RouteResult } from '../../src/engine/types';
import { useActiveRouteStore } from '../../src/route/activeRouteStore';
import { ItineraryList } from '../../src/route/ItineraryList';
import { RouteModeToggle } from '../../src/route/RouteModeToggle';
import { getRouteProgress } from '../../src/route/routeProgress';
import { useRouteClock } from '../../src/route/useRouteClock';
import { RouteSummaryCard } from '../../src/route/RouteSummaryCard';
import { SavedJourneysSection } from '../../src/route/SavedJourneysSection';
import { useIsJourneySaved, useSavedJourneysStore, type SavedJourney } from '../../src/route/savedJourneysStore';
import { StationAutocompleteInput } from '../../src/route/StationAutocompleteInput';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../../src/theme/tokens';

export default function RouteScreen() {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius.none, typography), [colors, radius, typography]);
  const router = useRouter();
  const [origin, setOrigin] = useState<CompiledStation | null>(null);
  const [destination, setDestination] = useState<CompiledStation | null>(null);
  const [mode, setMode] = useState<RouteMode>('fastest');

  const sameStation = !!origin && !!destination && origin.id === destination.id;

  // Computed for both modes (rather than just the selected one) so we can
  // tell whether they actually disagree -- if not, the toggle has nothing
  // meaningful to offer and stays hidden.
  const fastestRoute = useMemo(() => {
    if (!origin || !destination || sameStation) return null;
    return findRoute(origin.id, destination.id, 'fastest');
  }, [origin, destination, sameStation]);

  const minInterchangeRoute = useMemo(() => {
    if (!origin || !destination || sameStation) return null;
    return findRoute(origin.id, destination.id, 'min-interchange');
  }, [origin, destination, sameStation]);

  const modesMatch =
    !!fastestRoute && !!minInterchangeRoute && routeSignature(fastestRoute) === routeSignature(minInterchangeRoute);

  const route = mode === 'fastest' ? fastestRoute : minInterchangeRoute;

  // Published to the map as soon as there's a route to publish, rather than
  // on "Go to map" -- the map keeps the highlight and the station arrival
  // times in sync with whatever is on screen here, including a mode switch or
  // a swap, and drops them when the planner has no route.
  const setActiveRoute = useActiveRouteStore((state) => state.setActiveRoute);
  const clearActiveRoute = useActiveRouteStore((state) => state.clear);
  useEffect(() => {
    if (!route || !origin || !destination) {
      clearActiveRoute();
      return;
    }
    setActiveRoute(origin.id, destination.id, mode);
  }, [route, origin, destination, mode, setActiveRoute, clearActiveRoute]);

  // No GPS watcher of its own: the map screen owns the only one, and this
  // reads whatever it (or the OS's last-known cache) has put in the shared
  // store. Null position simply means no progress is shown.
  useSeedSelfPosition();
  const selfPosition = useSelfPositionStore((state) => state.position);
  const progress = useMemo(() => getRouteProgress(route, selfPosition), [route, selfPosition]);

  // Arrival times are measured from where the user actually is whenever
  // progress resolves, and from "leaving now" otherwise -- so a journey
  // already half done stops quoting the times you'd have hit by starting it
  // over. See useRouteClock for what each mode costs.
  const clock = useRouteClock(route, progress);

  const lines = useMemo(() => getCompiledGraph().lines, []);

  // The rail joining the two fields goes live once both ends are chosen --
  // the planner holds a journey at that point, and the card says so before the
  // result below it has finished animating in.
  const railColor = origin && destination ? colors.accent : colors.outlineVariant;

  const savedJourneys = useSavedJourneysStore((state) => state.journeys);
  const hydrateSavedJourneys = useSavedJourneysStore((state) => state.hydrate);
  const removeSavedJourney = useSavedJourneysStore((state) => state.remove);
  const toggleSavedJourney = useSavedJourneysStore((state) => state.toggle);
  const isCurrentSaved = useIsJourneySaved(origin?.id, destination?.id);
  // A live journey card fills the slot the empty state would have taken --
  // "choose an origin and destination" is poor advice while one is running.
  const isJourneyActive = useIsJourneyActive();

  useEffect(() => {
    hydrateSavedJourneys();
  }, [hydrateSavedJourneys]);

  function handleSwap() {
    setOrigin(destination);
    setDestination(origin);
  }

  function handleClearAll() {
    setOrigin(null);
    setDestination(null);
  }

  function handleGoToMap() {
    if (!origin || !destination) return;
    // The map already has the route; all this button still owes the user is
    // the camera framed on it -- including when they've panned away from a
    // route that hasn't changed since.
    useActiveRouteStore.getState().requestFit();
    // navigate, not push: pushing a tab route stacks a second instance of
    // the map instead of switching to the existing one.
    router.navigate('/(tabs)');
  }

  function handleToggleSave() {
    if (!origin || !destination) return;
    toggleSavedJourney(origin, destination);
  }

  function handleOpenLive(
    liveOrigin: CompiledStation,
    liveDestination: CompiledStation,
    liveMode: RouteMode,
  ) {
    setOrigin(liveOrigin);
    setDestination(liveDestination);
    // The mode too, or the itinerary that comes back could be a different path
    // from the one actually being followed in the background.
    setMode(liveMode);
  }

  function handleOpenSaved(journey: SavedJourney) {
    // Resolved against the live graph rather than trusting the stored names --
    // a recompiled graph could have renamed or dropped a station.
    const savedOrigin = getStation(journey.originId);
    const savedDestination = getStation(journey.destinationId);
    if (!savedOrigin || !savedDestination) return;
    setOrigin(savedOrigin);
    setDestination(savedDestination);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>Plan Your Route</Text>
          {(origin || destination) && (
            <Pressable
              onPress={handleClearAll}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear origin and destination"
            >
              <Text style={styles.clearAllText}>Clear</Text>
            </Pressable>
          )}
        </View>

        {/* One card, one rail: the two fields are the ends of a journey rather
            than two unrelated text boxes, and the swap button is a square
            attached to the side of them -- the same wide-block-plus-square
            pairing the summary card's actions use. */}
        <View style={styles.plannerCard}>
          <View style={styles.plannerFields}>
            <StationAutocompleteInput
              label="From"
              placeholder="Origin station"
              selectedStation={origin}
              onSelect={setOrigin}
              onClear={() => setOrigin(null)}
              marker="origin"
              lineColor={railColor}
            />
            {/* Starts clear of the rail, so the divider separates the two
                fields without cutting the line running between them. */}
            <View style={styles.fieldDivider} />
            <StationAutocompleteInput
              label="To"
              placeholder="Destination station"
              selectedStation={destination}
              onSelect={setDestination}
              onClear={() => setDestination(null)}
              marker="destination"
              lineColor={railColor}
            />
          </View>
          <Pressable
            style={({ pressed }) => [styles.swapButton, pressed && styles.swapButtonPressed]}
            onPress={handleSwap}
            disabled={!origin && !destination}
            accessibilityRole="button"
            accessibilityLabel="Swap origin and destination"
          >
            <Ionicons
              name="swap-vertical"
              size={18}
              color={origin || destination ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>

        {route ? (
          <Animated.View
            key="route-result"
            style={styles.resultGroup}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(140)}
            layout={LinearTransition.duration(220)}
          >
            {!modesMatch && <RouteModeToggle mode={mode} onChange={setMode} />}
            <RouteSummaryCard
              route={route}
              lines={lines}
              onGoToMap={handleGoToMap}
              // The journey button is the card's primary action rather than a
              // separate bar below it: starting a journey is what this screen
              // is for, and it also does what Go to Map used to.
              // Availability is checked here as well as inside the button:
              // the button renders nothing where journeys aren't supported,
              // and an element that renders nothing still counts as an action,
              // which would leave the row holding only the save button.
              action={
                origin && destination && isJourneyServiceAvailable ? (
                  <StartJourneyButton
                    originId={origin.id}
                    destinationId={destination.id}
                    mode={mode}
                    onStarted={handleGoToMap}
                  />
                ) : undefined
              }
              isSaved={isCurrentSaved}
              onToggleSave={handleToggleSave}
            />
            <ItineraryList route={route} lines={lines} clock={clock} progress={progress} />
          </Animated.View>
        ) : (
          // No route on screen -- the slot below the inputs belongs to the
          // saved journeys, falling back to the empty state when there are
          // none. Any "why not" notice sits above whichever one shows.
          <Animated.View
            key="no-result"
            style={styles.resultGroup}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(140)}
            layout={LinearTransition.duration(220)}
          >
            {sameStation ? (
              <Text style={styles.notice}>Origin and destination are the same station.</Text>
            ) : origin && destination ? (
              <Text style={styles.notice}>No route could be found between these stations.</Text>
            ) : null}

            {/* Above the saved journeys: a journey already running outranks
                one you might run later, and this is the only way back to it
                once the inputs that started it have been cleared. */}
            <LiveJourneySection
              lines={lines}
              onOpen={(liveOrigin, liveDestination, session) =>
                handleOpenLive(liveOrigin, liveDestination, session.mode)
              }
            />

            {savedJourneys.length > 0 ? (
              <SavedJourneysSection
                journeys={savedJourneys}
                lines={lines}
                onOpen={handleOpenSaved}
                onRemove={removeSavedJourney}
              />
            ) : isJourneyActive ? null : (
              <Animated.View
                style={styles.emptyState}
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(140)}
                layout={LinearTransition.duration(220)}
              >
                <Ionicons name="navigate-outline" size={28} color={colors.textSecondary} />
                <Text style={styles.emptyTitle}>Plan your journey</Text>
                <Text style={styles.emptyNote}>
                  Choose an origin and destination station above to see route options.
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Identifies a route by the physical path it takes (which line each leg
 * rides and where it boards/alights) so two RouteResults that happen to
 * share the same stats can still be told apart, and identical paths from
 * different modes can be recognized as such. */
function routeSignature(route: RouteResult): string {
  return route.legs
    .map((leg) => `${leg.line}:${leg.boardingStation.stationId}>${leg.alightingStation.stationId}`)
    .join('|');
}

function createStyles(colors: ColorTokens, radiusNone: number, typography: Record<string, TypeStyle>) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    scrollContent: {
      padding: 20,
      gap: 16,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      ...typography.headlineLg,
      fontSize: 26,
      color: colors.textPrimary,
    },
    clearAllText: {
      ...typography.bodyMd,
      fontSize: 14,
      fontWeight: '600',
      color: colors.accent,
    },
    plannerCard: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: radiusNone,
      borderWidth: 1,
      borderColor: colors.outline,
      // Deliberately no `overflow: hidden`, unlike the cards below: the
      // autocomplete dropdown has to escape this card to sit over the results.
      paddingLeft: 6,
    },
    plannerFields: {
      flex: 1,
      minWidth: 0,
    },
    // Clear of the rail column and of the swap button's own edge, so it reads
    // as a break between two fields rather than as a line across the card.
    fieldDivider: {
      height: 1,
      marginLeft: 28,
      backgroundColor: colors.outlineVariant,
    },
    // Full height rather than a floating circle between the fields: the old
    // button owned a whole row of vertical space to hold one 18px icon, and
    // this way the tap target gets bigger while the section gets shorter.
    swapButton: {
      width: 46,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      borderLeftWidth: 1,
      borderLeftColor: colors.outlineVariant,
    },
    swapButtonPressed: {
      backgroundColor: colors.surfaceContainerHigh,
    },
    resultGroup: {
      gap: 16,
    },
    notice: {
      color: colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
    },
    emptyState: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 32,
      paddingHorizontal: 24,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      backgroundColor: colors.surfaceContainerLow,
    },
    emptyTitle: {
      ...typography.headlineMd,
      fontSize: 16,
      color: colors.textPrimary,
    },
    emptyNote: {
      ...typography.bodyMd,
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
}
