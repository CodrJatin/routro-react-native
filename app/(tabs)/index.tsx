import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type PressEventWithFeatures,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  Animated,
  AppState,
  type AppStateStatus,
  Linking,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tracksGeoJSON from '../../assets/data/tracks.json';
import { useAuth } from '../../src/auth/AuthProvider';
import { showDialog } from '../../src/dialog/dialogStore';
import { findRoute, getStation } from '../../src/engine/graph';
import type { CompiledStation, StationId } from '../../src/engine/types';
import { friendColorFor } from '../../src/friends/friendColor';
import { MeetRequestStack } from '../../src/friends/MeetRequestCard';
import { useBasemapStore } from '../../src/map/basemapStore';
import { ConnectionBanner } from '../../src/map/ConnectionBanner';
import { FriendFocusStack, type ActiveFriend } from '../../src/map/FriendFocusStack';
import { FriendsLayer } from '../../src/map/FriendsLayer';
import { GhostModeBanner } from '../../src/map/GhostModeBanner';
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
import {
  JOURNEY_BAR_HEIGHT,
  JourneyBar,
  MAP_OVERLAY_TOP_GAP,
} from '../../src/journey/JourneyBar';
import { useIsJourneyActive } from '../../src/journey/journeyStore';
import { useSelfPositionStore } from '../../src/location/selfPosition';
import { useSeedSelfPosition } from '../../src/location/useSeedSelfPosition';
import { useSelfPositionWatcher } from '../../src/location/useSelfPositionWatcher';
import { locationChannelManager } from '../../src/realtime/locationChannel';
import { useActiveRouteStore } from '../../src/route/activeRouteStore';
import { getRouteProgress } from '../../src/route/routeProgress';
import { useRouteClock } from '../../src/route/useRouteClock';
import { useLocationStore } from '../../src/realtime/locationStore';
import { useGhostModeStore } from '../../src/sharing/ghostModeStore';
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

/** Module-scoped so the "no route, nothing passed" case keeps a stable
 * identity and doesn't rebuild the passed-stations source every render. */
