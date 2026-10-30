import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import type { IconName } from './IconButton';

export interface SheetAction {
  label: string;
  /** A second, smaller line under the label. */
  detail?: string;
  icon?: IconName;
  destructive?: boolean;
  /** The current choice: ticked. */
  selected?: boolean;
  /** Draw the label in this font family (a font list shows each in its own face). */
  font?: string;
  onPress: () => void;
}

/** A floating card of actions over a dimmed screen, with Cancel kept apart. */
export function ActionSheet({ visible, onClose, actions, title }: { visible: boolean; onClose: () => void; actions: SheetAction[]; title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: t.colors.scrim, paddingBottom: insets.bottom + 10 }]} onPress={onClose} accessibilityLabel="Close menu">
        <View style={styles.wrap}>
          <View style={[styles.card, { backgroundColor: t.colors.surface }]}>
            {title ? <Text numberOfLines={1} style={[styles.title, { color: t.colors.textMuted }]}>{title}</Text> : null}
            {actions.map((a, i) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                accessibilityState={a.selected !== undefined ? { selected: a.selected } : undefined}
                onPress={() => { onClose(); setTimeout(a.onPress, 50); }}
                style={({ pressed }) => [styles.item, (i > 0 || title) && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border }, pressed && { backgroundColor: t.colors.surface2 }]}
              >
                {a.icon ? <Ionicons name={a.icon} size={20} color={a.destructive ? t.colors.danger : t.colors.textSecondary} /> : null}
                <View style={styles.text}>
                  <Text style={[styles.label, { color: a.destructive ? t.colors.danger : t.colors.text, fontFamily: a.font }]}>{a.label}</Text>
                  {a.detail ? <Text style={[styles.detail, { color: t.colors.textMuted }]}>{a.detail}</Text> : null}
                </View>
                {a.selected ? <Ionicons name="checkmark" size={20} color={t.name === 'dark' ? t.colors.volt : t.colors.accent} /> : null}
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [styles.cancel, { backgroundColor: pressed ? t.colors.surface2 : t.colors.surface }]}>
            <Text style={[styles.cancelText, { color: t.colors.text }]}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 10 },
  wrap: { width: '100%', maxWidth: 480, gap: 8 },
  card: { borderRadius: 20, overflow: 'hidden' },
  title: { fontSize: 13, fontWeight: '500', textAlign: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 54 },
  text: { flex: 1, paddingVertical: 10, gap: 2 },
  label: { fontSize: 17 },
  detail: { fontSize: 13, lineHeight: 18 },
  cancel: { borderRadius: 20, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 17, fontWeight: '600' },
});
