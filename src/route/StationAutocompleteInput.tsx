import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getCompiledGraph, searchStations } from '../engine/graph';
import type { CompiledStation } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import { useSharedStyles } from '../theme/sharedStyles';
import type { ColorTokens, TypeStyle } from '../theme/tokens';

/** Rail geometry, deliberately the same as the itinerary card's: the planner
 * and the result it produces are the same journey, so the origin dot and the
 * destination square should be the same objects in both. */
const RAIL_WIDTH = 22;
const LINE_THICKNESS = 3;

/** The field's own vertical padding, and the row the station name sits on. */
const FIELD_PADDING_V = 14;
const VALUE_HEIGHT = 24;

/**
 * A pixel of overhang at each end of the rail, so consecutive fields' rails
 * overlap across the divider rather than merely touching and leaving a
 * rounding seam. Same trick, same reason, as the itinerary card's RAIL_BLEED.
 *
 * Symmetric, which is also what puts the marker in the right place: the rail's
 * two halves meet at its own centre, an equal overhang keeps that centre on
 * the field's centre, and -- with nothing in the field but the station name
 * between equal paddings -- the field's centre is the name's centre. The
 * marker needs no offset of its own and cannot drift when a font renders a
 * pixel taller than expected.
 */
const RAIL_BLEED = 1;

const ORIGIN_MARKER_SIZE = 14;
const DESTINATION_MARKER_SIZE = 12;

interface Props {
  label: string;
  placeholder: string;
  selectedStation: CompiledStation | null;
  onSelect: (station: CompiledStation) => void;
  onClear: () => void;
  /** Which end of the journey this field is, and so which marker it draws and
   * which half of its rail is blank. */
  marker: 'origin' | 'destination';
  /** Colour of the rail joining the two fields. The caller owns it because it
   * reflects the pair -- a journey with both ends chosen draws a live line. */
  lineColor: string;
}