const EMPTY_STATION_IDS: ReadonlySet<StationId> = new Set();

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
  const { colors, mode, radius } = useTheme();
  const styles = useMemo(() => createStyles(colors, radius), [colors, radius]);
  const insets = useSafeAreaInsets();

  // Hydration is gated on too: until the stored preference has been read,
  // `isEnabled` is its default `false`, and rendering the basemap only to swap
  // it out a frame later would reload the whole style for nothing.
  const isBasemapEnabled = useBasemapStore((state) => state.isEnabled && state.isHydrated);
  const arePlaceLabelsEnabled = useBasemapStore(
    (state) => state.arePlaceLabelsEnabled && state.isHydrated,
  );
  const mapStyle = useMemo(
    () =>
      getMapStyle({
        basemapEnabled: isBasemapEnabled,
        placeLabelsEnabled: arePlaceLabelsEnabled,
        mode,
        backgroundColor: colors.canvas,
      }),
    [isBasemapEnabled, arePlaceLabelsEnabled, mode, colors.canvas],
  );
  const cameraRef = useRef<CameraRef>(null);
  const [selectedStation, setSelectedStation] = useState<CompiledStation | null>(null);
  /** Whose route to draw. One at a time and only on request: several friends'
   * routes at once would fight the user's own highlighted journey for the same
   * tracks and turn the map into a tangle nobody can read. */
  const [focusedFriendId, setFocusedFriendId] = useState<string | null>(null);

  const { isConfigured, session } = useAuth();
  const isBroadcasting = useLocationStore((state) => state.isBroadcasting);
  const broadcastNotice = useLocationStore((state) => state.broadcastNotice);
  const isGhost = useGhostModeStore((state) => state.isGhost);
  const setGhost = useGhostModeStore((state) => state.setGhost);

  // Something about location the user needs telling -- sharing stopped without
  // them asking (GPS switched off, provider error), or a grant too coarse to
  // work with. The failure mode this replaces was a green button over a dead
  // watcher, sharing nothing. Each notice brings its own title, since not all
  // of them mean sharing has stopped.
  useEffect(() => {
    if (!broadcastNotice) return;
    void showDialog({
      title: broadcastNotice.title,
      message: broadcastNotice.message,
      tone: 'danger',
    });
    useLocationStore.getState().setBroadcastNotice(null);
  }, [broadcastNotice]);

  // Drives a smooth crossfade on the button fill instead of an instant snap.
  // Fading the marked layer's *opacity*, rather than interpolating the
  // background colour, is what lets the button rest on the same translucent
  // surface as the locate button below it -- interpolating colours would have
  // meant a second opaque layer over it.
  //
  // Keyed on Ghost Mode now, not on broadcasting, and the inversion is the
  // point: sharing is the ordinary state and an ordinary state should not be
  // lit up. What deserves the ink is the mode that makes you disappear.
  const activeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(activeAnim, {
      toValue: isGhost ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isGhost, activeAnim]);

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

  // Tabs stay mounted once visited, so an ungated watcher would keep running
  // on every other tab and in the background. Gate it on "map on screen, app
  // foregrounded, permission granted" so it only runs when it's useful.
  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const [isAppActive, setIsAppActive] = useState(() => AppState.currentState === 'active');
  const [permission, setPermission] = useState<Location.PermissionStatus | null>(null);
  // Android stops showing the dialog after the second refusal and resolves
  // every later request instantly as denied. Asking anyway is a tap that looks
  // like it did nothing, so this is what sends the user to Settings instead.
  const [canAskForLocation, setCanAskForLocation] = useState(true);
  // Guards the request itself rather than the button: the system dialog leaves
  // the button mounted and enabled underneath it, and a second tap while one
  // request is in flight queues a second dialog behind the first.
  const isRequestingLocation = useRef(false);

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

  // A tracked journey and an active broadcast each already run a watcher that
  // writes to the same store, so this screen only starts one when neither of
  // them does -- a second consumer of the same GPS is pure battery cost for
  // identical fixes. Note what this is *not*: the pin does not depend on
  // sharing being on, it depends on some watcher being on, and these three
  // cases cover each other.
  const isJourneyActive = useIsJourneyActive();
  const isLocationGranted = permission === Location.PermissionStatus.GRANTED;
  useSelfPositionWatcher(
    isScreenFocused && isAppActive && isLocationGranted && !isJourneyActive && !isBroadcasting,
  );

  // Seeding covers the gap before the first fix, and the case where no watcher
  // can start at all (permission refused, location switched off).
  useSeedSelfPosition();
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
  // Built even when it's empty, so `route-passed-circle` is always in the
  // style. It is the anchor the user-location layers hang off (see
  // UserLocationPin), and an anchor that comes and goes with the active route
  // would leave the pin waiting on a layer that may never arrive. An empty
  // source renders nothing and costs nothing.
  const passedStationsGeoJSON = useMemo(
    () => buildStationSubsetGeoJSON(routeProgress?.passedStationIds ?? EMPTY_STATION_IDS),
    [routeProgress],
  );

  // Subscribed to `friendJourneys` alone, deliberately never to
  // `friendLocations`: journeys change once per trip, positions every 5s, and
  // this screen re-rendering on every friend's every fix is exactly what
  // FriendsLayer exists as a separate leaf to avoid.
  const focusedFriendJourney = useLocationStore((state) =>
    focusedFriendId ? state.friendJourneys[focusedFriendId] : undefined,
  );

  const focusedFriendRouteGeoJSON = useMemo(() => {
    if (!focusedFriendJourney) return null;
    return buildRoutePolylineGeoJSON(
      focusedFriendJourney.originId,
      focusedFriendJourney.destinationId,
      focusedFriendJourney.mode,
    );
  }, [focusedFriendJourney]);

  // The same clock the itinerary screen runs, so the card can't quote an
  // arrival time the itinerary disagrees with: measured from the user's own
  // position on the route while they're on it, and from "leaving now"
  // otherwise.
  const routeClock = useRouteClock(activeRoute, routeProgress);

  // Checked, not requested: prompting on mount asks a user who may never touch
  // a location feature. The actual prompt happens on first use, below.
  //
  // Re-checked on every focus/foreground rather than once on mount. Permission
  // is also granted from the broadcast toggle, from starting a journey, and
  // from Settings -- and a mount-only check meant a grant made any of those
  // ways left this screen believing it still had none, so the watcher never
  // started and the pin never appeared. Both of those routes hand focus back
  // here when they're done, which is exactly when this runs.
  useEffect(() => {
    if (!isScreenFocused || !isAppActive) return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then(({ status, canAskAgain }) => {
        if (cancelled) return;
        setPermission(status);
        setCanAskForLocation(canAskAgain);
      })
      .catch(() => {
        if (!cancelled) setPermission(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isScreenFocused, isAppActive]);

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
    // A tap on empty map is how you dismiss things here, and a friend's route
    // is one of them -- otherwise the only way to clear it would be to focus a
    // different friend.
    setFocusedFriendId(null);
  }

  function showLocationDeniedDialog(canAskAgain: boolean) {
    void showDialog({
      title: 'Location permission needed',
      message: 'Routro needs location access to show where you are on the map.',
      tone: 'danger',
      buttons: canAskAgain
        ? [{ text: 'OK' }]
        : [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => void Linking.openSettings() },
          ],
    });
  }

  async function handleCenterOnMyLocation() {
    // Previously this bailed silently when there was no fix, so with
    // permission denied the button did nothing at all, forever, with no
    // feedback. Ask on first use; if refused, offer the settings route.
    if (!isLocationGranted) {
      if (isRequestingLocation.current) return;
      // Out of asks -- the OS will not show the dialog again, so go straight
      // to the only route left rather than firing a request that resolves
      // denied before the user sees anything.
      if (!canAskForLocation) {
        showLocationDeniedDialog(false);
        return;
      }
      isRequestingLocation.current = true;
      try {
        const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
        setPermission(status);
        setCanAskForLocation(canAskAgain);
        if (status !== Location.PermissionStatus.GRANTED) {
          showLocationDeniedDialog(canAskAgain);
        }
      } finally {
        isRequestingLocation.current = false;
      }
      return;
    }

    // Permission is granted but nothing has arrived. Device location switched
    // off is by far the usual reason, and the watcher deliberately no longer
    // says so by opening a system dialog on its own -- so this tap is where
    // that belongs. Without it the button is inert again, which is exactly the
    // silence the permission branch above exists to avoid.
    if (!selfPosition) {
      if (isRequestingLocation.current) return;
      isRequestingLocation.current = true;
      try {
        await offerLocationServices();
      } finally {
        isRequestingLocation.current = false;
      }
      return;
    }

    cameraRef.current?.flyTo({
      center: [selfPosition.lon, selfPosition.lat],
      zoom: 15,
      duration: 800,
    });
  }

  /** Asks about device location -- the setting, not the app's permission --
   * only ever in response to a tap. Android can offer to switch it on in place;
   * everywhere else there is nothing to do but explain. */
  async function offerLocationServices() {
    const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
    if (enabled) {
      void showDialog({
        title: 'Still looking for you',
        message:
          'Location is on, but no fix has come through yet. That can take a moment indoors or underground.',
      });
      return;
    }

    if (Platform.OS === 'android') {
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        // Declined, or no Play services to ask with. Either way the user has
        // just answered the question -- following it with an alert would be
        // asking again in a different font.
      }
      return;
    }

    void showDialog({
      title: 'Location is off',
      message: 'Switch location on in your device settings to see where you are on the map.',
      tone: 'danger',
      buttons: [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ],
    });
  }

  /**
   * Ghost Mode, both directions.
   *
   * There is no longer a "start sharing" to fail: sharing is what the app does
   * once you have a friend, and this button only takes it away. Leaving ghost
   * hands the decision back to `LocationProvider`, which re-asserts sharing
   * under the same rules that started it -- so a user whose location permission
   * has since been revoked comes back to a map that says so, rather than to an
   * alert raised by a button that was only ever about visibility.
   */
  function handleToggleGhost() {
    setGhost(!isGhost);
  }

  function handleFocusFriend(friend: ActiveFriend) {
    // Tapping the same friend again clears their route rather than re-flying to
    // where they already are -- the second tap on a thing that is already
    // focused should undo it, not repeat it.
    setFocusedFriendId((current) => (current === friend.userId ? null : friend.userId));
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

        {/* Before the user's own route, so theirs always draws on top. Painted
            in the friend's identity colour rather than in line colours: line
            colours would make it indistinguishable from the user's own
            highlighted journey, whereas this matches their pin ring and
            destination flag and reads as "this person's route". Dashed and thin
            for the same reason -- it is reference, not the subject. */}
        {focusedFriendRouteGeoJSON && focusedFriendId && (
          <GeoJSONSource id="focused-friend-route" data={focusedFriendRouteGeoJSON}>
            <Layer
              id="focused-friend-route-line"
              type="line"
              beforeId="stations-circle"
              layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
              paint={{
                'line-color': friendColorFor(focusedFriendId),
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 3, 18, 5],
                'line-opacity': 0.85,
                'line-dasharray': [2, 2],
              }}
            />
          </GeoJSONSource>
        )}

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

        {/* Before FriendsLayer so a friend's pin is never hidden behind a
            station name. */}
        <StationLabels viewport={labelViewport} />

        <FriendsLayer />

        <UserLocationPin position={selfPosition} />
      </MapLibreMap>

      <JourneyBar />

      {/* Everything that stacks under the journey bar, in one column so the
          pieces can't overlap each other. Heights vary (a meet request card is
          much taller than the connection hairline) and each one used to place
          itself, which only worked while there was never more than one. */}
      {isConfigured && session && (
        <View
          style={[
            styles.topStack,
            {
              // Below the journey bar when there is one, in the top slot when
              // there isn't -- and clear of the notch either way.
              top:
                insets.top +
                MAP_OVERLAY_TOP_GAP +
                (isJourneyActive ? JOURNEY_BAR_HEIGHT + 8 : 0),
            },
          ]}
          pointerEvents="box-none"
        >
          {/* Without this, a dropped realtime connection is indistinguishable
              from "nobody is sharing right now" -- the map just quietly
              empties. It stays silent for short drops and says nothing about
              attempts; see the component for why. */}
          {/* Above the connection banner: while Ghost Mode is on it is the
              explanation for the empty map, and a "reconnecting" notice under
              it would be answering a question nobody is asking. */}
          <GhostModeBanner />

          <ConnectionBanner />

          {/* A friend asking to meet, with thirty seconds on the clock. Here
              rather than in a modal on purpose: it must not stop the user
              doing anything, and it has to be dismissible by simply not
              answering. */}
          <MeetRequestStack />
        </View>
      )}

      {isConfigured && session && <FriendFocusStack onSelectFriend={handleFocusFriend} />}

      {isConfigured && session && (
        <View style={[styles.locateButtonWrapper, styles.broadcastButton]} pointerEvents="box-none">
          <Pressable
            // Pressed state is a fill change, not `opacity`: dimming the whole
            // view lets the elevation shadow show through it, which is the
            // polygon the opaque background above exists to hide.
            style={({ pressed }) => [styles.locateButton, pressed && styles.locateButtonPressed]}
            onPress={handleToggleGhost}
            accessibilityRole="switch"
            accessibilityState={{ checked: isGhost }}
            accessibilityLabel={isGhost ? 'Turn off Ghost Mode' : 'Turn on Ghost Mode'}
          >
            {/* Inverted rather than coloured. Ghost Mode is not a warning and
                not a success, so spending green or amber on it would be
                claiming something about it that isn't true -- and the loudest
                thing available that says nothing is simply the page's own ink. */}
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.textPrimary, opacity: activeAnim },
              ]}
            />
            <Ionicons
              name={isGhost ? 'eye-off' : 'eye-outline'}
              size={22}
              color={isGhost ? colors.canvas : colors.textPrimary}
            />
          </Pressable>
        </View>
      )}

      <View style={styles.locateButtonWrapper} pointerEvents="box-none">
        <Pressable
          // Never inert. Every state this button can be in has something the
          // tap can do: ask for permission, offer to switch device location
          // on, say a fix hasn't landed yet, or centre the map. It was
          // previously disabled while waiting for a fix, which is precisely
          // the state a device with location switched off is stuck in forever.
          style={({ pressed }) => [styles.locateButton, pressed && styles.locateButtonPressed]}
          onPress={handleCenterOnMyLocation}
          accessibilityRole="button"
          accessibilityLabel={
            isLocationGranted
              ? selfPosition
                ? 'Center map on my location'
                : 'Waiting for your location'
              : 'Enable location access'
          }
        >
          {/* Waiting for a fix dims the *icon*, not the button. The button's
              own opacity has to stay at 1 or the elevation shadow shows
              through it as a polygon. */}
          <Ionicons
            name={isLocationGranted ? 'locate' : 'locate-outline'}
            size={22}
            color={colors.textPrimary}
            style={isLocationGranted && !selfPosition && styles.iconWaiting}
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

