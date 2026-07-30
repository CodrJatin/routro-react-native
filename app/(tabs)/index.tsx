import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type PressEventWithFeatures,
  useCurrentPosition,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  Linking,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import tracksGeoJSON from '../../assets/data/tracks.json';
import { useAuth } from '../../src/auth/AuthProvider';
import { findRoute, getStation } from '../../src/engine/graph';
import type { CompiledStation } from '../../src/engine/types';
import { useBasemapStore } from '../../src/map/basemapStore';
import { FriendFocusStack, type ActiveFriend } from '../../src/map/FriendFocusStack';
import { FriendsLayer } from '../../src/map/FriendsLayer';
import {
  BASEMAP_ATTRIBUTION,
  DEFAULT_ZOOM,
  DELHI_CENTER,
  getMapStyle,
} from '../../src/map/mapStyle';
import { buildRoutePolylineGeoJSON, computeBounds } from '../../src/map/routePolyline';
import type { LabelViewport } from '../../src/map/stationLabelSelection';
import { StationLabels } from '../../src/map/StationLabels';
import { buildStationSubsetGeoJSON, buildStationsGeoJSON } from '../../src/map/stationsGeoJSON';
import { StationDetailCard } from '../../src/map/StationDetailCard';
import { UserLocationPin } from '../../src/map/UserLocationPin';
import { useIsJourneyActive } from '../../src/journey/journeyStore';
import { useSeedSelfPosition, useSelfPositionStore } from '../../src/location/selfPosition';
import { locationChannelManager } from '../../src/realtime/locationChannel';
import { useActiveRouteStore } from '../../src/route/activeRouteStore';
import { getRouteProgress } from '../../src/route/routeProgress';
import { useRouteClock } from '../../src/route/useRouteClock';
import { useLocationStore } from '../../src/realtime/locationStore';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens } from '../../src/theme/tokens';


// Pulled off the component rather than imported from the style-spec package,
// which is only here as a transitive dependency.
type CirclePaint = NonNullable<Extract<ComponentProps<typeof Layer>, { type: 'circle' }>['paint']>;

/** Shared by the base station circles and the "already passed" overlay drawn
 * on top of them -- if the two ever disagreed, passed stations would sit as a
 * visibly misaligned blob over their own outline. */
const STATION_CIRCLE_RADIUS: CirclePaint['circle-radius'] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  ['case', ['get', 'isInterchange'], 3, 2],
  14,
  ['case', ['get', 'isInterchange'], 6, 4],
  18,
  ['case', ['get', 'isInterchange'], 12, 8],
];

const STATION_CIRCLE_STROKE_WIDTH: CirclePaint['circle-stroke-width'] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  ['case', ['get', 'isInterchange'], 1.5, 1],
  14,
  ['case', ['get', 'isInterchange'], 3, 2],
  18,
  ['case', ['get', 'isInterchange'], 6, 4],
];