export function StationAutocompleteInput({
  label,
  placeholder,
  selectedStation,
  onSelect,
  onClear,
  marker,
  lineColor,
}: Props) {
  const { colors, radius, typography } = useTheme();
  const shared = useSharedStyles();
  const styles = useMemo(
    () => createStyles(colors, radius.none, shared, typography),
    [colors, radius, shared, typography],
  );
  const lines = useMemo(() => getCompiledGraph().lines, []);
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  // Set true on a result row's onPressIn (which fires before the TextInput's
  // onBlur resolves) so onBlur can tell "losing focus to a dropdown tap" apart
  // from "losing focus for any other reason" without guessing at a duration.
  const isSelectingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  // The TextInput unmounts while a station is selected (replaced by
  // selectedRow), so tapping it to re-search has to clear the selection first
  // and only focus once the input remounts on the next render.
  const pendingFocusRef = useRef(false);

  const results = useMemo(() => (query.trim() ? searchStations(query, 8) : []), [query]);
  const showDropdown = isFocused && !selectedStation && results.length > 0;

  const dropdownAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showDropdown) {
      dropdownAnim.setValue(0);
      Animated.timing(dropdownAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    }
  }, [showDropdown, dropdownAnim]);

  useEffect(() => {
    if (!selectedStation && pendingFocusRef.current) {
      pendingFocusRef.current = false;
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [selectedStation]);

  function handleEditSelection() {
    pendingFocusRef.current = true;
    onClear();
  }

  return (
    // While the dropdown is open this input must stack above the sibling input
    // below it, or the "To" field paints over the "From" field's results.
    // Bumping both zIndex (iOS) and elevation (Android) does that; the
    // container has no background so the elevation casts no visible shadow.
    <View style={[styles.container, showDropdown && styles.containerActive]}>
      <View style={styles.field}>
        {/* Two halves meeting at the field's centre with the marker laid over
            the join, so the line arrives at the station and leaves it. The
            blank half is the outward-facing one: nothing above the origin,
            nothing below the destination. */}
        <View style={styles.rail} pointerEvents="none">
          <View
            style={[
              styles.railHalf,
              { backgroundColor: marker === 'origin' ? 'transparent' : lineColor },
            ]}
          />
          <View
            style={[
              styles.railHalf,
              { backgroundColor: marker === 'destination' ? 'transparent' : lineColor },
            ]}
          />
          <View style={styles.railMarkerOverlay}>
            <View style={marker === 'origin' ? styles.originMarker : styles.destinationMarker} />
          </View>
        </View>

        <View style={styles.fieldContent}>
          {selectedStation ? (
            <Pressable
              style={({ pressed }) => [styles.selectedRow, pressed && styles.selectedRowPressed]}
              onPress={handleEditSelection}
              accessibilityRole="button"
              accessibilityLabel={`${selectedStation.name}, tap to change ${label.toLowerCase()} station`}
            >
              <Text style={styles.selectedText} numberOfLines={1}>
                {selectedStation.name}
              </Text>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : (
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={placeholder}
              placeholderTextColor={colors.textSecondary}
              // The label used to be printed above the field. With it gone the
              // placeholder carries the meaning visually, and this carries it
              // for a screen reader.
              accessibilityLabel={`${label} station`}
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                if (isSelectingRef.current) {
                  isSelectingRef.current = false;
                  return;
                }
                setIsFocused(false);
              }}
            />
          )}
        </View>
      </View>

      {showDropdown && (
        <Animated.View
          style={[
            styles.dropdown,
            {
              opacity: dropdownAnim,
              transform: [{ translateY: dropdownAnim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
            },
          ]}
        >
          {results.map((station) => {
            const lineColor = lines[station.lines[0]]?.color ?? colors.outline;
            return (
              <Pressable
                key={station.id}
                style={[styles.resultRow, { borderLeftColor: lineColor }]}
                onPressIn={() => {
                  isSelectingRef.current = true;
                }}
                onPress={() => {
                  onSelect(station);
                  setQuery('');
                  setIsFocused(false);
                }}
              >
                <Text style={styles.resultText} numberOfLines={1}>
                  {station.name}
                </Text>
                {station.lines.length > 1 && (
                  <View style={styles.lineSwatchRow}>
                    {station.lines.map((lineId) => (
                      <View
                        key={lineId}
                        style={[styles.lineSwatch, { backgroundColor: lines[lineId]?.color ?? colors.outline }]}
                      />
                    ))}
                  </View>
                )}
              </Pressable>
            );
          })}
        </Animated.View>
      )}
    </View>
  );
}

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  shared: ReturnType<typeof useSharedStyles>,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    container: {
      position: 'relative',
      zIndex: 1,
    },
    containerActive: {
      zIndex: 20,
      elevation: 20,
    },
    field: {
      flexDirection: 'row',
    },
    rail: {
      width: RAIL_WIDTH,
      alignItems: 'center',
      marginTop: -RAIL_BLEED,
      marginBottom: -RAIL_BLEED,
    },
    railHalf: {
      width: LINE_THICKNESS,
      flex: 1,
    },
    /** Absolute, so the halves' length is decided by the row rather than by
     * how tall the marker happens to be. */
    railMarkerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** A ring: the journey starts here but nothing is filled in yet. */
    originMarker: {
      width: ORIGIN_MARKER_SIZE,
      height: ORIGIN_MARKER_SIZE,
      borderRadius: ORIGIN_MARKER_SIZE / 2,
      borderWidth: 2,
      borderColor: colors.textPrimary,
      backgroundColor: colors.surfaceContainerLow,
    },
    /** Solid and square, the same terminus mark the itinerary ends on. */
    destinationMarker: {
      width: DESTINATION_MARKER_SIZE,
      height: DESTINATION_MARKER_SIZE,
      borderRadius: radiusNone,
      backgroundColor: colors.textPrimary,
    },
    // Owns the field's vertical padding rather than the row above it, so the
    // rail can bleed past the row without the padding bleeding with it. Equal
    // top and bottom is load-bearing -- see RAIL_BLEED.
    fieldContent: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
      paddingVertical: FIELD_PADDING_V,
      paddingLeft: 10,
      paddingRight: 12,
    },
    // Borderless and transparent: the card provides the frame, and a box
    // inside a box is what made this section read as a form bolted onto the
    // screen rather than as the first stop of the journey below it.
    input: {
      ...shared.textInput,
      backgroundColor: 'transparent',
      borderWidth: 0,
      paddingHorizontal: 0,
      paddingVertical: 0,
      height: VALUE_HEIGHT,
      // Android pads text by the font's own ascent/descent metrics, which
      // would make this row taller than VALUE_HEIGHT and drift out from under
      // the marker the rail has already committed to.
      includeFontPadding: false,
      textAlignVertical: 'center',
    },
    selectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: VALUE_HEIGHT,
    },
    selectedRowPressed: {
      opacity: 0.7,
    },
    selectedText: {
      ...typography.bodyMd,
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '600',
      flex: 1,
      marginRight: 8,
      includeFontPadding: false,
    },
    dropdown: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: 4,
      backgroundColor: colors.surfaceElevated,
      borderRadius: radiusNone,
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 10,
      elevation: 10,
      maxHeight: 260,
      overflow: 'hidden',
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      borderLeftWidth: 3,
    },
    resultText: {
      color: colors.textPrimary,
      fontSize: 14,
      flex: 1,
      minWidth: 0,
      marginRight: 10,
    },
    lineSwatchRow: {
      flexDirection: 'row',
      gap: 3,
      flexShrink: 0,
    },
    lineSwatch: {
      width: 8,
      height: 8,
      borderRadius: radiusNone,
    },
  });
}
