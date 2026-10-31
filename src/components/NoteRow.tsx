import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import type { NoteMeta } from '@/store/notes';
import { formatNoteDate } from '@/utils/dates';
import { TagChip } from './TagChip';

type Props = {
  note: NoteMeta;
  onPress: (note: NoteMeta) => void;
  onLongPress?: (note: NoteMeta) => void;
  selected?: boolean;
  snippet?: string;
  badge?: string;
};

/** One note in a list: title and time, two lines of text, then its tags. */
export const NoteRow = memo(function NoteRow({ note, onPress, onLongPress, selected, snippet, badge }: Props) {
  const t = useTheme();
  const text = snippet ?? note.preview;
  const tags = note.tags.slice(0, 4);
  return (
    <Pressable
      onPress={() => onPress(note)}
      onLongPress={onLongPress ? () => onLongPress(note) : undefined}
      accessibilityRole="button"
      accessibilityHint="Opens the note"
      style={({ pressed }) => [styles.row, (selected || pressed) && { backgroundColor: selected ? t.colors.surface2 : t.colors.surface }]}
    >
      <View style={styles.titleRow}>
        {note.pinned ? <MaterialCommunityIcons name="pin-outline" size={16} color={t.colors.accent} /> : null}
        <Text numberOfLines={1} style={[styles.title, { color: t.colors.text }]}>{note.title || 'Untitled'}</Text>
        <Text style={[styles.time, { color: t.colors.textMuted }]}>{formatNoteDate(note.mtime)}</Text>
      </View>
      {text ? <Text numberOfLines={2} style={[styles.preview, { color: t.colors.textSecondary }]}>{text}</Text> : null}
      {tags.length || badge ? (
        <View style={styles.meta}>
          {badge ? <TagChip label={badge} /> : null}
          {tags.map((tag) => <TagChip key={tag} tag={tag} />)}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { marginHorizontal: 8, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  time: { fontSize: 13, fontVariant: ['tabular-nums'] },
  preview: { fontSize: 15, lineHeight: 21, marginTop: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 9 },
});
