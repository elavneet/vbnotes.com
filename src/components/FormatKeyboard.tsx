import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { CustomKeyboardExtension, useBridgeState, type CustomKeyboardComponentProps, type EditorBridge } from '@10play/tentap-editor';
import { useTheme } from '@/theme';

type KeyIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** What the format keyboard needs from the note screen. The keyboard renders inside it, so context reaches. */
export const FormatActions = createContext<{ attach: () => void; record: () => void }>({ attach: () => {}, record: () => {} });

const PAD = 6;
const GAP = 6;

/** One key. `alt` keys (caret moves, space, return, delete) sit darker, as on the system keyboard. */
function Key({ icon, label, onPress, onLongPress, alt, active, disabled, more, repeat }: {
  icon: KeyIcon; label: string; onPress: () => void; onLongPress?: () => void;
  alt?: boolean; active?: boolean; disabled?: boolean; more?: boolean; repeat?: boolean;
}) {
  const t = useTheme();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stop, []);
  // A repeating key acts on touch and keeps going while held, like the system delete key.
  const startRepeat = () => {
    onPress();
    const tick = (delay: number) => { timer.current = setTimeout(() => { onPress(); tick(70); }, delay); };
    tick(420);
  };
  const bg = active ? t.colors.volt : alt ? t.colors.kbAlt : t.colors.kbKey;
  const fg = disabled ? t.colors.textMuted : active ? t.colors.onVolt : t.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPressIn={() => { void Haptics.selectionAsync(); if (repeat) startRepeat(); }}
      onPressOut={stop}
      onPress={repeat ? undefined : onPress}
      onLongPress={onLongPress}
      delayLongPress={380}
      style={({ pressed }) => [styles.key, { backgroundColor: bg }, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name={icon} size={25} color={fg} />
      {more ? <MaterialCommunityIcons name="menu-down" size={16} color={t.colors.textMuted} style={styles.more} /> : null}
    </Pressable>
  );
}

const HEADING_ICONS: KeyIcon[] = ['format-header-1', 'format-header-1', 'format-header-2', 'format-header-3'];

function today(withTime: boolean): string {
  const d = new Date();
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return withTime ? `${date}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : date;
}

/** Bear-style format keyboard: takes the system keyboard's place, four rows of six keys. */
function FormatPanel({ editor, height }: { editor: EditorBridge; height: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { attach, record } = useContext(FormatActions);
  const s = useBridgeState(editor) as any;
  const level = (s.headingLevel as number | undefined) ?? 0;
  const task = !!s.isTaskListActive;
  const canSink = task ? s.canSinkTaskListItem : s.canSink;
  const canLift = task ? s.canLiftTaskListItem : s.canLift;
  // Body → H1 → H2 → H3 → body.
  const cycleHeading = () => {
    if (!level) editor.toggleHeading(1);
    else if (level >= 3) editor.toggleHeading(level as 1 | 2 | 3);
    else editor.toggleHeading((level + 1) as 1 | 2 | 3);
  };
  const addLink = () => {
    const empty = s.selection?.from === s.selection?.to;
    Alert.prompt('Add link', empty ? 'The address goes in at the caret.' : 'The selected text links to it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add',
        onPress: (value?: string) => {
          const url = value?.trim();
          if (!url || url === 'https://') return;
          if (empty) editor.insertText(url); else editor.setLink(url);
        },
      },
    ], 'plain-text', s.activeLink ?? 'https://', 'url');
  };
  const bottom = Math.max(insets.bottom, 12);

  return (
    <View style={[styles.panel, { height, paddingBottom: bottom, backgroundColor: t.colors.kbBg }]}>
      <View style={styles.row}>
        <Key alt icon="format-vertical-align-top" label="Go to the top" onPress={() => editor.run('start')} />
        <Key icon="camera-outline" label="Add photo or audio" more onPress={attach} />
        <Key icon="microphone-outline" label="Record audio" onPress={record} />
        <Key icon="table" label="Insert table" onPress={() => editor.run('table')} />
        <Key icon="calendar-blank-outline" label="Insert today's date" more onPress={() => editor.insertText(today(false))} onLongPress={() => editor.insertText(today(true))} />
        <Key icon="format-quote-close" label="Quote" active={s.isBlockquoteActive} onPress={() => editor.toggleBlockquote()} />
      </View>
      <View style={styles.row}>
        <Key alt icon="format-vertical-align-bottom" label="Go to the end" onPress={() => editor.run('end')} />
        <Key icon={HEADING_ICONS[Math.min(level, 3)]} label="Heading" more active={!!level} onPress={cycleHeading} onLongPress={() => { if (level) editor.toggleHeading(level as 1 | 2 | 3); }} />
        <Key icon="format-bold" label="Bold" active={s.isBoldActive} onPress={() => editor.toggleBold()} />
        <Key icon="format-italic" label="Italic" active={s.isItalicActive} onPress={() => editor.toggleItalic()} />
        <Key icon="format-underline" label="Underline" active={s.isUnderlineActive} onPress={() => editor.toggleUnderline()} />
        <Key icon="format-strikethrough-variant" label="Strikethrough" active={s.isStrikeActive} onPress={() => editor.toggleStrike()} />
      </View>
      <View style={styles.row}>
        <Key alt icon="format-indent-decrease" label="Outdent" disabled={!canLift} onPress={() => (task ? editor.liftTaskListItem() : editor.lift())} />
        <Key icon="format-list-bulleted" label="Bullet list" active={s.isBulletListActive} onPress={() => editor.toggleBulletList()} />
        <Key icon="marker" label="Highlight" active={s.isHighlightActive} onPress={() => editor.toggleHighlight(t.colors.volt)} />
        <Key icon="code-tags" label="Code, hold for a code block" more active={s.isCodeActive} onPress={() => editor.toggleCode()} onLongPress={() => editor.run('codeBlock')} />
        <Key icon="link-variant" label="Link" active={s.isLinkActive} onPress={addLink} />
        <Key alt repeat icon="backspace-outline" label="Delete" onPress={() => editor.run('backspace')} />
      </View>
      <View style={styles.row}>
        <Key alt icon="format-indent-increase" label="Indent" disabled={!canSink} onPress={() => (task ? editor.sinkTaskListItem() : editor.sink())} />
        <Key icon="checkbox-marked-outline" label="Checklist" active={task} onPress={() => editor.toggleTaskList()} />
        <Key icon="minus" label="Divider line" onPress={() => editor.run('rule')} />
        <Key icon="format-list-numbered" label="Numbered list" active={s.isOrderedListActive} onPress={() => editor.toggleOrderedList()} />
        <Key alt repeat icon="keyboard-space" label="Space" onPress={() => editor.insertText(' ')} />
        <Key alt icon="keyboard-return" label="Return" onPress={() => editor.run('enter')} />
      </View>
    </View>
  );
}

function FormatKeyboardComp({ editor, keyboardHeight }: Partial<CustomKeyboardComponentProps>) {
  return editor ? <FormatPanel editor={editor} height={keyboardHeight ?? 300} /> : null;
}

export const FormatKeyboard = new CustomKeyboardExtension('vbnotes.format', FormatKeyboardComp);

const styles = StyleSheet.create({
  panel: { paddingTop: PAD + 2, paddingHorizontal: PAD, gap: GAP },
  row: { flex: 1, flexDirection: 'row', gap: GAP },
  key: { flex: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  more: { position: 'absolute', right: 3, bottom: 1 },
  pressed: { opacity: 0.6 },
});
