import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { useUi } from './ui';

/** Expo advises checking at most this often. */
const CHECK_EVERY_MS = 30 * 60_000;
let lastCheck = 0;
let checking = false;

/**
 * expo-updates in release builds only: a debug build runs from Metro, and a build made before the
 * package was added has no native module for it.
 */
function updates(): typeof import('expo-updates') | null {
  if (__DEV__) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const u = require('expo-updates') as typeof import('expo-updates');
  return u.isEnabled ? u : null;
}

interface AppUpdateState {
  /** An update is downloaded and waits for a restart (it is used on the next launch anyway). */
  ready: boolean;
  check: () => Promise<void>;
  apply: () => void;
  dismiss: () => void;
}

/** Over-the-air updates (EAS Update): fetched quietly, applied when the user says so. */
export const useAppUpdate = create<AppUpdateState>((set) => ({
  ready: false,
  check: async () => {
    const u = updates();
    if (!u || checking || Date.now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    checking = true;
    try {
      if ((await u.checkForUpdateAsync()).isAvailable && (await u.fetchUpdateAsync()).isNew) set({ ready: true });
    } catch (e) {
      console.warn('update check failed', e);
    } finally {
      checking = false;
    }
  },
  apply: () => {
    set({ ready: false });
    // A note open beside the list saves as it closes; that write gets a moment before the restart.
    useUi.getState().select(null);
    setTimeout(() => void updates()?.reloadAsync().catch((e) => console.warn('update restart failed', e)), 300);
  },
  dismiss: () => set({ ready: false }),
}));

/** Looks for an update at launch and whenever the app comes back. */
export function useUpdateCheck() {
  useEffect(() => {
    const { check } = useAppUpdate.getState();
    void check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    return () => sub.remove();
  }, []);
}
