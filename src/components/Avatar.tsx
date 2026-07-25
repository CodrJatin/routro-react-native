import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

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
