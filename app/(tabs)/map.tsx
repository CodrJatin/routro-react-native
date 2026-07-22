import { Ionicons } from '@expo/vector-icons';
import type BottomSheet from '@gorhom/bottom-sheet';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  LocationManager,
  Map as MapLibreMap,
  UserLocation,
  useCurrentPosition,
} from '@maplibre/maplibre-react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import tracksGeoJSON from '../../assets/data/tracks.json';
import { useAuth } from '../../src/auth/AuthProvider';
import { getStation } from '../../src/engine/graph';
import type { CompiledStation, RouteMode } from '../../src/engine/types';
import { FriendsLayer } from '../../src/map/FriendsLayer';
import { DEFAULT_ZOOM, DELHI_CENTER, emptyOfflineStyle } from '../../src/map/mapStyle';
import { PulsingDot } from '../../src/map/PulsingDot';
import { buildRoutePolylineGeoJSON, computeBounds } from '../../src/map/routePolyline';
import { buildStationsGeoJSON } from '../../src/map/stationsGeoJSON';
import { StationDetailSheet } from '../../src/map/StationDetailSheet';
import { locationChannelManager } from '../../src/realtime/locationChannel';
import { useLocationStore } from '../../src/realtime/locationStore';
import { colors } from '../../src/theme/colors';

export default function MapScreen() {
  const cameraRef = useRef<CameraRef>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const [selectedStation, setSelectedStation] = useState<CompiledStation | null>(null);

  const { isConfigured, session } = useAuth();
  const isBroadcasting = useLocationStore((state) => state.isBroadcasting);

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

  function handleToggleBroadcast() {
    locationChannelManager.setBroadcasting(!isBroadcasting);
  }

  return (
    <View style={styles.container}>
      <MapLibreMap style={styles.map} mapStyle={emptyOfflineStyle} logo={false} attribution={false}>
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
            paint={{
              'circle-radius': ['case', ['get', 'isInterchange'], 6, 4],
              'circle-color': colors.background,
              'circle-stroke-width': ['case', ['get', 'isInterchange'], 3, 2],
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

        <UserLocation animated accuracy>
          <PulsingDot />
        </UserLocation>
      </MapLibreMap>

      {isConfigured && session && (
        <Pressable
          style={[styles.locateButton, styles.broadcastButton, isBroadcasting && styles.broadcastButtonActive]}
          onPress={handleToggleBroadcast}
        >
          <Ionicons
            name={isBroadcasting ? 'radio' : 'radio-outline'}
            size={20}
            color={isBroadcasting ? colors.background : colors.textPrimary}
          />
        </Pressable>
      )}

      <Pressable style={styles.locateButton} onPress={handleCenterOnMyLocation}>
        <Ionicons name="locate" size={22} color={colors.textPrimary} />
      </Pressable>

      <StationDetailSheet
        ref={sheetRef}
        station={selectedStation}
        onClose={() => setSelectedStation(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    flex: 1,
  },
  locateButton: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
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
  broadcastButtonActive: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
});
