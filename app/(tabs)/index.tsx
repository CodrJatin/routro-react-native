import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { findRoute, getCompiledGraph } from '../../src/engine/graph';
import type { CompiledStation, RouteMode } from '../../src/engine/types';
import { ItineraryList } from '../../src/route/ItineraryList';
import { RouteModeToggle } from '../../src/route/RouteModeToggle';
import { RouteSummaryCard } from '../../src/route/RouteSummaryCard';
import { StationAutocompleteInput } from '../../src/route/StationAutocompleteInput';
import { colors } from '../../src/theme/colors';

export default function RouteScreen() {
  const router = useRouter();
  const [origin, setOrigin] = useState<CompiledStation | null>(null);
  const [destination, setDestination] = useState<CompiledStation | null>(null);
  const [mode, setMode] = useState<RouteMode>('fastest');

  const sameStation = !!origin && !!destination && origin.id === destination.id;

  const route = useMemo(() => {
    if (!origin || !destination || sameStation) return null;
    return findRoute(origin.id, destination.id, mode);
  }, [origin, destination, mode, sameStation]);

  const lines = useMemo(() => getCompiledGraph().lines, []);

  function handleSwap() {
    setOrigin(destination);
    setDestination(origin);
  }

  function handleGoToMap() {
    if (!origin || !destination) return;
    router.push({
      pathname: '/(tabs)/map',
      params: { originId: origin.id, destinationId: destination.id, mode },
    });
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

        <RouteModeToggle mode={mode} onChange={setMode} />

        {sameStation && (
          <Text style={styles.notice}>Origin and destination are the same station.</Text>
        )}
        {origin && destination && !sameStation && !route && (
          <Text style={styles.notice}>No route could be found between these stations.</Text>
        )}

        {route && (
          <>
            <RouteSummaryCard route={route} onGoToMap={handleGoToMap} />
            <ItineraryList route={route} lines={lines} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  inputsCard: {
    gap: 8,
  },
  swapButton: {
    alignSelf: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
});
