import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '@/theme';
import { tagHue } from '@/utils/tags';

/** A tag in its own colour, or a plain `label` on a neutral chip. */
export function TagChip({ tag, label }: { tag?: string; label?: string }) {
  const t = useTheme();
  const hue = tag ? t.tags[tagHue(tag)] : { bg: t.colors.surface, fg: t.colors.textSecondary };
  return <Text numberOfLines={1} style={[styles.chip, { backgroundColor: hue.bg, color: hue.fg }]}>{label ?? `#${tag}`}</Text>;
}

const styles = StyleSheet.create({
  chip: { fontSize: 12, fontWeight: '500', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, overflow: 'hidden', maxWidth: 140 },
});
