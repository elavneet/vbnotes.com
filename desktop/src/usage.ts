import { useEffect } from 'react';
import { create } from 'zustand';
import { getVersion } from '@tauri-apps/api/app';
import { countUse, type Counted } from '@/utils/usage';
import { api } from './api';

const ON_KEY = 'vbnotes.countUse';
const LAST_KEY = 'vbnotes.counted';
const PLATFORM = /Mac/.test(navigator.platform) ? 'macos' : /^Win/.test(navigator.platform) ? 'windows' : 'linux';

const savedOn = () => { try { return localStorage.getItem(ON_KEY) !== '0'; } catch { return true; } };
const lastCounted = (): Counted | null => { try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null'); } catch { return null; } };

/** "Count me as a user" in Settings › About (`src/utils/usage.ts`): on unless turned off. */
export const useCountUse = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: savedOn(),
  set: (on) => {
    try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch {}
    set({ on });
  },
}));

let counting = false;

async function count() {
  if (import.meta.env.DEV || counting || !useCountUse.getState().on) return;
  counting = true;
  try {
    const save = (c: Counted) => { try { localStorage.setItem(LAST_KEY, JSON.stringify(c)); } catch {} };
    await countUse(lastCounted(), PLATFORM, await getVersion(), api.countUse, save);
  } catch {
    // Offline or the server is down: tried again the next time the window comes to the front.
  } finally {
    counting = false;
  }
}

/** Counts this computer as a user today: at launch, and whenever the window comes to the front. */
export function useUsageCount() {
  useEffect(() => {
    void count();
    const onFocus = () => void count();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
}
