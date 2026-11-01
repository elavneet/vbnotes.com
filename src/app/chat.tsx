import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { aiReady, useAi, useChat } from '@/ai/chat';
import { namedSources, type Scope, type Turn } from '@/ai/prompt';
import { destinationOf } from '@/ai/providers';
import { ChatMarkdown } from '@/components/ChatMarkdown';
import { Header } from '@/components/Header';
import { IconButton } from '@/components/IconButton';
import { noteRoute } from '@/components/NotesList';
import { Segmented } from '@/components/Segmented';
import { useNotes } from '@/store/notes';
import { useTheme } from '@/theme';

/**
 * Chat with AI: about one note (opened from its ⋮ menu) or about all notes (from Search). Off until
 * switched on in Settings › AI chat.
 */
export default function ChatScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ path?: string; q?: string }>();
  const ai = useAi();
  const chat = useChat();
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);
  const notePath = params.path ? String(params.path) : null;
  const title = useNotes((s) => (notePath ? s.db?.get(notePath)?.title : undefined)) || 'this note';
  const ready = aiReady(ai);

  // Opened on a note: a chat about it; from Search: about all notes, with the question asked at once.
  useEffect(() => {
    useChat.getState().start(notePath ? 'note' : 'all', notePath);
    const q = params.q ? String(params.q).trim() : '';
    if (q && aiReady(useAi.getState())) void useChat.getState().ask(q);
  }, [notePath, params.q]);

  const send = () => {
    const q = draft.trim();
    if (!q || chat.busy || !ready) return;
    setDraft('');
    void chat.ask(q);
  };

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      <Header
        left={<IconButton name="chevron-back" size={24} filled color={t.colors.text} onPress={() => router.back()} label="Back" />}
        title={notePath ? 'Chat with AI' : 'Ask your notes'}
        right={chat.turns.length ? <IconButton name="create-outline" size={22} filled color={t.colors.text} onPress={chat.clear} label="New chat" /> : null}
      />
      {notePath ? (
        <View style={styles.scope}>
          <Segmented<Scope> fit value={chat.scope} onChange={(s) => chat.start(s, notePath)} options={[['note', 'This note'], ['all', 'All notes']]} />
        </View>
      ) : null}
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={0}>
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.log}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {!ready ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: t.colors.textSecondary }]}>Turn on AI chat in Settings: pick a provider and a model, and add your API key.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} hitSlop={8}>
                <Text style={[styles.link, { color: t.colors.accent }]}>Open Settings</Text>
              </Pressable>
            </View>
          ) : chat.turns.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: t.colors.textSecondary }]}>
                {chat.scope === 'note'
                  ? `Ask about “${title}”: sum it up, find what's missing, turn it into a checklist.`
                  : 'Ask anything about your notes. VB Notes finds the notes that fit each question and sends them along.'}
              </Text>
            </View>
          ) : chat.turns.map((turn, i) => <TurnView key={turn.id ?? i} turn={turn} busy={chat.busy === turn.id} />)}
        </ScrollView>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.input, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              editable={ready}
              multiline
              placeholder={chat.scope === 'note' ? 'Ask about this note…' : 'Ask your notes…'}
              placeholderTextColor={t.colors.textMuted}
              selectionColor={t.colors.accent}
              style={[styles.inputText, { color: t.colors.text }]}
              accessibilityLabel="Your question"
            />
            {chat.busy ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Stop" onPress={chat.stop} style={[styles.send, { backgroundColor: t.colors.surface2 }]}>
                <Ionicons name="stop" size={14} color={t.colors.text} />
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!draft.trim() || !ready} onPress={send}
                style={[styles.send, { backgroundColor: t.colors.volt, opacity: draft.trim() && ready ? 1 : 0.4 }]}>
                <Ionicons name="arrow-up" size={20} color={t.colors.onVolt} />
              </Pressable>
            )}
          </View>
          {ready ? (
            <Text style={[styles.foot, { color: t.colors.textMuted }]}>
              {chat.scope === 'note' ? 'This note' : 'The notes that match'} and your question go to {destinationOf(ai.provider)} ({ai.model}).
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function TurnView({ turn, busy }: { turn: Turn; busy: boolean }) {
  const t = useTheme();
  if (turn.role === 'user') {
    return (
      <View style={[styles.user, { backgroundColor: t.colors.surface2 }]}>
        <Text selectable style={[styles.userText, { color: t.colors.text }]}>{turn.content}</Text>
      </View>
    );
  }
  const sources = namedSources(turn);
  return (
    <View style={styles.assistant}>
      {turn.content ? <ChatMarkdown text={turn.content} /> : busy ? <Text style={{ color: t.colors.textMuted }}>Thinking…</Text> : null}
      {turn.error ? <Text style={[styles.error, { color: t.colors.danger }]}>{turn.error}</Text> : null}
      {sources.length && (turn.content || turn.error) ? (
        <View style={styles.sources}>
          {sources.map((s) => (
            <Pressable key={s.path} accessibilityRole="button" accessibilityLabel={`Open ${s.title}`} onPress={() => router.push(noteRoute(s.path))}
              style={({ pressed }) => [styles.source, { borderColor: t.colors.border, backgroundColor: pressed ? t.colors.surface2 : t.colors.surface }]}>
              <Text numberOfLines={1} style={[styles.sourceText, { color: t.colors.textSecondary }]}>{s.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scope: { paddingHorizontal: 16, paddingBottom: 8, alignItems: 'center' },
  log: { padding: 16, gap: 16, flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  emptyText: { fontSize: 16, lineHeight: 23, textAlign: 'center' },
  link: { fontSize: 16, fontWeight: '600' },
  user: { alignSelf: 'flex-end', maxWidth: '86%', borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
  userText: { fontSize: 16, lineHeight: 22 },
  assistant: { gap: 10 },
  error: { fontSize: 14, lineHeight: 20 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  source: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, maxWidth: '100%' },
  sourceText: { fontSize: 13 },
  bottom: { paddingHorizontal: 12, paddingTop: 6, gap: 6 },
  input: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, gap: 8 },
  inputText: { flex: 1, fontSize: 16, maxHeight: 140, paddingTop: Platform.OS === 'ios' ? 7 : 4, paddingBottom: Platform.OS === 'ios' ? 7 : 4 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  foot: { fontSize: 12, lineHeight: 16, paddingHorizontal: 6 },
});
