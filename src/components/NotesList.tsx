import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme';
import { UNTAGGED, useNoteList, useNotes, type NoteMeta } from '@/store/notes';
import { useUi } from '@/store/ui';
import { formatTag, tagHue } from '@/utils/tags';
import { tagIconOf } from '@/utils/tagIcons';
import { dateGroup } from '@/utils/dates';
import { NoteRow } from './NoteRow';
import type { IconName } from './IconButton';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { QuickOpen } from './QuickOpen';

export const SECTION_TITLES = { notes: 'Notes', archive: 'Archive', trash: 'Trash' } as const;

export function noteRoute(path: string) { return `/note/${encodeURIComponent(path)}` as const; }

type Group = { title: string; data: NoteMeta[] };

/** Rows read from the index at a time; scrolling near the end reads the next ones. */
const PAGE = 200;

/** Pinned first, then Today, Yesterday, This week and one group per month. */
function groupNotes(list: NoteMeta[]): Group[] {
  const out: Group[] = [];
  const pinned = list.filter((n) => n.pinned);
  if (pinned.length) out.push({ title: 'Pinned', data: pinned });
  const now = Date.now();
  for (const n of list) {
    if (n.pinned) continue;
    const title = dateGroup(n.mtime, now);
    const last = out[out.length - 1];
    if (last && last.title === title) last.data.push(n); else out.push({ title, data: [n] });
  }
  return out;
}

/** The notes feed: notes grouped by time under a bare top, and the dock (library, search, find or create) at the thumb. */
export function NotesList({ wide, onLibrary }: { wide: boolean; onLibrary?: () => void }) {
  const t = useTheme();
  const scanned = useNotes((s) => s.scanned);
  const { section, tag, selectedPath, select } = useUi();
  const filter = `${section}:${tag}`;
  const [page, setPage] = useState({ filter, limit: PAGE });
  const limit = page.filter === filter ? page.limit : PAGE;
  const list = useNoteList(section, tag, limit);
  const more = useCallback(() => { if (list.length >= limit) setPage({ filter, limit: limit + PAGE }); }, [list.length, limit, filter]);
  const groups = useMemo(() => groupNotes(list), [list]);
  const [sheetFor, setSheetFor] = useState<NoteMeta | null>(null);
  const [finder, setFinder] = useState(false);
  const { createNote, togglePin, trash, archive, restore, deleteForever } = useNotes.getState();


  const openPath = useCallback((path: string) => {
    if (wide) select(path); else router.push(noteRoute(path));
  }, [wide, select]);
  const open = useCallback((n: NoteMeta) => openPath(n.path), [openPath]);

  const onCreate = useCallback(async (title: string) => {
    // A note made while a tag is picked starts with that tag under the title. A titled note ends
    // in an empty line for the caret (the editor reads the last blank pair as an empty paragraph).
    const tagLine = tag && tag !== UNTAGGED ? formatTag(tag) : '';
    const initial = title ? `# ${title}\n\n${tagLine ? `${tagLine}\n\n` : ''}` : tagLine ? `# \n\n${tagLine} ` : '';
    const path = await createNote(initial);
    if (wide) select(path); else router.push({ pathname: '/note/[id]', params: { id: encodeURIComponent(path), new: '1' } });
  }, [createNote, tag, wide, select]);

  const onFind = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFinder(true);
  }, []);

  const actions: SheetAction[] = sheetFor ? (
    section === 'trash'
      ? [
          { label: 'Restore', icon: 'arrow-undo-outline', onPress: () => void restore(sheetFor.path) },
          { label: 'Delete forever', icon: 'trash-outline', destructive: true, onPress: () => void deleteForever(sheetFor.path) },
        ]
      : [
          { label: sheetFor.pinned ? 'Unpin' : 'Pin to top', icon: 'pin-outline', onPress: () => void togglePin(sheetFor.path) },
          section === 'archive'
            ? { label: 'Move to Notes', icon: 'arrow-undo-outline', onPress: () => void restore(sheetFor.path) }
            : { label: 'Archive', icon: 'archive-outline', onPress: () => void archive(sheetFor.path) },
          { label: 'Move to Trash', icon: 'trash-outline', destructive: true, onPress: () => void trash(sheetFor.path) },
        ]
  ) : [];

  const renderItem = useCallback(({ item }: { item: NoteMeta }) => (
    <NoteRow note={item} onPress={open} onLongPress={setSheetFor} selected={wide && selectedPath === item.path} />
  ), [open, wide, selectedPath]);

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      <SectionList
        sections={groups}
        keyExtractor={(n) => n.path}
        renderItem={renderItem}
        renderSectionHeader={({ section: g }) => <Text style={[styles.group, { color: t.colors.textMuted }]}>{g.title}</Text>}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={<View style={{ height: insets.top }} />}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        windowSize={9}
        onEndReached={more}
        onEndReachedThreshold={2}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name={section === 'trash' ? 'trash-outline' : 'sparkles-outline'} size={30} color={t.colors.textMuted} />
            <Text style={[styles.emptyText, { color: t.colors.textMuted }]}>
              {!scanned ? 'Opening your notes…' : tag === UNTAGGED ? 'Every note has a tag.' : tag ? `Nothing tagged #${tag} yet.` : section === 'notes' ? 'A blank page.\nWrite the first note.' : `${SECTION_TITLES[section]} is empty.`}
            </Text>
          </View>
        }
      />
      <Dock onLibrary={onLibrary} onFind={onFind} />
      <ActionSheet visible={!!sheetFor} onClose={() => setSheetFor(null)} actions={actions} title={sheetFor?.title} />
      <QuickOpen visible={finder} onClose={() => setFinder(false)} onOpen={openPath} onCreate={(title) => void onCreate(title)} />
    </View>
  );
}

