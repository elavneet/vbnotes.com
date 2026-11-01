import React, { useRef, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { EditorBridge } from '@10play/tentap-editor';
import { useTheme } from '@/theme';
import { useNote, useNotes, sectionOf } from '@/store/notes';
import { Header } from '@/components/Header';
import { IconButton } from '@/components/IconButton';
import { NoteEditor } from '@/components/NoteEditor';
import type { SheetAction } from '@/components/ActionSheet';
import { MenuPopover } from '@/components/MenuPopover';
import { useAi } from '@/ai/chat';
import { NoteInfoSheet } from '@/components/NoteInfoSheet';

export default function NoteScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id: string; new?: string }>();
  const [path, setPath] = useState(() => decodeURIComponent(String(params.id ?? '')));
  const note = useNote(path);
  const [menu, setMenu] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [info, setInfo] = useState<{ md: string; created: number | null }>({ md: '', created: null });
  const editor = useRef<EditorBridge | null>(null);
  const { togglePin, archive, trash, restore, deleteForever, getText, loadText } = useNotes.getState();
  const section = sectionOf(path);
  const aiOn = useAi((s) => s.enabled);

  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  // The sheet counts what is on screen, including typing not saved yet.
  const openInfo = async () => {
    const md = (await editor.current?.getMarkdown().catch(() => undefined)) ?? getText(path) ?? '';
    setInfo({ md, created: useNotes.getState().vault?.created?.(path) ?? null });
    setInfoOpen(true);
  };

  const groups: SheetAction[][] = [
    [
      { label: 'Search', icon: 'search-outline', onPress: () => router.push('/search') },
      { label: 'Typography', icon: 'text-outline', onPress: () => router.push('/settings') },
    ],
    [
      ...(aiOn ? [{ label: 'Chat with AI', icon: 'sparkles-outline' as const, onPress: () => router.push({ pathname: '/chat', params: { path } }) }] : []),
      { label: 'Share', icon: 'share-outline', onPress: () => void loadText(path).then((message) => Share.share({ message, title: note?.title })).catch(() => {}) },
    ],
    [
      ...(section === 'notes' ? [{ label: note?.pinned ? 'Unpin' : 'Pin to top', icon: 'pin-outline' as const, onPress: () => void togglePin(path) }] : []),
      section === 'notes'
        ? { label: 'Archive', icon: 'archive-outline', onPress: () => { void archive(path); back(); } }
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
            <IconButton name="information-circle-outline" size={24} color={t.colors.text} onPress={() => void openInfo()} label="Note info" />
            <IconButton name="ellipsis-vertical" size={20} color={t.colors.text} onPress={() => setMenu(true)} label="More" />
          </View>
        }
      />
      <NoteEditor path={path} autofocus={params.new === '1'} isNew={params.new === '1'} onPathChange={setPath} editorRef={editor} />
      <MenuPopover visible={menu} onClose={() => setMenu(false)} groups={groups} />
      <NoteInfoSheet
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        md={info.md}
        modified={note?.mtime}
        created={info.created}
        onHeading={(i) => editor.current?.goToHeading(i)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pill: { flexDirection: 'row', borderRadius: 22 },
});
