import { Ionicons } from '@expo/vector-icons';
import type BottomSheet from '@gorhom/bottom-sheet';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  LocationManager,
  Map as MapLibreMap,
  useCurrentPosition,
} from '@maplibre/maplibre-react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import tracksGeoJSON from '../../assets/data/tracks.json';
import { useAuth } from '../../src/auth/AuthProvider';
import { getStation } from '../../src/engine/graph';
import type { CompiledStation, RouteMode } from '../../src/engine/types';
import { FriendFocusStack, type ActiveFriend } from '../../src/map/FriendFocusStack';
import { FriendsLayer } from '../../src/map/FriendsLayer';
import { DEFAULT_ZOOM, DELHI_CENTER, getEmptyOfflineStyle } from '../../src/map/mapStyle';
import { buildRoutePolylineGeoJSON, computeBounds } from '../../src/map/routePolyline';
import { buildStationsGeoJSON } from '../../src/map/stationsGeoJSON';
import { StationDetailSheet } from '../../src/map/StationDetailSheet';
import { UserLocationPin } from '../../src/map/UserLocationPin';
import { locationChannelManager } from '../../src/realtime/locationChannel';
import { useLocationStore } from '../../src/realtime/locationStore';
import { useTheme } from '../../src/theme/ThemeProvider';
import type { ColorTokens } from '../../src/theme/tokens';


export default function MapScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const offlineStyle = useMemo(() => getEmptyOfflineStyle(colors.canvas), [colors.canvas]);
  const cameraRef = useRef<CameraRef>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const [selectedStation, setSelectedStation] = useState<CompiledStation | null>(null);
  const [isPendingBroadcast, setIsPendingBroadcast] = useState(false);

  const { isConfigured, session } = useAuth();
  const isBroadcasting = useLocationStore((state) => state.isBroadcasting);

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
  const currentPosition = useCurrentPosition();

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

  const focusFriendLocation = useLocationStore((state) =>
    params.focusUserId ? state.friendLocations[params.focusUserId] : undefined,
  );

  useEffect(() => {
    LocationManager.requestPermissions();
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

  useEffect(() => {
    if (!focusFriendLocation) return;
    cameraRef.current?.flyTo({
      center: [focusFriendLocation.lon, focusFriendLocation.lat],
      zoom: 15,
      duration: 800,
    });
  }, [focusFriendLocation]);

  function handleStationPress(event: { nativeEvent: { features: GeoJSON.Feature[] } }) {
    const feature = event.nativeEvent.features[0];
    const stationId = feature?.properties?.id as string | undefined;
    if (!stationId) return;
    const station = getStation(stationId);
    if (!station) return;
    setSelectedStation(station);
    sheetRef.current?.snapToIndex(0);
  }

  function handleCenterOnMyLocation() {
    if (!currentPosition) return;
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
      await locationChannelManager.setBroadcasting(!isBroadcasting);
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
      <MapLibreMap style={styles.map} mapStyle={offlineStyle} logo={false} attribution={false}>
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

        <UserLocationPin />
      </MapLibreMap>

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
          style={({ pressed }) => [
            styles.locateButton, 
            pressed && { opacity: 0.7 }
          ]} 
          onPress={handleCenterOnMyLocation}
        >
          <Ionicons name="locate" size={22} color={colors.textPrimary} />
        </Pressable>
      </View>

      <StationDetailSheet
        ref={sheetRef}
        station={selectedStation}
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
    broadcastButton: {
      bottom: 84,
    },
  });
}