/** Opens the library. Shows what the feed is filtered to, so the list itself needs no title. */
function LibraryButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const { section, tag } = useUi();
  const tagIcon = useNotes((s) => (tag && tag !== UNTAGGED ? tagIconOf(s.tagIcons, tag) : null));
  const filter: { icon: IconName; label: string; color: string } | null =
    tagIcon ? { icon: tagIcon, label: tag.split('/').pop()!, color: t.tags[tagHue(tag)].fg }
    : tag === UNTAGGED ? { icon: 'pricetag-outline', label: 'Untagged', color: t.colors.textSecondary }
    : section !== 'notes' ? { icon: section === 'trash' ? 'trash-outline' : 'archive-outline', label: SECTION_TITLES[section], color: t.colors.textSecondary }
    : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={filter ? `${filter.label}, open library` : 'Open library'}
      onPress={onPress}
      style={({ pressed }) => [styles.library, filter && styles.libraryWide, { backgroundColor: t.colors.surface, borderColor: t.colors.border }, pressed && styles.pressed]}
    >
      <Ionicons name={filter?.icon ?? 'menu'} size={filter ? 18 : 22} color={filter?.color ?? t.colors.text} />
      {filter ? <Text numberOfLines={1} style={[styles.libraryText, { color: t.colors.text }]}>{filter.label}</Text> : null}
    </Pressable>
  );
}

/** Thumb-height row: library, search (by meaning), find or create a note. */
function Dock({ onLibrary, onFind }: { onLibrary?: () => void; onFind: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom: Math.max(insets.bottom, 12) + 4 }]}>
      {onLibrary ? <LibraryButton onPress={onLibrary} /> : null}
      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search notes"
        onPress={() => router.push('/search')}
        style={({ pressed }) => [styles.search, { backgroundColor: t.colors.surface, borderColor: t.colors.border }, pressed && styles.pressed]}
      >
        <Ionicons name="sparkles" size={17} color={t.colors.accent} />
        <Text numberOfLines={1} style={[styles.searchText, { color: t.colors.textMuted }]}>Search or ask</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Find or create a note"
        onPress={onFind}
        style={({ pressed }) => [styles.compose, { backgroundColor: t.colors.volt }, pressed && styles.pressed]}
      >
        <Ionicons name="search" size={23} color={t.colors.onVolt} />
        <View style={[styles.plusBadge, { backgroundColor: t.colors.volt }]}>
          <Ionicons name="add" size={15} color={t.colors.onVolt} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 130 },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 4 },
  empty: { alignItems: 'center', paddingTop: 90, gap: 12 },
  emptyText: { fontSize: 16, textAlign: 'center', lineHeight: 23 },
  dock: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', maxWidth: 560 },
  search: {
    flex: 1, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  searchText: { flex: 1, fontSize: 16 },
  library: {
    width: 56, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  libraryWide: { width: undefined, maxWidth: 150, paddingHorizontal: 18 },
  libraryText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  compose: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  // A plus on the lens's top right, cut out of the glyph by its Volt ground.
  plusBadge: { position: 'absolute', top: 11, right: 10, width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
});
