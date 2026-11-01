import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { ALL_CHARS, EACH_CHARS, NOTE_CHARS, SYSTEM, historyOf, noteBlock, passages, relevantNotes, type Scope, type Source, type Turn } from '@/ai/prompt';
import { addSpend, type Spend } from '@/ai/spend';
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
      const found = await relevantNotes(query, (await findNotes(query, 'notes', 30)).notes, async (w) => (await api.search(w, 'notes', 30)).map((h) => h.note), notes.hiddenTags);
      let room = ALL_CHARS;
      for (const n of found) {
        if (room <= 0) break;
        const text = await notes.readText(n.path).catch(() => '');
        const max = Math.min(EACH_CHARS, room);
        const piece = noteBlock(n.title || 'Untitled', passages(text, query, max), max);
        room -= piece.length;
        context += `${piece}\n\n`;
        sources.push({ path: n.path, title: n.title || 'Untitled' });
      }
      if (!sources.length) context = '(No notes matched this question.)';
    }
    const id = crypto.randomUUID();
    const history = historyOf(turns);
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
void listen<{ id: string; error: string | null; cost: number | null }>('ai-done', ({ payload }) => {
  if (payload.cost != null) useSpend.getState().add(payload.cost);
  useChat.setState((s) => ({
    busy: s.busy === payload.id ? null : s.busy,
    turns: s.turns.map((t) => (t.id !== payload.id ? t : {
      ...t,
      ...(payload.error ? { error: payload.error } : null),
      ...(payload.cost != null ? { cost: payload.cost } : null),
    })),
  }));
});

const SPEND_KEY = 'vbnotes.ai.spend';
const savedSpend = (): Spend | null => { try { return JSON.parse(localStorage.getItem(SPEND_KEY) ?? 'null'); } catch { return null; } };

/** What OpenRouter answers have cost from this computer this month (exact; it reports each reply's cost). */
export const useSpend = create<{ spend: Spend | null; add: (dollars: number) => void }>((set, get) => ({
  spend: savedSpend(),
  add: (dollars) => {
    const spend = addSpend(get().spend, dollars);
    set({ spend });
    try { localStorage.setItem(SPEND_KEY, JSON.stringify(spend)); } catch {}
  },
}));
