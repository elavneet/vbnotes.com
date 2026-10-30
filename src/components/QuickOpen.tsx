import React, { useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { useNotes, type NoteMeta } from '@/store/notes';
import { formatNoteDate } from '@/utils/dates';

type Hit = { note: NoteMeta; snippet?: string };

/** The part of `text` that matches `q`, in the accent colour. */
function Marked({ text, q, style, color }: { text: string; q: string; style: TextStyle; color: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return (
    <Text numberOfLines={1} style={style}>
      {i < 0 ? text : <>{text.slice(0, i)}<Text style={{ color }}>{text.slice(i, i + q.length)}</Text>{text.slice(i + q.length)}</>}
    </Text>
  );
}

/**
 * Spotlight-style finder behind the dock's search-and-add button. Notes matching what is
 * typed list under the field; the first row always makes a new note titled with it, and
 * Return picks that row.
 */
export function QuickOpen({ visible, onClose, onOpen, onCreate }: {
  visible: boolean; onClose: () => void; onOpen: (path: string) => void; onCreate: (title: string) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const db = useNotes((s) => s.db);
  const revision = useNotes((s) => s.revision);
  const [q, setQ] = useState('');
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const title = q.trim();

  const hits = useMemo<Hit[]>(() => {
    if (!visible || !db) return [];
    if (!title) return db.recent('notes', 8).map((note) => ({ note }));
    // A title match shows the note's opening text; a match in the text shows the words around it.
    const inTitle = (n: NoteMeta) => n.title.toLowerCase().includes(title.toLowerCase());
    return db.search(title, 'notes', 20).map(({ note, snippet }) => ({ note, snippet: inTitle(note) ? undefined : snippet }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision`: the index changed, read it again.
  }, [visible, title, db, revision]);

  // The modal fades out while the note slides in.
  const pick = (act: () => void) => { onClose(); setQ(''); setTimeout(act, 50); };
  const create = () => pick(() => onCreate(title));

  const createRow = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title ? `Create a note titled ${title}` : 'New note'}
        onPress={create}
        style={({ pressed }) => [styles.row, styles.first, { backgroundColor: pressed ? t.colors.surface2 : t.colors.surface }]}
      >
        <View style={[styles.plus, { backgroundColor: t.colors.volt }]}>
          <Ionicons name="add" size={20} color={t.colors.onVolt} />
        </View>
        <Text numberOfLines={1} style={[styles.title, { color: t.colors.text }]}>
          {title ? <>Create <Text style={{ color: t.colors.accent }}>“{title}”</Text></> : 'New note'}
        </Text>
        <Ionicons name="return-down-back" size={18} color={t.colors.textMuted} />
      </Pressable>
      {hits.length ? <Text style={[styles.group, { color: t.colors.textMuted }]}>{title ? 'Notes' : 'Recent'}</Text> : null}
    </>
  );

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} onShow={() => input.current?.focus()} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.scrim }]} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.card, { backgroundColor: t.colors.bg, borderColor: t.colors.border }]}>
          <View style={styles.field}>
            <Ionicons name="search" size={20} color={t.colors.textMuted} />
            <TextInput
              ref={input}
              value={q}
              onChangeText={setQ}
              placeholder="Find or create a note"
              placeholderTextColor={t.colors.textMuted}
              selectionColor={t.colors.accent}
              style={[styles.input, { color: t.colors.text }]}
              returnKeyType="go"
              onSubmitEditing={create}
              submitBehavior="submit"
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel="Find or create a note"
            />
          </View>
          <View style={[styles.sep, { backgroundColor: t.colors.border }]} />
          <FlatList
            data={hits}
            keyExtractor={(h) => h.note.path}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={createRow}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Opens the note"
                onPress={() => pick(() => onOpen(item.note.path))}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.surface }]}
              >
                <Ionicons name="document-text-outline" size={20} color={t.colors.textMuted} style={styles.icon} />
                <View style={styles.text}>
                  <Marked text={item.note.title || 'Untitled'} q={title} style={{ ...styles.title, color: t.colors.text }} color={t.colors.accent} />
                  {item.snippet ?? item.note.preview ? (
                    <Text numberOfLines={1} style={[styles.snippet, { color: t.colors.textSecondary }]}>{item.snippet ?? item.note.preview}</Text>
                  ) : null}
                </View>
                <Text style={[styles.time, { color: t.colors.textMuted }]}>{formatNoteDate(item.note.mtime)}</Text>
              </Pressable>
            )}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 10, paddingBottom: 10, alignItems: 'center' },
  card: {
    width: '100%', maxWidth: 560, flexShrink: 1, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
  },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, height: 56 },
  input: { flex: 1, fontSize: 18, height: 56 },
  sep: { height: StyleSheet.hairlineWidth },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  first: { marginBottom: 2 },
  plus: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 28, textAlign: 'center' },
  text: { flex: 1, gap: 2 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  snippet: { fontSize: 14 },
  time: { fontSize: 13, fontVariant: ['tabular-nums'] },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
});
