import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import type { SheetAction } from './ActionSheet';

/** A menu that drops from the top-right button, as in Bear. Groups are split by a hairline. */
export function MenuPopover({ visible, onClose, groups }: { visible: boolean; onClose: () => void; groups: SheetAction[][] }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[styles.card, { top: insets.top + 4, backgroundColor: t.colors.surface2, borderColor: t.colors.border }]}>
        {groups.map((group, gi) => (
          <View key={gi} style={gi > 0 ? [styles.group, { borderTopColor: t.colors.border }] : undefined}>
            {group.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="menuitem"
                onPress={() => { onClose(); setTimeout(a.onPress, 50); }}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.colors.raised }]}
              >
                {a.icon ? <Ionicons name={a.icon} size={21} color={a.destructive ? t.colors.danger : t.colors.text} /> : null}
                <Text style={[styles.label, { color: a.destructive ? t.colors.danger : t.colors.text }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute', right: 10, minWidth: 250, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
  },
  group: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6, paddingTop: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 48, paddingHorizontal: 20 },
  label: { fontSize: 17 },
});
