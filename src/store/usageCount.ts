import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { kvGet, kvSet } from '@/utils/kv';
import { splashGone } from '@/utils/splash';
import { COUNT_URL, countUse, type Counted } from '@/utils/usage';
import { useSettings } from './settings';

const KEY = 'usage.v1';
let counting = false;

async function count() {
  if (__DEV__ || counting || !useSettings.getState().countUse) return;
  counting = true;
  try {
    const send = async (body: string) => {
      const res = await fetch(COUNT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(`usage count: ${res.status}`);
    };
    await countUse(await kvGet<Counted>(KEY), Platform.OS, Constants.expoConfig?.version ?? '', send, (c) => kvSet(KEY, c));
  } catch {
    // Offline or the server is down: tried again when the app comes back.
  } finally {
    counting = false;
  }
}

/** Counts this phone as a user today (`src/utils/usage.ts`): once the app is up, and when it comes back. */
export function useUsageCount() {
  useEffect(() => {
    void splashGone.then(count);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void count(); });
    return () => sub.remove();
  }, []);
}
