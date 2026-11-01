import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { api, type AiSettings, type AiView, type ChatMessage } from './api';
import { findNotes, useNotes } from './store';

/** The providers Settings lists. `prefer` picks a sensible model from the provider's list. */
export const PROVIDERS: { id: string; name: string; keyUrl?: string; prefer: RegExp[]; address?: string }[] = [
  { id: 'openrouter', name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', prefer: [/^anthropic\/claude-sonnet/, /^openai\/gpt-5/, /^google\/gemini/] },
  { id: 'openai', name: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/] },
  { id: 'anthropic', name: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys', prefer: [/^claude-sonnet/, /^claude-opus/, /^claude/] },
  { id: 'gemini', name: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', prefer: [/^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-pro$/, /^gemini/] },
  { id: 'groq', name: 'Groq', keyUrl: 'https://console.groq.com/keys', prefer: [/llama-3\.3-70b/, /llama/] },
  { id: 'mistral', name: 'Mistral', keyUrl: 'https://console.mistral.ai/api-keys', prefer: [/^mistral-large-latest$/, /^mistral-medium/] },
  { id: 'deepseek', name: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys', prefer: [/^deepseek-chat$/] },
  { id: 'xai', name: 'xAI (Grok)', keyUrl: 'https://console.x.ai', prefer: [/^grok-4/, /^grok/] },
  { id: 'ollama', name: 'Ollama, on this computer', prefer: [], address: 'http://localhost:11434/v1' },
  { id: 'custom', name: 'Other (OpenAI-compatible)', prefer: [], address: '' },
];
export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

/** Models that can't chat (embeddings, speech, pictures) are left out of the list. */
const NOT_CHAT = /embed|tts|whisper|dall-e|moderation|audio|realtime|transcribe|image|search|rerank|guard/i;

export function chatModels(ids: string[]) {
  return ids.filter((id) => !NOT_CHAT.test(id));
}

export function preferredModel(provider: string, ids: string[]) {
  for (const re of providerOf(provider).prefer) {
    const hit = ids.find((id) => re.test(id));
    if (hit) return hit;
  }
  return ids[0] ?? '';
}

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

export type Scope = 'note' | 'all';
export interface Source { path: string; title: string }
export interface Turn { role: 'user' | 'assistant'; content: string; id?: string; sources?: Source[]; error?: string }

/** What the model is told, ahead of the notes it may use. */
const SYSTEM = `You are the assistant in VB Notes, a markdown notes app. Answer the person's questions using their notes, given below between <note> tags. Mention a note by its title when you use it. If the notes don't cover the question, say so, then help from general knowledge and make clear which part is which. Reply in markdown, and keep it short unless asked for more.`;
/** How much of the notes goes with a question: one note in full up to this, or a few notes up to these. */
const NOTE_CHARS = 60_000;
const EACH_CHARS = 8_000;
const ALL_CHARS = 40_000;
const FOUND = 8;

/** Words that say nothing about which note is meant. */
const STOP = new Set('the and for are was were what when where which who whom how why this that these those with from about have has had did does done can could would should will shall you your yours mine our ours their there here they them then than tell show give please any all some note notes into onto over under out off not but just also very more most much many few one two'.split(' '));

/**
 * The notes that fit a question: the app's own search first (words and, when on, meaning). A
 * question rarely has all its words in one note, so when that finds little, each telling word is
 * looked up on its own and notes with more of them come first.
 */
async function relevantNotes(query: string) {
  const found = (await findNotes(query, 'notes', FOUND)).notes;
  if (found.length >= 3) return found;
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((w) => !STOP.has(w)).slice(0, 8);
  const score = new Map<string, { note: (typeof found)[number]; n: number }>();
  for (const w of words) {
    for (const hit of await api.search(w, 'notes', 12).catch(() => [])) {
      const had = score.get(hit.note.path);
      score.set(hit.note.path, { note: hit.note, n: (had?.n ?? 0) + 1 });
    }
  }
  const more = [...score.values()].sort((a, b) => b.n - a.n).map((s) => s.note);
  const seen = new Set(found.map((n) => n.path));
  return [...found, ...more.filter((n) => !seen.has(n.path))].slice(0, FOUND);
}

const block = (title: string, text: string, max: number) =>
  `<note title="${title.replace(/"/g, "'")}">\n${text.length > max ? `${text.slice(0, max)}\n[…the rest of this note is left out]` : text}\n</note>`;

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
      context = block(title, await notes.readText(path), NOTE_CHARS);
      sources = [{ path, title }];
    } else {
      // A follow-up ("and the second one?") still finds the notes the conversation is about.
      const last = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';
      const found = await relevantNotes(`${last} ${question}`.trim());
      let room = ALL_CHARS;
      for (const n of found) {
        if (room <= 0) break;
        const text = await notes.readText(n.path).catch(() => '');
        const piece = block(n.title || 'Untitled', text, Math.min(EACH_CHARS, room));
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
