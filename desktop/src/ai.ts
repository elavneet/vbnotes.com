import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { ALL_CHARS, EACH_CHARS, FOUND, NOTE_CHARS, SYSTEM, noteBlock, relevantNotes, type ChatMessage, type Scope, type Source, type Turn } from '@/ai/prompt';
import { api, type AiSettings, type AiView } from './api';
import { findNotes, useNotes } from './store';

export { PROVIDERS, chatModels, preferredModel, providerOf } from '@/ai/providers';

/** The AI chat settings, shown in Settings and deciding whether the chat button shows. */
export const useAi = create<{
  view: AiView | null;
  load: () => Promise<void>;
  save: (patch: Partial<AiSettings>, key?: string) => Promise<AiView>;
}>((set, get) => ({
  view: null,
  load: async () => set({ view: await api.aiSettings() }),
  save: async (patch, key) => {
    const now = get().view ?? (await api.aiSettings());
    const view = await api.aiSave({ enabled: now.enabled, provider: now.provider, model: now.model, baseUrl: now.baseUrl, ...patch }, key);
    set({ view });
    return view;
  },
}));

/** Whether the chat can be asked now: switched on, with a model and, where needed, a key. */
export const aiReady = (v: AiView | null) => !!v && v.enabled && !!v.model && (v.hasKey || !v.needsKey);

export type { Scope, Source, Turn } from '@/ai/prompt';

/** The chat beside the note: about the open note, or about all notes (the ones that match each question). */
export const useChat = create<{
  open: boolean;
  scope: Scope;
  /** The note a "note" chat is about; switching notes starts a new chat. */
  path: string | null;
  turns: Turn[];
  busy: string | null;
  show: (scope?: Scope) => void;
  hide: () => void;
  setScope: (scope: Scope) => void;
  clear: () => void;
  ask: (question: string) => Promise<void>;
  stop: () => void;
}>((set, get) => ({
  open: false,
  scope: 'note',
  path: null,
  turns: [],
  busy: null,
  show: (scope) => {
    const selected = useNotes.getState().selected;
    const next = scope ?? (selected ? 'note' : 'all');
    if (next !== get().scope || (next === 'note' && selected !== get().path)) get().stop();
    set((s) => ({
      open: true,
      scope: next,
      path: next === 'note' ? selected : null,
      turns: next === s.scope && (next === 'all' || selected === s.path) ? s.turns : [],
    }));
  },
  hide: () => set({ open: false }),
  setScope: (scope) => get().show(scope),
  clear: () => { get().stop(); set({ turns: [] }); },
  stop: () => {
    const { busy } = get();
    if (busy) void api.aiCancel(busy);
    set({ busy: null });
  },
  ask: async (question) => {
    const { scope, path, turns } = get();
    const notes = useNotes.getState();
    let context = '';
    let sources: Source[] = [];
    if (scope === 'note') {
      if (!path) return;
      const meta = await api.get(path);
      const title = meta?.title || 'Untitled';
      context = noteBlock(title, await notes.readText(path), NOTE_CHARS);
      sources = [{ path, title }];
    } else {
      // A follow-up ("and the second one?") still finds the notes the conversation is about.
      const last = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';
      const query = `${last} ${question}`.trim();
      const found = await relevantNotes(query, (await findNotes(query, 'notes', FOUND)).notes, async (w) => (await api.search(w, 'notes', 12)).map((h) => h.note));
      let room = ALL_CHARS;
      for (const n of found) {
        if (room <= 0) break;
        const text = await notes.readText(n.path).catch(() => '');
        const piece = noteBlock(n.title || 'Untitled', text, Math.min(EACH_CHARS, room));
        room -= piece.length;
        context += `${piece}\n\n`;
        sources.push({ path: n.path, title: n.title || 'Untitled' });
      }
      if (!sources.length) context = '(No notes matched this question.)';
    }
    const id = crypto.randomUUID();
    const history: ChatMessage[] = turns.filter((t) => !t.error && t.content).map((t) => ({ role: t.role, content: t.content }));
    set((s) => ({ busy: id, turns: [...s.turns, { role: 'user', content: question }, { role: 'assistant', content: '', id, sources }] }));
    try {
      await api.aiChat(id, `${SYSTEM}\n\n${context}`, [...history, { role: 'user', content: question }]);
    } catch (e) {
      set((s) => ({ busy: null, turns: s.turns.map((t) => (t.id === id ? { ...t, error: String(e) } : t)) }));
    }
  },
}));

// Replies stream in from Rust.
void listen<{ id: string; text: string }>('ai-delta', ({ payload }) => {
  useChat.setState((s) => ({ turns: s.turns.map((t) => (t.id === payload.id ? { ...t, content: t.content + payload.text } : t)) }));
});
void listen<{ id: string; error: string | null }>('ai-done', ({ payload }) => {
  useChat.setState((s) => ({
    busy: s.busy === payload.id ? null : s.busy,
    turns: s.turns.map((t) => (t.id === payload.id && payload.error ? { ...t, error: payload.error } : t)),
  }));
});
