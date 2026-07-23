import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { searchStations } from '../engine/graph';
import type { CompiledStation } from '../engine/types';
import { colors } from '../theme/colors';
import { shared } from '../theme/sharedStyles';

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
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  // Set true on a result row's onPressIn (which fires before the TextInput's
  // onBlur resolves) so onBlur can tell "losing focus to a dropdown tap" apart
  // from "losing focus for any other reason" without guessing at a duration.
  const isSelectingRef = useRef(false);

  const results = useMemo(() => (query.trim() ? searchStations(query, 8) : []), [query]);
  const showDropdown = isFocused && !selectedStation && results.length > 0;

  return (
    // While the dropdown is open this input must stack above the sibling input
    // below it, or the "To" field paints over the "From" field's results.
    // Bumping both zIndex (iOS) and elevation (Android) does that; the
    // container has no background so the elevation casts no visible shadow.
    <View style={[styles.container, showDropdown && styles.containerActive]}>
      <Text style={styles.label}>{label}</Text>

      {selectedStation ? (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedText} numberOfLines={1}>
            {selectedStation.name}
          </Text>
          <Pressable onPress={onClear} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : (
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
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

      {showDropdown && (
        <View style={styles.dropdown}>
          {results.map((station) => (
            <Pressable
              key={station.id}
              style={styles.resultRow}
              onPressIn={() => {
                isSelectingRef.current = true;
              }}
              onPress={() => {
                onSelect(station);
                setQuery('');
                setIsFocused(false);
              }}
            >
              <Text style={styles.resultText}>{station.name}</Text>
              {station.lines.length > 1 && <Text style={styles.resultBadge}>Interchange</Text>}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    borderRadius: 10,
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
  },
  resultText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  resultBadge: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
});