export default function MapScreen() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Hydration is gated on too: until the stored preference has been read,
  // `isEnabled` is its default `false`, and rendering the basemap only to swap
  // it out a frame later would reload the whole style for nothing.
  const isBasemapEnabled = useBasemapStore((state) => state.isEnabled && state.isHydrated);
  const mapStyle = useMemo(
    () => getMapStyle({ basemapEnabled: isBasemapEnabled, mode, backgroundColor: colors.canvas }),
    [isBasemapEnabled, mode, colors.canvas],
  );
  const cameraRef = useRef<CameraRef>(null);
  const [selectedStation, setSelectedStation] = useState<CompiledStation | null>(null);
  const [isPendingBroadcast, setIsPendingBroadcast] = useState(false);

  const { isConfigured, session } = useAuth();
  const isBroadcasting = useLocationStore((state) => state.isBroadcasting);
  const connectionState = useLocationStore((state) => state.connectionState);
  const broadcastNotice = useLocationStore((state) => state.broadcastNotice);

  // Broadcasting stopped without the user asking (GPS switched off, provider
  // error). Say so -- the failure mode this replaces was a green button over
  // a dead watcher, sharing nothing.
  useEffect(() => {
    if (!broadcastNotice) return;
    Alert.alert('Sharing stopped', broadcastNotice);
    useLocationStore.getState().setBroadcastNotice(null);
  }, [broadcastNotice]);

  // Drives a smooth crossfade on the button fill instead of an instant snap
  // when broadcasting toggles on/off. Fading the green layer's *opacity*,
  // rather than interpolating the background colour, is what lets the button
  // rest on the same translucent surface as the locate button below it --
  // interpolating colours would have meant a second opaque layer over it.
  const activeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(activeAnim, {
      toValue: isBroadcasting ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isBroadcasting, activeAnim]);

  const stationsGeoJSON = useMemo(() => buildStationsGeoJSON(), []);
  const router = useRouter();

  // Drives the station name labels. Updated on onRegionDidChange -- i.e. once
  // a pan/zoom settles -- rather than onRegionIsChanging: the labels are React
  // Native views, and rebuilding the set on every frame of a pinch would cost
  // far more than it buys.
  const [labelViewport, setLabelViewport] = useState<LabelViewport | null>(null);
  const handleRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { zoom, bounds } = event.nativeEvent;
      setLabelViewport((previous) =>
        previous && previous.zoom === zoom && sameBounds(previous.bounds, bounds)
          ? previous
          : { zoom, bounds },
      );
    },
    [],
  );

  // MapLibre's useCurrentPosition() starts a *native* GPS watcher. Tabs stay
  // mounted once visited, so an ungated call kept that watcher running on
  // every other tab and in the background -- alongside expo-location's own
  // watcher while broadcasting. Gate it on "map on screen, app foregrounded,
  // permission granted" so exactly one watcher runs, only when it's useful.
  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const [isAppActive, setIsAppActive] = useState(() => AppState.currentState === 'active');
  const [permission, setPermission] = useState<Location.PermissionStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => setIsScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) =>
      setIsAppActive(next === 'active'),
    );
    return () => subscription.remove();
  }, []);

  // A tracked journey runs its own watcher and writes to the same store, so
  // this one would be a second GPS consumer producing identical fixes.
  const isJourneyActive = useIsJourneyActive();
  const isLocationGranted = permission === Location.PermissionStatus.GRANTED;
  const currentPosition = useCurrentPosition({
    enabled: isScreenFocused && isAppActive && isLocationGranted && !isJourneyActive,
  });

  // This screen owns the live GPS watcher whenever no journey is being tracked,
  // so it's also what keeps the shared position current -- the route planner
  // reads the same value to place the user along the journey, and the two must
  // not disagree about which station that is. Seeding covers the gap before the
  // first fix (and the case where the watcher never starts, e.g. permission
  // refused).
  useSeedSelfPosition();
  useEffect(() => {
    if (!currentPosition) return;
    useSelfPositionStore
      .getState()
      .setLive(currentPosition.coords.latitude, currentPosition.coords.longitude);
  }, [currentPosition]);
  const selfPosition = useSelfPositionStore((state) => state.position);

  const params = useLocalSearchParams<{ focusUserId?: string }>();

  // From the store, not navigation params: the planner publishes the journey
  // the moment it has one, so the highlight and the arrival times below are
  // already in place when the user arrives here -- and follow a mode switch
  // or a cleared input without another trip through "Go to map".
  const routeOriginId = useActiveRouteStore((state) => state.originId);
  const routeDestinationId = useActiveRouteStore((state) => state.destinationId);
  const routeMode = useActiveRouteStore((state) => state.mode);
  const fitToken = useActiveRouteStore((state) => state.fitToken);

  const routeGeoJSON = useMemo(() => {
    if (!routeOriginId || !routeDestinationId) return null;
    return buildRoutePolylineGeoJSON(routeOriginId, routeDestinationId, routeMode);
  }, [routeOriginId, routeDestinationId, routeMode]);

  // The itinerary behind the drawn polyline, so tapping a station on it can
  // say when you get there.
  const activeRoute = useMemo(() => {
    if (!routeOriginId || !routeDestinationId) return null;
    return findRoute(routeOriginId, routeDestinationId, routeMode);
  }, [routeOriginId, routeDestinationId, routeMode]);

  // Which stations of the journey are already behind the user. Null whenever
  // that can't be answered honestly -- no fix, or nowhere near this route.
  const routeProgress = useMemo(
    () => getRouteProgress(activeRoute, selfPosition),
    [activeRoute, selfPosition],
  );
  const passedStationsGeoJSON = useMemo(() => {
    if (!routeProgress || routeProgress.passedStationIds.size === 0) return null;
    return buildStationSubsetGeoJSON(routeProgress.passedStationIds);
  }, [routeProgress]);

  // The same clock the itinerary screen runs, so the card can't quote an
  // arrival time the itinerary disagrees with: measured from the user's own
  // position on the route while they're on it, and from "leaving now"
  // otherwise.
  const routeClock = useRouteClock(activeRoute, routeProgress);

  // Checked, not requested: prompting on mount asks a user who may never touch
  // a location feature. The actual prompt happens on first use, below.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => setPermission(status))
      .catch(() => setPermission(null));
  }, []);

  // Drawing the route is unconditional; framing the camera on it is not. The
  // camera only exists while this screen is mounted and on top, and an 800ms
  // fly nobody sees would leave the route off-frame by the time they arrive.
  // So each new (or re-requested) journey carries a token, and it's spent on
  // the first focused render after it appears -- once per journey, never
  // re-hijacking a camera the user has since panned.
  const framedFitTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isScreenFocused) return;
    if (fitToken === framedFitTokenRef.current) return;
    if (!routeGeoJSON || routeGeoJSON.features.length === 0) return;
    const bounds = computeBounds(routeGeoJSON);
    if (!bounds) return;
    framedFitTokenRef.current = fitToken;
    const [west, south, east, north] = bounds;
    cameraRef.current?.setStop({
      bounds: [west, south, east, north],
      padding: { top: 80, bottom: 80, left: 48, right: 48 },
      duration: 800,
    });
  }, [routeGeoJSON, fitToken, isScreenFocused]);

  // Depends on the focusUserId *string*, never on the location object: that
  // object is replaced on every broadcast, so depending on it re-flew the
  // camera every few seconds and the user could never pan away. Fly once per
  // focus request, then clear the param so returning to this tab later
  // doesn't re-hijack the camera.
  const focusUserId = params.focusUserId;
  useEffect(() => {
    if (!focusUserId) return;

    let unsubscribe: (() => void) | undefined;
    let done = false;

    const flyToFriend = (location: { lat: number; lon: number }) => {
      if (done) return;
      done = true;
      cameraRef.current?.flyTo({ center: [location.lon, location.lat], zoom: 15, duration: 800 });
      router.setParams({ focusUserId: undefined });
    };

    const known = useLocationStore.getState().friendLocations[focusUserId];
    if (known) {
      flyToFriend(known);
    } else {
      // No fix for them yet -- wait for the first one instead of silently
      // doing nothing, then stop listening.
      unsubscribe = useLocationStore.subscribe((state) => {
        const location = state.friendLocations[focusUserId];
        if (location) flyToFriend(location);
      });
    }

    return () => {
      done = true;
      unsubscribe?.();
    };
  }, [focusUserId, router]);

  function handleStationPress(event: NativeSyntheticEvent<PressEventWithFeatures>) {
    // A source press bubbles up to the map's own onPress, which closes the
    // card. Stopping it here is what lets tapping station B while station A is
    // open swap the card over instead of closing it.
    event.stopPropagation();
    const feature = event.nativeEvent.features[0];
    const stationId = feature?.properties?.id as string | undefined;
    if (!stationId) return;
    const station = getStation(stationId);
    if (!station) return;
    setSelectedStation(station);
  }

  /** Only reached for taps that hit no station, since station presses stop
   * propagating. */
  function handleMapPress() {
    setSelectedStation(null);
  }

  async function handleCenterOnMyLocation() {
    // Previously this bailed silently when there was no fix, so with
    // permission denied the button did nothing at all, forever, with no
    // feedback. Ask on first use; if refused, offer the settings route.
    if (!isLocationGranted) {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      setPermission(status);
      if (status !== Location.PermissionStatus.GRANTED) {
        Alert.alert(
          'Location permission needed',
          'MetroSync needs location access to show where you are on the map.',
          canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open settings', onPress: () => void Linking.openSettings() },
              ],
        );
      }
      return;
    }

    if (!currentPosition) return; // button is disabled in this state
    cameraRef.current?.flyTo({
      center: [currentPosition.coords.longitude, currentPosition.coords.latitude],
      zoom: 15,
      duration: 800,
    });
  }

  async function handleToggleBroadcast() {
    if (isPendingBroadcast) return;
    const isStarting = !isBroadcasting;
    setIsPendingBroadcast(true);
    try {
      const result = await locationChannelManager.setBroadcasting(isStarting);
      // A button that spins and then just doesn't light up tells the user
      // nothing -- say why it couldn't start. Titled by direction: stopping
      // can no longer fail, but a fixed "Couldn't start sharing" would be
      // actively misleading if it ever did.
      if (!result.ok) {
        Alert.alert(isStarting ? "Couldn't start sharing" : "Couldn't stop sharing", result.reason);
      }
    } finally {
      setIsPendingBroadcast(false);
    }
  }

  function handleFocusFriend(friend: ActiveFriend) {
    cameraRef.current?.flyTo({
      center: [friend.lon, friend.lat],
      zoom: 15,
      duration: 800,
    });
  }

  return (
    <View style={styles.container}>
      {/* MapLibre's own attribution control is off: it renders as a floating
          (i) button over the map. The credit it carries is still required
          whenever CARTO/OSM tiles are on screen, so it's printed as static
          text below instead -- and, like the control it replaces, it tracks
          the basemap rather than showing over the empty offline canvas. */}
      <MapLibreMap
        style={styles.map}
        mapStyle={mapStyle}
        logo={false}
        attribution={false}
        onPress={handleMapPress}
        onRegionDidChange={handleRegionDidChange}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: DELHI_CENTER, zoom: DEFAULT_ZOOM }}
          minZoom={9}
          maxZoom={18}
        />

        <GeoJSONSource id="tracks" data={tracksGeoJSON as GeoJSON.GeoJSON}>
          <Layer
            id="tracks-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 18, 6],
              'line-opacity': routeGeoJSON ? 0.25 : 1,
            }}
          />
        </GeoJSONSource>

        {routeGeoJSON && (
          <GeoJSONSource id="active-route" data={routeGeoJSON}>
            <Layer
              id="active-route-glow"
              type="line"
              beforeId="stations-circle"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 10, 18, 16],
                'line-opacity': 0.3,
              }}
            />
            <Layer
              id="active-route-line"
              type="line"
              beforeId="stations-circle"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4.5, 18, 8],
              }}
            />
          </GeoJSONSource>
        )}

        <GeoJSONSource
          id="stations"
          data={stationsGeoJSON}
          onPress={handleStationPress}
          hitbox={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <Layer
            id="stations-circle"
            type="circle"
            afterId="tracks-line"
            paint={{
              'circle-radius': STATION_CIRCLE_RADIUS,
              'circle-color': colors.canvas,
              'circle-stroke-width': STATION_CIRCLE_STROKE_WIDTH,
              'circle-stroke-color': [
                'case',
                ['get', 'isInterchange'],
                colors.textPrimary,
                colors.accent,
              ],
            }}
          />
        </GeoJSONSource>

        {/* Stations already behind the user on the active journey: the same
            circle, solid instead of outlined. Drawn as its own layer over the
            base one rather than by rebuilding the 290-station source on every
            GPS fix -- and so the source that owns station taps is left
            completely alone. Filling with textPrimary is what makes it read
            as white-on-dark and black-on-light without a second rule. */}
        {passedStationsGeoJSON && (
          <GeoJSONSource id="route-passed-stations" data={passedStationsGeoJSON}>
            <Layer
              id="route-passed-circle"
              type="circle"
              afterId="stations-circle"
              paint={{
                'circle-radius': STATION_CIRCLE_RADIUS,
                'circle-color': colors.textPrimary,
                'circle-stroke-width': STATION_CIRCLE_STROKE_WIDTH,
                'circle-stroke-color': colors.textPrimary,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Before FriendsLayer so a friend's pin is never hidden behind a
            station name. */}
        <StationLabels viewport={labelViewport} />

        <FriendsLayer />

        <UserLocationPin position={currentPosition} />
      </MapLibreMap>

      {/* Without this, a dropped realtime connection is indistinguishable
          from "nobody is sharing right now" -- the map just quietly empties. */}
      {isConfigured && session && connectionState === 'error' && (
        <View style={styles.connectionBanner} pointerEvents="none">
          <Ionicons name="cloud-offline-outline" size={14} color={colors.onSurfaceVariant} />
          <Text style={styles.connectionBannerText}>
            Live connection lost — friend locations may be out of date
          </Text>
        </View>
      )}

      {isConfigured && session && <FriendFocusStack onSelectFriend={handleFocusFriend} />}

      {isConfigured && session && (
        <View style={[styles.locateButtonWrapper, styles.broadcastButton]} pointerEvents="box-none">
          {isBroadcasting && <BroadcastPing color={colors.success} />}
          <Pressable
            disabled={isPendingBroadcast}
            style={({ pressed }) => [styles.locateButton, pressed && { opacity: 0.7 }]}
            onPress={handleToggleBroadcast}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.success, opacity: activeAnim },
              ]}
            />
            {isPendingBroadcast ? (
              <ActivityIndicator color={isBroadcasting ? colors.onSuccess : colors.textPrimary} />
            ) : (
              <Ionicons
                name={isBroadcasting ? 'radio' : 'radio-outline'}
                size={22}
                color={isBroadcasting ? colors.onSuccess : colors.textPrimary}
              />
            )}
          </Pressable>
        </View>
      )}

      <View style={styles.locateButtonWrapper} pointerEvents="box-none">
        <Pressable
          // Only inert while we *have* permission but no fix has arrived yet.
          // Without permission it stays tappable -- that tap is what asks.
          disabled={isLocationGranted && !currentPosition}
          style={({ pressed }) => [
            styles.locateButton,
            pressed && { opacity: 0.7 },
            isLocationGranted && !currentPosition && { opacity: 0.5 },
          ]}
          onPress={handleCenterOnMyLocation}
          accessibilityRole="button"
          accessibilityLabel={
            isLocationGranted ? 'Center map on my location' : 'Enable location access'
          }
        >
          <Ionicons
            name={isLocationGranted ? 'locate' : 'locate-outline'}
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
      </View>

      {isBasemapEnabled && (
        <Text style={styles.attribution} pointerEvents="none">
          {BASEMAP_ATTRIBUTION}
        </Text>
      )}

      <StationDetailCard
        station={selectedStation}
        route={activeRoute}
        clock={routeClock}
        progress={routeProgress}
        onClose={() => setSelectedStation(null)}
      />
    </View>
  );
}