/* The broadcast ping -- an expanding ring that looped while sharing was on --
 * was removed when sharing became the default state. A permanent pulse on the
 * ordinary case is the ambient shouting `ConnectionBanner` argues against at
 * length, and there is nothing left for it to announce: sharing is no longer an
 * event, it is the resting state. Ghost Mode is what the button marks now. */

/** Region events fire on settle even when nothing actually moved (a tap that
 * pans by a pixel, a camera stop landing where it already was). Comparing the
 * viewport before storing it keeps those from re-rendering every label. */
function sameBounds(a: LabelViewport['bounds'], b: LabelViewport['bounds']): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}


function createStyles(colors: ColorTokens, radius: { none: number; badge: number }) {
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
      // Opaque, and it has to stay that way. Android draws the `elevation`
      // shadow below as a solid shape stamped from the view's outline, and it
      // approximates that rounded rect with straight segments -- so at the
      // 0.72 alpha this used to have, the shadow showed *through* the button
      // as a hard-edged polygon sitting inside it. Any alpha below 1 brings it
      // back; the only other cure is dropping the elevation.
      //
      // Shared by the locate and broadcast buttons -- they sit in the same
      // column and any difference between the two reads as a mistake.
      backgroundColor: colors.surfaceElevated,
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
    locateButtonPressed: {
      backgroundColor: colors.surfaceContainerHighest,
    },
    iconWaiting: {
      opacity: 0.5,
    },
    // Aligned with the journey bar above it. `top` is set at the call site,
    // which is where the safe-area inset is known.
    topStack: {
      position: 'absolute',
      left: 12,
      right: 12,
      gap: 8,
      zIndex: 3,
    },
    broadcastButton: {
      bottom: 84,
    },
  });
}
