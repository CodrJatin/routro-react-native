import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * `expo-image`, not react-native's `Image`, and the difference is the cache.
 *
 * Avatars are remote URLs from the OAuth provider that never change and are
 * drawn constantly -- on every friend pin, in the focus stack, on the Friends
 * tab, several of them at once, remounting as the map redraws. The RN loader
 * keeps them in memory only, so each of those remounts could reach for the
 * network again, on a phone whose connection is the thing this whole app is
 * fighting. `cachePolicy="memory-disk"` makes the second request the last one,
 * across launches as well as across mounts.
 */

export function Avatar({
  label,
  imageUrl,
  size = 40,
}: {
  label: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const { colors } = useTheme();
  // Reset per URL so a fresh (or edited) URL always gets its own attempt
  // instead of staying stuck on a previous failure.
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    setHasError(false);
  }, [imageUrl]);

  if (imageUrl && !hasError) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
        cachePolicy="memory-disk"
        contentFit="cover"
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{label[0]?.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
