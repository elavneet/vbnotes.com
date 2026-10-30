import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

/** Slim top bar: actions at the edges, an optional small title in the middle. */
export function Header({ left, right, title, inset = true }: { left?: React.ReactNode; right?: React.ReactNode; title?: string; inset?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: (inset ? insets.top : 0) + 4 }]}>
      <View style={styles.side}>{left}</View>
      <Text numberOfLines={1} style={[styles.title, { color: t.colors.textSecondary }]}>{title}</Text>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 4, minHeight: 52 },
  side: { flexDirection: 'row', alignItems: 'center', minWidth: 88, gap: 4 },
  right: { justifyContent: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600' },
});
