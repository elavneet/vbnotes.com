import React from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBridgeState, useCustomKeyboard, type EditorBridge } from '@10play/tentap-editor';
import { useTheme } from '@/theme';

type ToolIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function Tool({ icon, label, onPress, disabled }: { icon: ToolIcon; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={disabled ? t.colors.textMuted : t.colors.textSecondary} />
    </Pressable>
  );
}

/**
 * Bear-style bar over the keyboard: undo, redo, tag and hide on the left; attach and the
 * format keyboard (BIU, then ABC to come back) on the right. Sits under the header on wide screens.
 */
export function EditorToolbar({ editor, compact, keyboardUp, formatOpen, onFormat, onAttach }: {
  editor: EditorBridge; compact?: boolean; keyboardUp?: boolean; formatOpen?: boolean; onFormat: () => void; onAttach?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = useBridgeState(editor) as any;
  const keyboards = useCustomKeyboard(editor);
  const hide = () => {
    if (formatOpen) keyboards.dismiss();
    editor.blur();
    Keyboard.dismiss();
  };
  return (
    <View
      style={[
        styles.bar,
        compact
          ? [styles.compact, { borderColor: t.colors.border }]
          : [styles.pill, { backgroundColor: t.colors.surface, borderColor: t.colors.border, marginBottom: keyboardUp || formatOpen ? 8 : insets.bottom + 4 }],
      ]}
    >
      <Tool icon="undo-variant" label="Undo" disabled={!s.canUndo} onPress={() => editor.undo()} />
      <Tool icon="redo-variant" label="Redo" disabled={!s.canRedo} onPress={() => editor.redo()} />
      {/* Right after a tag, `#` turns into `/`: `#work` → `#work/meetings` without the symbols keyboard. */}
      {s.caretInTag
        ? <Tool icon="slash-forward" label="Nest a tag" onPress={() => editor.insertText('/')} />
        : <Tool icon="pound" label="Tag" onPress={() => editor.insertText('#')} />}
      <Tool icon="keyboard-close-outline" label="Hide keyboard" onPress={hide} />
      <View style={styles.spacer} />
      {onAttach ? <Tool icon="paperclip" label="Add photo or audio" onPress={onAttach} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatOpen ? 'Back to the keyboard' : 'Formatting'}
        onPress={onFormat}
        hitSlop={2}
        style={({ pressed }) => [styles.format, pressed && styles.pressed]}
      >
        {formatOpen ? (
          <Text style={[styles.abc, { color: t.colors.text }]}>ABC</Text>
        ) : (
          <View style={styles.biuRow}>
            <Text style={[styles.biu, styles.b, { color: t.colors.text }]}>B</Text>
            <Text style={[styles.biu, styles.i, { color: t.colors.text }]}>I</Text>
            <Text style={[styles.biu, styles.u, { color: t.colors.text, textDecorationColor: t.colors.accent }]}>U</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 8 },
  pill: {
    marginHorizontal: 10, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  compact: { borderBottomWidth: StyleSheet.hairlineWidth, height: 48 },
  spacer: { flex: 1 },
  tool: { width: 46, height: 44, alignItems: 'center', justifyContent: 'center' },
  format: { minWidth: 56, height: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  biuRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  biu: { fontSize: 19 },
  b: { fontWeight: '800' },
  // A serif italic I, so it reads as a letter and not a slash.
  i: { fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '600', fontSize: 20 },
  u: { fontWeight: '500', textDecorationLine: 'underline' },
  abc: { fontSize: 18, fontWeight: '500', letterSpacing: 0.5 },
  pressed: { opacity: 0.5 },
});
