import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { useNotes } from '@/store/notes';
import { search } from '@/search';
import { useSettings } from '@/store/settings';
import { kvGetSync, kvSet } from '@/utils/kv';
import { ALL_CHARS, EACH_CHARS, NOTE_CHARS, SYSTEM, historyOf, noteBlock, passages, relevantNotes, type Scope, type Source, type Turn } from './prompt';
import { providerOf } from './providers';
import { addSpend, keyUsageFrom, type KeyUsage, type Spend } from './spend';
import { keyInfo, listModels, streamChat, type Target } from './stream';

/**
 * Chat with AI on the phone: the settings (off until switched on), the API key in the Keychain or
 * Android Keystore (never in the notes folder or the app's backed-up settings), and the chat itself.
 */
export interface AiSettings { enabled: boolean; provider: string; model: string; baseUrl: string }

const KEY = 'ai.v1';
const keyName = (provider: string) => `vbnotes.ai.key.${provider}`;

export const useAi = create<AiSettings & {
  /** Whether a key is saved for the chosen provider. */
  hasKey: boolean;
  save: (patch: Partial<AiSettings>) => void;
  setKey: (key: string) => Promise<void>;
  checkKey: () => Promise<void>;
}>((set, get) => ({
  enabled: false,
  provider: 'openrouter',
  model: '',
  baseUrl: '',
  ...kvGetSync<AiSettings>(KEY),
  hasKey: false,
  save: (patch) => {
    set(patch);
    const { enabled, provider, model, baseUrl } = get();
    void kvSet(KEY, { enabled, provider, model, baseUrl });
    if (patch.provider) void get().checkKey();
  },
  setKey: async (key) => {
    const name = keyName(providerOf(get().provider).id);
    if (key.trim()) await SecureStore.setItemAsync(name, key.trim());
    else await SecureStore.deleteItemAsync(name);
    await get().checkKey();
  },
  checkKey: async () => {
    const key = await SecureStore.getItemAsync(keyName(providerOf(get().provider).id)).catch(() => null);
    set({ hasKey: !!key });
  },
}));
void useAi.getState().checkKey();

/** Whether a question can be asked now: switched on, with a model and, where needed, a key. */
export function aiReady(s: { enabled: boolean; provider: string; model: string; hasKey: boolean }) {
  return s.enabled && !!s.model && (s.hasKey || !providerOf(s.provider).needsKey);
}

async function target(): Promise<Target> {
  const s = useAi.getState();
  const p = providerOf(s.provider);
  const base = (s.baseUrl.trim() || p.base).replace(/\/+$/, '');
  if (!base) throw new Error('Add the server\'s address in Settings › AI chat.');
  const key = (await SecureStore.getItemAsync(keyName(p.id)).catch(() => null)) ?? undefined;
  if (p.needsKey && !key) throw new Error('Add your API key in Settings › AI chat.');
  return { base, key, wire: p.wire, model: s.model.trim() };
}

const SPEND_KEY = 'ai.spend.v1';

/** What OpenRouter replies have cost from this phone this month (exact; it reports each reply's cost). */
export const useSpend = create<{ spend: Spend | null; add: (dollars: number) => void }>((set, get) => ({
  spend: kvGetSync<Spend>(SPEND_KEY),
  add: (dollars) => {
    const spend = addSpend(get().spend, dollars);
    set({ spend });
    void kvSet(SPEND_KEY, spend);
  },
}));

/** What the OpenRouter key has used and has left, all apps together. */
export async function openRouterUsage(): Promise<KeyUsage> {
  return keyUsageFrom((await keyInfo(fetch, await target())) as never);
}

/** The models the chosen provider offers, for the list in Settings. */
export async function providerModels() {
  return listModels(fetch, await target());
}

let controller: AbortController | null = null;

/** One chat at a time: about one note, or about all notes (the ones that match each question). */
export const useChat = create<{
  scope: Scope;
  path: string | null;
  turns: Turn[];
  busy: string | null;
  start: (scope: Scope, path: string | null) => void;
  clear: () => void;
  stop: () => void;
  ask: (question: string) => Promise<void>;
}>((set, get) => ({
  scope: 'all',
  path: null,
  turns: [],
  busy: null,
  start: (scope, path) => {
    const now = get();
    if (now.scope === scope && (scope === 'all' || now.path === path)) return;
    get().stop();
    set({ scope, path: scope === 'note' ? path : now.path, turns: [] });
  },
  clear: () => { get().stop(); set({ turns: [] }); },
  stop: () => {
    controller?.abort();
    controller = null;
    set({ busy: null });
  },
  ask: async (question) => {
    const { scope, path, turns } = get();
    const notes = useNotes.getState();
    const id = `${Date.now()}`;
    const history = historyOf(turns);
    set((s) => ({ busy: id, turns: [...s.turns, { role: 'user', content: question }, { role: 'assistant', content: '', id }] }));
    const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
      set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) }));
    try {
      let context = '';
      const sources: Source[] = [];
      const db = notes.db;
      if (scope === 'note' && path) {
        const title = db?.get(path)?.title || 'Untitled';
        context = noteBlock(title, await notes.readText(path), NOTE_CHARS);
        sources.push({ path, title });
      } else if (db) {
        // A follow-up ("and the second one?") still finds the notes the conversation is about.
        const last = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';
        const query = `${last} ${question}`.trim();
        const smart = useSettings.getState().searchMode === 'smart';
        const hits = (await search(query, db, 'notes', smart)).slice(0, 30).flatMap((r) => db.get(r.path) ?? []);
        const found = await relevantNotes(query, hits, async (w) => db.search(w, 'notes', 30).map((h) => h.note), notes.hiddenTags);
        let room = ALL_CHARS;
        for (const n of found) {
          if (room <= 0) break;
          const max = Math.min(EACH_CHARS, room);
          const piece = noteBlock(n.title || 'Untitled', passages(await notes.readText(n.path).catch(() => ''), query, max), max);
          room -= piece.length;
          context += `${piece}\n\n`;
          sources.push({ path: n.path, title: n.title || 'Untitled' });
        }
        if (!sources.length) context = '(No notes matched this question.)';
      }
      update({ sources });
      controller = new AbortController();
      await streamChat(
        fetch,
        await target(),
        `${SYSTEM}\n\n${context}`,
        [...history, { role: 'user', content: question }],
        (piece) => update((t) => ({ content: t.content + piece })),
        controller.signal,
        (dollars) => { update({ cost: dollars }); useSpend.getState().add(dollars); },
      );
    } catch (e) {
      update({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (get().busy === id) set({ busy: null });
    }
  },
}));