/** Expanding ring that fades out on a loop -- reads as "actively transmitting"
 * without dimming the icon the way the old whole-button blink did. */
function BroadcastPing({ color }: { color: string }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        pingStyles.ring,
        {
          borderColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
        },
      ]}
    />
  );
}

const pingStyles = StyleSheet.create({
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
    borderWidth: 2,
  },
});

/** Region events fire on settle even when nothing actually moved (a tap that
 * pans by a pixel, a camera stop landing where it already was). Comparing the
 * viewport before storing it keeps those from re-rendering every label. */
function sameBounds(a: LabelViewport['bounds'], b: LabelViewport['bounds']): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Theme colours are opaque hex; this is the only place that wants one of
 * them see-through, so it converts rather than adding a second token that
 * would have to be kept in step with the first. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    map: {
      flex: 1,
    },
    // Sits in the strip below the station card (which rests at bottom: 24), so
    // the two can never overlap.
    attribution: {
      position: 'absolute',
      left: 10,
      bottom: 5,
      zIndex: 1,
      fontFamily: 'SpaceMono_400Regular',
      fontSize: 9,
      lineHeight: 12,
      color: colors.textSecondary,
    },
    locateButtonWrapper: {
      position: 'absolute',
      right: 16,
      bottom: 24,
      width: 48,
      height: 48,
      borderRadius: 24,
      zIndex: 2,
    },
    locateButton: {
      flex: 1,
      width: 48,
      height: 48,
      borderRadius: 24,
      overflow: 'hidden',
      // Translucent so the map reads as continuing underneath the controls
      // rather than being punched out by them. Shared by the locate and
      // broadcast buttons -- they sit in the same column and any difference
      // between the two reads as a mistake.
      backgroundColor: withAlpha(colors.surfaceElevated, 0.72),
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    connectionBanner: {
      position: 'absolute',
      top: 12,
      left: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 3,
    },
    connectionBannerText: {
      flex: 1,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    broadcastButton: {
      bottom: 84,
    },
  });
}
