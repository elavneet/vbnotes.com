import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

/** iOS-style segmented control: a quiet track, the current choice raised. `fit` sizes segments to their labels. */
export function Segmented<T extends string>({ value, onChange, options, fit }: {
  value: T; onChange: (v: T) => void; options: [T, string][]; fit?: boolean;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.track, fit && styles.fit, { backgroundColor: t.colors.surface2 }]}>
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(v)}
            style={[styles.item, fit ? styles.itemFit : styles.itemFill, on && { backgroundColor: t.colors.raised }]}
          >
            <Text style={[styles.text, { color: on ? t.colors.text : t.colors.textSecondary, fontWeight: on ? '600' : '500' }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 10, padding: 2 },
  fit: { alignSelf: 'flex-start' },
  item: { alignItems: 'center', justifyContent: 'center', height: 32, borderRadius: 8 },
  itemFill: { flex: 1 },
  itemFit: { paddingHorizontal: 14 },
  text: { fontSize: 14 },
});
