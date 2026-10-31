import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DrawerLayoutMethods } from 'react-native-gesture-handler/ReanimatedDrawerLayout';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/utils/useBreakpoint';
import { useUi } from '@/store/ui';
import { useNote, useNotes } from '@/store/notes';
import { Header } from '@/components/Header';
import { IconButton } from '@/components/IconButton';
import { NotesList } from '@/components/NotesList';
import { NoteEditor } from '@/components/NoteEditor';
import { LibraryDrawer, LibraryPanel } from '@/components/Library';

/** Phones: the feed, with the library in a left drawer. Wide screens: library, feed and the open note side by side. */
export default function HomeScreen() {
  const t = useTheme();
  const { isWide, isDesktop } = useBreakpoint();
  const { selectedPath, select } = useUi();
  const drawer = useRef<DrawerLayoutMethods>(null);
  const openLibrary = isDesktop ? undefined : () => drawer.current?.openDrawer();
  // A rename after leaving a note must not steal the selection from the note picked next.
  const onRenamed = (from: string, to: string) => { if (useUi.getState().selectedPath === from) select(to); };
  const selected = useNote(isWide ? selectedPath : null);

  if (!isWide) return <LibraryDrawer drawerRef={drawer} fullSwipe><NotesList wide={false} onLibrary={openLibrary} /></LibraryDrawer>;

  const panes = (
    <View style={[styles.row, { backgroundColor: t.colors.bg }]}>
      {isDesktop ? <LibraryPanel /> : null}
      <View style={[styles.listPane, { borderRightColor: t.colors.border }]}>
        <NotesList wide onLibrary={openLibrary} />
      </View>
      <View style={styles.editorPane}>
        {selected ? (
          <EditorPane key={selected.path} path={selected.path} onPathChange={onRenamed} onClose={() => select(null)} />
        ) : (
          <View style={styles.emptyPane}>
            <Ionicons name="document-text-outline" size={36} color={t.colors.textMuted} />
            <Text style={[styles.emptyText, { color: t.colors.textMuted }]}>Pick a note, or start one with the + button under the list.</Text>
          </View>
        )}
      </View>
    </View>
  );
  return isDesktop ? panes : <LibraryDrawer drawerRef={drawer}>{panes}</LibraryDrawer>;
}

function EditorPane({ path, onPathChange, onClose }: { path: string; onPathChange: (from: string, to: string) => void; onClose: () => void }) {
  const note = useNote(path);
  const { togglePin, archive, trash } = useNotes.getState();
  return (
    <View style={styles.editorPane}>
      <Header
        inset={false}
        title=""
        right={
          <>
            <IconButton name={note?.pinned ? 'pin' : 'pin-outline'} onPress={() => void togglePin(path)} label={note?.pinned ? 'Unpin' : 'Pin'} active={note?.pinned} />
            <IconButton name="archive-outline" onPress={() => { void archive(path); onClose(); }} label="Archive" />
            <IconButton name="trash-outline" onPress={() => { void trash(path); onClose(); }} label="Move to Trash" />
          </>
        }
      />
      <View style={styles.page}>
        <NoteEditor path={path} toolbarPlacement="top" onPathChange={(next) => onPathChange(path, next)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  listPane: { width: 380, borderRightWidth: StyleSheet.hairlineWidth },
  editorPane: { flex: 1 },
  page: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  emptyPane: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 16 },
});
