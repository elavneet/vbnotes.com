import React, { useRef, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { EditorBridge } from '@10play/tentap-editor';
import { useTheme } from '@/theme';
import { useNote, useNotes, sectionOf } from '@/store/notes';
import { Header } from '@/components/Header';
import { IconButton } from '@/components/IconButton';
import { NoteEditor } from '@/components/NoteEditor';
import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { MenuPopover } from '@/components/MenuPopover';
import { useAi } from '@/ai/chat';
import { NoteInfoSheet } from '@/components/NoteInfoSheet';
import { copyNote, copyNoteLink, exportNote } from '@/utils/noteShare';
import { linksTo } from '@/utils/noteStats';

export default function NoteScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id: string; new?: string }>();
  const [path, setPath] = useState(() => decodeURIComponent(String(params.id ?? '')));
  const note = useNote(path);
  const [menu, setMenu] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [choice, setChoice] = useState<'export' | 'copy' | null>(null);
  const [info, setInfo] = useState<{ md: string; created: number | null }>({ md: '', created: null });
  const editor = useRef<EditorBridge | null>(null);
  const { togglePin, toggleBookmark, trash, restore, deleteForever, getText, loadText } = useNotes.getState();
  const marked = useNotes((s) => s.bookmarks.includes(path));
  const section = sectionOf(path);
  const aiOn = useAi((s) => s.enabled);

  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  // What is on screen, including typing not saved yet.
  const current = async () => (await editor.current?.getMarkdown().catch(() => undefined)) ?? getText(path) ?? (await loadText(path));
  const copyAs = (format: 'md' | 'text' | 'html') => void current().then((md) => copyNote(md, format));
  const exportAs = (format: 'md' | 'html') => void current().then((md) => exportNote(note?.title ?? 'Untitled', md, format)).catch(() => {});
  // Notes with a [[link]] to this one: those holding its title's words, then read to be sure.
  const findBacklinks = async () => {
    const title = note?.title ?? '';
    const hits = (useNotes.getState().db?.search(title, 'notes', 200) ?? []).filter((h) => h.note.path !== path);
    const texts = await Promise.all(hits.map((h) => loadText(h.note.path).catch(() => '')));
    return hits.filter((_, i) => linksTo(texts[i], title, path)).map((h) => ({ path: h.note.path, title: h.note.title }));
  };
  // A second sheet waits for the menu to finish closing: iOS shows one at a time.
  const later = (fn: () => void) => setTimeout(fn, 350);
  const openNote = (to: string) => router.push({ pathname: '/note/[id]', params: { id: encodeURIComponent(to) } });
  const openInfo = async () => {
    const md = await current().catch(() => '');
    setInfo({ md, created: useNotes.getState().vault?.created?.(path) ?? null });
    setInfoOpen(true);
  };

  const groups: SheetAction[][] = [
    [
      { label: 'Search', icon: 'search-outline', onPress: () => router.push('/search') },
      { label: 'Typography', icon: 'text-outline', onPress: () => router.push('/settings') },
    ],
    [
      { label: 'Export', icon: 'download-outline', onPress: () => later(() => setChoice('export')) },
      { label: 'Copy As', icon: 'copy-outline', onPress: () => later(() => setChoice('copy')) },
      { label: 'Copy Link', icon: 'link-outline', onPress: () => copyNoteLink(path) },
      { label: 'Share', icon: 'share-outline', onPress: () => void current().then((message) => Share.share({ message, title: note?.title })).catch(() => {}) },
    ],
    [
      ...(section === 'notes' ? [{ label: note?.pinned ? 'Unpin' : 'Pin to top', icon: 'pin-outline' as const, onPress: () => void togglePin(path) }] : []),
      section === 'notes'
        ? { label: marked ? 'Remove bookmark' : 'Bookmark', icon: marked ? 'bookmark' : 'bookmark-outline', onPress: () => void toggleBookmark(path) }
        : { label: 'Move to Notes', icon: 'arrow-undo-outline', onPress: () => { void restore(path); back(); } },
    ],
    [
      section === 'trash'
        ? { label: 'Delete forever', icon: 'trash-outline', destructive: true, onPress: () => { void deleteForever(path); back(); } }
        : { label: 'Move to Trash', icon: 'trash-outline', destructive: true, onPress: () => { void trash(path); back(); } },
    ],
  ];

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      <Header
        left={<IconButton name="chevron-back" size={24} filled color={t.colors.text} onPress={back} label="Back" />}
        right={
          <View style={[styles.pill, { backgroundColor: t.colors.surface }]}>
            {aiOn ? <IconButton name="sparkles-outline" size={21} color={t.colors.text} onPress={() => router.push({ pathname: '/chat', params: { path } })} label="Chat with AI about this note" /> : null}
            <IconButton name="information-circle-outline" size={24} color={t.colors.text} onPress={() => void openInfo()} label="Note info" />
            <IconButton name="ellipsis-vertical" size={20} color={t.colors.text} onPress={() => setMenu(true)} label="More" />
          </View>
        }
      />
      <NoteEditor path={path} autofocus={params.new === '1'} isNew={params.new === '1'} onPathChange={setPath} editorRef={editor} />
      <MenuPopover visible={menu} onClose={() => setMenu(false)} groups={groups} />
      <ActionSheet
        visible={choice !== null}
        onClose={() => setChoice(null)}
        title={choice === 'export' ? 'Export' : 'Copy As'}
        actions={(choice === 'export'
          ? [{ label: 'Markdown', icon: 'document-text-outline', onPress: () => exportAs('md') }, { label: 'HTML', icon: 'code-slash-outline', onPress: () => exportAs('html') }]
          : [{ label: 'Markdown', icon: 'document-text-outline', onPress: () => copyAs('md') }, { label: 'Plain Text', icon: 'text-outline', onPress: () => copyAs('text') }, { label: 'HTML', icon: 'code-slash-outline', onPress: () => copyAs('html') }]
        ) as SheetAction[]}
      />
      <NoteInfoSheet
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        md={info.md}
        modified={note?.mtime}
        created={info.created}
        onHeading={(i) => editor.current?.goToHeading(i)}
        findBacklinks={findBacklinks}
        onOpenNote={openNote}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pill: { flexDirection: 'row', borderRadius: 22 },
});
