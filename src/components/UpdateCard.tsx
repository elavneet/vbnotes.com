import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { useAppUpdate } from '@/store/appUpdate';

/** A small card over the dock when a downloaded update is waiting: Apply restarts into it. */
export function UpdateCard({ bottom }: { bottom: number }) {
  const t = useTheme();
  const ready = useAppUpdate((s) => s.ready);
  const { apply, dismiss } = useAppUpdate.getState();
  if (!ready) return null;
  return (
    <Animated.View
      entering={FadeInDown.duration(240)}
      exiting={FadeOutDown.duration(180)}
      accessibilityRole="alert"
      style={[styles.card, { bottom, backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
    >
      <View style={[styles.badge, { backgroundColor: t.colors.volt }]}>
        <Ionicons name="arrow-up" size={17} color={t.colors.onVolt} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: t.colors.text }]}>Update ready</Text>
        <Text numberOfLines={1} style={[styles.sub, { color: t.colors.textMuted }]}>One quick restart</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={dismiss} hitSlop={8} style={({ pressed }) => [styles.later, pressed && styles.pressed]}>
        <Text style={[styles.laterText, { color: t.colors.textSecondary }]}>Later</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Apply update"
        onPress={apply}
        style={({ pressed }) => [styles.apply, { backgroundColor: t.colors.volt }, pressed && styles.pressed]}
      >
        <Text style={[styles.applyText, { color: t.colors.onVolt }]}>Apply</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute', left: 14, right: 14, alignSelf: 'center', maxWidth: 560,
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12, paddingRight: 8, paddingVertical: 8,
    borderRadius: 22, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 13 },
  later: { paddingHorizontal: 8, paddingVertical: 8 },
  laterText: { fontSize: 15, fontWeight: '500' },
  apply: { height: 36, borderRadius: 18, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
