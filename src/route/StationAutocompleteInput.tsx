import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, type TextInput, View } from 'react-native';
import { getCompiledGraph, searchStations } from '../engine/graph';
import type { CompiledStation } from '../engine/types';
import { useTheme } from '../theme/ThemeProvider';
import { useSharedStyles } from '../theme/sharedStyles';
import type { ColorTokens } from '../theme/tokens';
import { AnimatedTextInput, useFocusAnimation } from '../theme/useFocusAnimation';

interface Props {
  label: string;
  placeholder: string;
  selectedStation: CompiledStation | null;
  onSelect: (station: CompiledStation) => void;
  onClear: () => void;
}

export function StationAutocompleteInput({
  label,
  placeholder,
  selectedStation,
  onSelect,
  onClear,
}: Props) {
  const { colors, radius } = useTheme();
  const shared = useSharedStyles();
  const styles = useMemo(() => createStyles(colors, radius.none, shared), [colors, radius, shared]);
  const lines = useMemo(() => getCompiledGraph().lines, []);
  const focusAnim = useFocusAnimation();
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
      <Text style={styles.label}>{label}</Text>

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
        <AnimatedTextInput
          ref={inputRef}
          style={[styles.input, { borderColor: focusAnim.borderColor, borderWidth: focusAnim.borderWidth }]}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          onFocus={() => {
            setIsFocused(true);
            focusAnim.onFocus();
          }}
          onBlur={() => {
            focusAnim.onBlur();
            if (isSelectingRef.current) {
              isSelectingRef.current = false;
              return;
            }
            setIsFocused(false);
          }}
        />
      )}

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

function createStyles(colors: ColorTokens, radiusNone: number, shared: ReturnType<typeof useSharedStyles>) {
  return StyleSheet.create({
    container: {
      position: 'relative',
      zIndex: 1,
    },
    containerActive: {
      zIndex: 20,
      elevation: 20,
    },
    label: {
      ...shared.sectionLabel,
      marginBottom: 6,
    },
    input: shared.textInput,
    selectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: radiusNone,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    selectedRowPressed: {
      opacity: 0.7,
    },
    selectedText: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '600',
      flex: 1,
      marginRight: 8,
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
