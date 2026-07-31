import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { findRoute, getCompiledGraph, getStation } from '../../src/engine/graph';
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

  const savedJourneys = useSavedJourneysStore((state) => state.journeys);
  const hydrateSavedJourneys = useSavedJourneysStore((state) => state.hydrate);
  const removeSavedJourney = useSavedJourneysStore((state) => state.remove);
  const toggleSavedJourney = useSavedJourneysStore((state) => state.toggle);
  const isCurrentSaved = useIsJourneySaved(origin?.id, destination?.id);

  useEffect(() => {
    hydrateSavedJourneys();
  }, [hydrateSavedJourneys]);

  function handleSwap() {
    setOrigin(destination);
    setDestination(origin);
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
        <Text style={styles.title}>Plan Your Route</Text>

        <View style={styles.inputsCard}>
          <StationAutocompleteInput
            label="From"
            placeholder="Origin station"
            selectedStation={origin}
            onSelect={setOrigin}
            onClear={() => setOrigin(null)}
          />
          <Pressable
            style={styles.swapButton}
            onPress={handleSwap}
            disabled={!origin && !destination}
          >
            <Ionicons name="swap-vertical" size={18} color={colors.accent} />
          </Pressable>
          <StationAutocompleteInput
            label="To"
            placeholder="Destination station"
            selectedStation={destination}
            onSelect={setDestination}
            onClear={() => setDestination(null)}
          />
        </View>

        <View style={styles.divider} />

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
              isSaved={isCurrentSaved}
              onToggleSave={handleToggleSave}
            />
            {origin && destination && (
              <StartJourneyButton
                originId={origin.id}
                destinationId={destination.id}
                mode={mode}
              />
            )}
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

            {savedJourneys.length > 0 ? (
              <SavedJourneysSection
                journeys={savedJourneys}
                lines={lines}
                onOpen={handleOpenSaved}
                onRemove={removeSavedJourney}
              />
            ) : (
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
    title: {
      ...typography.headlineLg,
      fontSize: 26,
      color: colors.textPrimary,
    },
    inputsCard: {
      gap: 8,
    },
    swapButton: {
      alignSelf: 'center',
      width: 32,
      height: 32,
      borderRadius: radiusNone,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      // The "To" field's label sits between this button and the To input
      // box, but the "From" field's label sits above the From box instead --
      // without this offset the button reads as centered on the whole label
      // stack rather than on the two input boxes. Shifting down by half the
      // label's rendered height (14 line-height + 6 marginBottom, see
      // StationAutocompleteInput's `label` style) re-centers it on the boxes
      // themselves, independent of the actual input height.
      marginTop: 10,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
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
