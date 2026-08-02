import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useMemo } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useTheme } from '../theme/ThemeProvider';
import type { ColorTokens, TypeStyle } from '../theme/tokens';
import { buildInviteMessage, buildInviteUrl } from './inviteLink';

const QR_SIZE = 196;

/** QR modules are drawn black-on-white in both themes rather than in theme
 * colours. An inverted QR (light modules on a dark field) is legal in the spec
 * but a large share of phone cameras and scanner apps won't lock onto one, and
 * a code that fails to scan on the other person's phone is worse than one that
 * clashes with dark mode. */
const QR_FOREGROUND = '#000000';
const QR_BACKGROUND = '#FFFFFF';

/** The share half of adding a friend: your own invite as a scannable code and
 * as a link to send. Both carry the same `public_uid`, and both land the
 * recipient on app/invite/[uid].tsx, which sends you an ordinary pending
 * request -- so nothing here grants access on its own. */
export function InviteSheet({
  visible,
  onClose,
  publicUid,
  displayName,
}: {
  visible: boolean;
  onClose: () => void;
  publicUid: string;
  displayName: string | null;
}) {
  const { colors, radius, typography } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, radius.none, typography),
    [colors, radius, typography],
  );

  const inviteUrl = useMemo(() => buildInviteUrl(publicUid), [publicUid]);

  async function handleShare() {
    await Share.share({ message: buildInviteMessage(displayName, publicUid) });
  }

  // The OS shows its own "Copied" toast on clipboard writes (Android 13+'s
  // system clipboard notification); no app-level feedback needed on top of it.
  async function handleCopy() {
    await Clipboard.setStringAsync(inviteUrl);
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows taps on the card itself -- without this, pressing anything
            inside it bubbles to the backdrop and closes the sheet. */}
        <Pressable style={styles.cardWrapper} onPress={() => {}}>
          <Animated.View
            style={styles.card}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(140)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Your invite</Text>
              <AnimatedPressable
                hitSlop={10}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close invite"
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </AnimatedPressable>
            </View>

            <View style={styles.qrPanel}>
              <QRCode
                value={inviteUrl}
                size={QR_SIZE}
                color={QR_FOREGROUND}
                backgroundColor={QR_BACKGROUND}
              />
            </View>

            <Text style={styles.uid}>ID: {publicUid}</Text>
            <Text style={styles.note}>
              Scan with any camera, or send the link — it works even if they don't have
              Routro yet. Whoever opens it sends you a request, and you choose whether
              to accept.
            </Text>

            <View style={styles.buttonRow}>
              <AnimatedPressable
                style={styles.secondaryButton}
                onPress={handleCopy}
                accessibilityRole="button"
              >
                <Ionicons name="copy-outline" size={15} color={colors.textPrimary} />
                <Text style={styles.secondaryButtonText}>Copy link</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={styles.primaryButton}
                onPress={handleShare}
                accessibilityRole="button"
              >
                <Ionicons name="share-outline" size={15} color={colors.onPrimary} />
                <Text style={styles.primaryButtonText}>Share link</Text>
              </AnimatedPressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(
  colors: ColorTokens,
  radiusNone: number,
  typography: Record<string, TypeStyle>,
) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    cardWrapper: {
      width: '100%',
    },
    card: {
      backgroundColor: colors.surfaceContainerLow,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      padding: 20,
      alignItems: 'center',
      gap: 10,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: 4,
    },
    cardTitle: {
      ...typography.headlineMd,
      fontSize: 18,
      color: colors.textPrimary,
    },
    // White surround as well as white modules: QR decoders need a quiet zone,
    // and against a dark card the code's own edge would be the boundary.
    qrPanel: {
      backgroundColor: QR_BACKGROUND,
      padding: 14,
      borderRadius: radiusNone,
    },
    uid: {
      ...typography.dataSm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    note: {
      ...typography.bodyMd,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 8,
      width: '100%',
      marginTop: 6,
    },
    secondaryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radiusNone,
      paddingVertical: 13,
    },
    secondaryButtonText: {
      ...typography.labelCaps,
      color: colors.textPrimary,
    },
    primaryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      backgroundColor: colors.accent,
      borderRadius: radiusNone,
      paddingVertical: 13,
    },
    primaryButtonText: {
      ...typography.labelCaps,
      color: colors.onPrimary,
    },
    buttonPressed: {
      opacity: 0.85,
    },
  });
}
