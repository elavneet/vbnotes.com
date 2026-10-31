import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { chunkNote } from '@/search/chunks';
import { searchModel } from '@/search/models';
import { hashText } from '@/utils/markdown';
import { api, type MeaningStatus } from './api';

/** The phone's Standard model: its chunk size and the score under which a match is noise. */
export const MODEL = searchModel('standard');
const ON_KEY = 'vbnotes.meaning';
/** Notes read and chunked at a time. */
const READ_BATCH = 50;

const savedOn = () => { try { return localStorage.getItem(ON_KEY) !== '0'; } catch { return true; } };

interface MeaningState {
  /** Search by meaning is on (Settings); on by default, as on the phone. */
  on: boolean;
  status: MeaningStatus;
  setOn: (on: boolean) => void;
}

export const useMeaning = create<MeaningState>((set) => ({
  on: savedOn(),
  status: { state: 'off', progress: 0, pending: 0, indexed: 0 },
  setOn: (on) => {
    try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch {}
    set({ on });
    void api.meaningEnable(on).then(() => { if (on) void syncMeaning(); });
  },
}));

/** Starts search by meaning (unless it was switched off) and follows its progress. */
export async function startMeaning() {
  await listen<MeaningStatus>('meaning', (e) => useMeaning.setState({ status: e.payload }));
  useMeaning.setState({ status: await api.meaningStatus() });
  await api.meaningEnable(useMeaning.getState().on);
}

/** Meaning search can answer: the model is loaded. */
export const meaningReady = () => useMeaning.getState().on && useMeaning.getState().status.state === 'ready';

let syncing: Promise<void> | null = null;
let again = false;

/**
 * Chunks every note whose text changed since its chunks were made (shared `chunkNote`, as on the
 * phone); the model reads them in the background. Called after scans and saves.
 */
export function syncMeaning(): Promise<void> {
  if (!useMeaning.getState().on) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    do {
      again = false;
      const stale = await api.meaningStale();
      for (let i = 0; i < stale.length; i += READ_BATCH) {
        const part = stale.slice(i, i + READ_BATCH);
        const texts = await api.readFiles(part.map((s) => s.path));
        const notes = part.flatMap((s, j) => {
          const text = texts[j];
          if (text == null) return [];
          const chunks = chunkNote(text, MODEL.chunkWords);
          // An empty note still gets a row, or it would be "changed" forever.
          return [{ path: s.path, hash: hashText(text), chunks: chunks.length ? chunks : [''] }];
        });
        await api.meaningSet(notes);
      }
    } while (again);
  })().catch((e) => console.warn('meaning sync failed', e)).finally(() => { syncing = null; });
  return syncing;
}
