import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type PressEventWithFeatures,
  useCurrentPosition,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { CompiledStation, RouteMode } from '../../src/engine/types';
import { useBasemapStore } from '../../src/map/basemapStore';
import { FriendFocusStack, type ActiveFriend } from '../../src/map/FriendFocusStack';
import { FriendsLayer } from '../../src/map/FriendsLayer';
import { DEFAULT_ZOOM, DELHI_CENTER, getMapStyle } from '../../src/map/mapStyle';
import { buildRoutePolylineGeoJSON, computeBounds } from '../../src/map/routePolyline';
import { buildStationsGeoJSON } from '../../src/map/stationsGeoJSON';
import { StationDetailCard } from '../../src/map/StationDetailCard';
import { UserLocationPin } from '../../src/map/UserLocationPin';
import { locationChannelManager } from '../../src/realtime/locationChannel';
import { useLocationStore } from '../../src/realtime/locationStore';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens } from '../../src/theme/tokens';


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

  // Drives a smooth color crossfade on the button fill instead of an instant
  // snap when broadcasting toggles on/off.
  const activeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(activeAnim, {
      toValue: isBroadcasting ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [isBroadcasting, activeAnim]);
  const broadcastFillColor = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.surfaceElevated, colors.success],
  });

  const stationsGeoJSON = useMemo(() => buildStationsGeoJSON(), []);
  const router = useRouter();

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

  const isLocationGranted = permission === Location.PermissionStatus.GRANTED;
  const currentPosition = useCurrentPosition({
    enabled: isScreenFocused && isAppActive && isLocationGranted,
  });

  const params = useLocalSearchParams<{
    originId?: string;
    destinationId?: string;
    mode?: RouteMode;
    focusUserId?: string;
  }>();
  const routeGeoJSON = useMemo(() => {
    if (!params.originId || !params.destinationId) return null;
    return buildRoutePolylineGeoJSON(params.originId, params.destinationId, params.mode ?? 'fastest');
  }, [params.originId, params.destinationId, params.mode]);

  // The itinerary behind the drawn polyline, so tapping a station on it can
  // say when you get there.
  const activeRoute = useMemo(() => {
    if (!params.originId || !params.destinationId) return null;
    return findRoute(params.originId, params.destinationId, params.mode ?? 'fastest');
  }, [params.originId, params.destinationId, params.mode]);

  // Captured per journey rather than per render, so arrival times don't drift
  // while the card is open -- same treatment the itinerary gives them.
  const [routeStartMs, setRouteStartMs] = useState(() => Date.now());
  useEffect(() => setRouteStartMs(Date.now()), [activeRoute]);

  // Checked, not requested: prompting on mount asks a user who may never touch
  // a location feature. The actual prompt happens on first use, below.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => setPermission(status))
      .catch(() => setPermission(null));
  }, []);

  useEffect(() => {
    if (!routeGeoJSON || routeGeoJSON.features.length === 0) return;
    const bounds = computeBounds(routeGeoJSON);
    if (!bounds) return;
    const [west, south, east, north] = bounds;
    cameraRef.current?.setStop({
      bounds: [west, south, east, north],
      padding: { top: 80, bottom: 80, left: 48, right: 48 },
      duration: 800,
    });
  }, [routeGeoJSON]);

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
    setIsPendingBroadcast(true);
    try {
      const result = await locationChannelManager.setBroadcasting(!isBroadcasting);
      // A button that spins and then just doesn't light up tells the user
      // nothing -- say why it couldn't start.
      if (!result.ok) {
        Alert.alert("Couldn't start sharing", result.reason);
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
      {/* Attribution is required whenever CARTO/OSM tiles are on screen, and
          pointless over the empty offline canvas -- so it tracks the basemap. */}
      <MapLibreMap
        style={styles.map}
        mapStyle={mapStyle}
        logo={false}
        attribution={isBasemapEnabled}
        onPress={handleMapPress}
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
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                ['case', ['get', 'isInterchange'], 3, 2],
                14,
                ['case', ['get', 'isInterchange'], 6, 4],
                18,
                ['case', ['get', 'isInterchange'], 12, 8],
              ],
              'circle-color': colors.canvas,
              'circle-stroke-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                ['case', ['get', 'isInterchange'], 1.5, 1],
                14,
                ['case', ['get', 'isInterchange'], 3, 2],
                18,
                ['case', ['get', 'isInterchange'], 6, 4],
              ],
              'circle-stroke-color': [
                'case',
                ['get', 'isInterchange'],
                colors.textPrimary,
                colors.accent,
              ],
            }}
          />
        </GeoJSONSource>

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
              style={[StyleSheet.absoluteFill, { backgroundColor: broadcastFillColor }]}
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

      <StationDetailCard
        station={selectedStation}
        route={activeRoute}
        startMs={routeStartMs}
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

function createStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    map: {
      flex: 1,
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
