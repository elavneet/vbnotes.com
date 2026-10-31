import React, { memo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme';
import { useNotes, type NoteMeta, type Section } from '@/store/notes';
import { NoteRow } from './NoteRow';

/** The row whose actions are showing; opening another one, or scrolling, closes it. */
let shown: SwipeableMethods | null = null;
export const closeSwipedNote = () => { shown?.close(); shown = null; };

type Props = {
  note: NoteMeta;
  section: Section;
  onPress: (note: NoteMeta) => void;
  onLongPress?: (note: NoteMeta) => void;
  selected?: boolean;
};

type Action = { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; bg: string; fg: string; act: (path: string) => Promise<unknown> };

/**
 * A note in the feed that swipes left to show its actions as tiles, as in Bear: pin and Move to
 * Trash (Restore in Trash). Closed, a rightward swipe stays with the library drawer; open, it
 * closes the row, and so does a tap on the note.
 */
export const SwipeNote = memo(function SwipeNote({ note, section, onPress, ...row }: Props) {
  const t = useTheme();
  const ref = useRef<SwipeableMethods>(null);
  const [open, setOpen] = useState(false);
  const { togglePin, trash, restore } = useNotes.getState();
  const actions: Action[] = section === 'trash'
    ? [{ icon: 'restore', label: 'Restore', bg: t.colors.surface2, fg: t.colors.accent, act: restore }]
    : [
        { icon: note.pinned ? 'pin-off-outline' : 'pin-outline', label: note.pinned ? 'Unpin' : 'Pin to top', bg: t.colors.surface2, fg: t.colors.accent, act: togglePin },
        { icon: 'trash-can-outline', label: 'Move to Trash', bg: t.colors.danger, fg: '#FFFFFF', act: trash },
      ];
  const run = (a: Action) => () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ref.current?.close();
    void a.act(note.path);
  };
  return (
    <Swipeable
      ref={ref}
      friction={1.5}
      overshootRight={false}
      // Closed, a rightward swipe opens the library instead.
      dragOffsetFromLeft={open ? 10 : Number.MAX_SAFE_INTEGER}
      onSwipeableWillOpen={() => {
        if (shown && shown !== ref.current) shown.close();
        shown = ref.current;
        setOpen(true);
      }}
      onSwipeableClose={() => { if (shown === ref.current) shown = null; setOpen(false); }}
      childrenContainerStyle={{ backgroundColor: t.colors.bg }}
      renderRightActions={() => (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              onPress={run(a)}
              style={({ pressed }) => [styles.action, { backgroundColor: a.bg }, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name={a.icon} size={26} color={a.fg} />
            </Pressable>
          ))}
        </View>
      )}
    >
      <NoteRow note={note} onPress={(n) => (open ? ref.current?.close() : onPress(n))} {...row} />
    </Swipeable>
  );
});

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 8, paddingVertical: 4, paddingLeft: 4, paddingRight: 12 },
  action: { width: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
});
