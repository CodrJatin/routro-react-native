import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { deliverMockMeetMessage } from '../friends/meetController';
import { useMeetStore } from '../friends/meetStore';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import {
  buildMockMeetRequest,
  MOCK_FRIEND_ID,
  mockSecondsToStation,
  useMockFriendStore,
} from './mockFriend';

/**
 * ============================================================================
 * TEMPORARY DEV FIXTURE -- DELETE BEFORE SHIPPING
 * ============================================================================
 *
 * Switches a fake journey-sharing friend on and walks them along their route,
 * so the sharing UI can be looked at on one phone with one account.
 *
 * Renders nothing outside `__DEV__`. See src/dev/mockFriend.ts for what it
 * fabricates and how to remove the whole thing.
 */
export function MockFriendPanel() {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );

  const isActive = useMockFriendStore((state) => state.isActive);
  const stationIndex = useMockFriendStore((state) => state.stationIndex);
  const stationCount = useMockFriendStore((state) => state.stationCount);
  const stationName = useMockFriendStore((state) => state.stationName);
  const destinationName = useMockFriendStore((state) => state.destinationName);
  const isMirroringSelfRoute = useMockFriendStore((state) => state.isMirroringSelfRoute);
  const enable = useMockFriendStore((state) => state.enable);
  const disable = useMockFriendStore((state) => state.disable);
  const moveBy = useMockFriendStore((state) => state.moveBy);
  const outgoing = useMeetStore((state) => state.outgoing[MOCK_FRIEND_ID] ?? null);
  const isAwaitingAnswer = outgoing?.outcome === 'pending';

  if (!__DEV__) return null;

  /** The fake friend asking to meet, through the same entry point a real
   * request arrives by -- cooldown guard, notification and all. */
  function askToMeet() {
    const request = buildMockMeetRequest();
    if (!request) return;
    deliverMockMeetMessage(MOCK_FRIEND_ID, request.message);
  }

  /** The fake friend answering a request the user sent them. */
  function answer(kind: 'accept' | 'decline') {
    if (!outgoing || outgoing.outcome !== 'pending') return;
    deliverMockMeetMessage(MOCK_FRIEND_ID, {
      kind,
      id: outgoing.id,
      stationId: outgoing.stationId,
      etaSeconds: kind === 'accept' ? mockSecondsToStation(outgoing.stationId) : null,
    });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.note}>
        Fakes a friend who is sharing a live journey. They travel your current route in reverse, so
        your routes cross and there is somewhere to meet — plan a route first, then switch this on.
      </Text>

      {!isActive ? (
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={enable}
        >
          <Ionicons name="person-add" size={16} color={colors.onPrimary} />
          <Text style={styles.primaryText}>Add mock friend</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.readout}>
            <Text style={styles.readoutLine}>
              At <Text style={styles.strong}>{stationName ?? '—'}</Text> ({stationIndex + 1}/
              {stationCount})
            </Text>
            <Text style={styles.readoutLine}>
              Heading to <Text style={styles.strong}>{destinationName ?? '—'}</Text>
            </Text>
            {!isMirroringSelfRoute && (
              <Text style={styles.warn}>
                You had no route planned, so they are on a fallback Blue Line trip. Plan a route and
                re-add them to see shared stations to meet at.
              </Text>
            )}
          </View>

          <View style={styles.row}>
            <Pressable
              style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
              onPress={() => moveBy(-1)}
              disabled={stationIndex === 0}
            >
              <Ionicons name="chevron-back" size={16} color={colors.textPrimary} />
              <Text style={styles.stepText}>Back</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
              onPress={() => moveBy(1)}
              disabled={stationIndex >= stationCount - 1}
            >
              <Text style={styles.stepText}>Next stop</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textPrimary} />
            </Pressable>
          </View>

          {/* Both directions of the meet flow, on one phone. The request goes
              in through the same handler the pair channel uses, so the
              once-a-minute guard applies here too -- a second tap inside a
              minute is ignored, and says so in the log. */}
          {isAwaitingAnswer ? (
            <View style={styles.row}>
              <Pressable
                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                onPress={() => answer('decline')}
              >
                <Text style={styles.stepText}>They decline</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
                onPress={() => answer('accept')}
              >
                <Text style={styles.stepText}>They accept</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
              onPress={askToMeet}
            >
              <Ionicons name="hand-left-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.stepText}>They ask to meet</Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
            onPress={disable}
          >
            <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
            <Text style={styles.removeText}>Remove mock friend</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      padding: 14,
      gap: 12,
    },
    note: {
      ...typography.bodyMd,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    readout: {
      gap: 3,
    },
    readoutLine: {
      ...typography.dataSm,
      color: colors.textSecondary,
    },
    strong: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
    warn: {
      ...typography.bodyMd,
      fontSize: 12,
      lineHeight: 17,
      color: colors.danger,
      marginTop: 4,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    primaryButton: {
      height: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
    },
    primaryText: {
      ...typography.bodyMd,
      fontSize: 14,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    stepButton: {
      flex: 1,
      height: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: colors.outline,
      borderRadius: radiusNone,
      backgroundColor: colors.surface,
    },
    stepText: {
      ...typography.bodyMd,
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    removeButton: {
      height: 38,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
    },
    removeText: {
      ...typography.bodyMd,
      fontSize: 13,
      fontWeight: '700',
      color: colors.danger,
    },
    pressed: {
      opacity: 0.75,
    },
  });
}
