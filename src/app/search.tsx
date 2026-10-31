import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { useNotes, type NoteMeta } from '@/store/notes';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { search, semanticIndex, type SearchResult } from '@/search';
import { NoteRow } from '@/components/NoteRow';
import { Segmented } from '@/components/Segmented';
import { noteRoute } from '@/components/NotesList';
import { useBreakpoint } from '@/utils/useBreakpoint';

type Item = { note: NoteMeta; result?: SearchResult };

export default function SearchScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { isWide } = useBreakpoint();
  const db = useNotes((s) => s.db);
  const revision = useNotes((s) => s.revision);
  const { section, select } = useUi();
  const mode = useSettings((s) => s.searchMode);
  const setMode = useSettings((s) => s.setSearchMode);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const scope = section === 'trash' ? 'notes' : section;

  useEffect(() => semanticIndex.subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => { const id = setTimeout(() => inputRef.current?.focus(), 120); return () => clearTimeout(id); }, []);

  useEffect(() => {
    const term = q.trim();
    let cancelled = false;
    const h = setTimeout(async () => {
      if (!term || !db) { setResults([]); setBusy(false); return; }
      setBusy(true);
      const r = await search(term, db, scope, mode === 'smart');
      if (!cancelled) { setResults(r); setBusy(false); }
    }, term ? (mode === 'smart' ? 220 : 60) : 0);
    return () => { cancelled = true; clearTimeout(h); };
  }, [q, mode, scope, db, revision]);

  const typing = q.trim().length > 0;
  // Before anything is typed, the latest notes are one tap away.
  const items = useMemo<Item[]>(() => {
    if (!db) return [];
    if (!typing) return db.recent(scope, 8).map((note) => ({ note }));
    return results.flatMap((r) => { const note = db.get(r.path); return note ? [{ note, result: r }] : []; });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision`: the index changed, read it again.
  }, [db, typing, scope, results, revision]);

  const emb = semanticIndex.embedderInfo;
  const status = semanticIndex.status;
  // Only said when meaning search is not fully there yet.
  const statusLine =
    mode !== 'smart' ? null
    : status === 'ready' ? (semanticIndex.pending > 0 ? `Reading ${semanticIndex.pending} notes…` : null)
    : status === 'loading' ? ((emb?.progress ?? 0) < 100 ? `Downloading the search model… ${emb?.progress ?? 0}%. Keep VB Notes open.` : 'Getting the model ready…')
    : status === 'unavailable' ? (emb?.reason ?? 'Meaning search is not available here; matching words instead.')
    : status === 'error' ? (emb?.paused ? 'Model download paused; it carries on while VB Notes is open. Matching words for now.' : `Model failed: ${emb?.error ?? ''}`)
    : 'Preparing meaning search…';

  const open = (path: string) => {
    router.back();
    if (isWide) select(path); else setTimeout(() => router.push(noteRoute(path)), 50);
  };

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg, paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 10 }]}>
      <View style={styles.top}>
        <View style={[styles.input, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          <Ionicons name={mode === 'smart' ? 'sparkles' : 'search'} size={18} color={mode === 'smart' ? t.colors.accent : t.colors.textMuted} />
          <TextInput
            ref={inputRef}
            value={q}
            onChangeText={setQ}
            placeholder={mode === 'smart' ? 'Ask: notes about feeling stuck' : 'Search words'}
            placeholderTextColor={t.colors.textMuted}
            selectionColor={t.colors.accent}
            style={[styles.inputText, { color: t.colors.text }]}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search notes"
          />
          {busy ? <ActivityIndicator size="small" color={t.colors.textMuted} /> : null}
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={[styles.cancel, { color: t.colors.text }]}>Cancel</Text>
        </Pressable>
      </View>
      <View style={styles.modes}>
        <Segmented fit value={mode} onChange={setMode} options={[['smart', 'Meaning'], ['keyword', 'Exact words']]} />
      </View>
      {statusLine ? <Text numberOfLines={2} style={[styles.status, { color: t.colors.textMuted }]}>{statusLine}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(it) => it.note.path}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={!typing && items.length ? <Text style={[styles.group, { color: t.colors.textMuted }]}>Recent</Text> : undefined}
        renderItem={({ item }) => (
          <NoteRow
            note={item.note}
            onPress={() => open(item.note.path)}
            snippet={item.result?.snippet}
            badge={item.result?.via === 'smart' ? 'by meaning' : item.result?.via === 'both' ? 'words + meaning' : undefined}
          />
        )}
        ListEmptyComponent={typing && !busy ? <Text style={[styles.empty, { color: t.colors.textMuted }]}>Nothing matches yet.</Text> : undefined}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12 },
  input: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: 25, paddingHorizontal: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth },
  inputText: { flex: 1, fontSize: 17, height: 50 },
  cancel: { fontSize: 17, fontWeight: '500' },
  modes: { paddingHorizontal: 16, paddingTop: 12 },
  status: { fontSize: 13, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 4 },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 22, paddingTop: 14, paddingBottom: 4 },
  empty: { textAlign: 'center', paddingTop: 60, fontSize: 16 },
});
