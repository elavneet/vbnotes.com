import { useEffect } from 'react';
import { create } from 'zustand';
import { getVersion } from '@tauri-apps/api/app';
import { api, type Release } from './api';

const ON_KEY = 'vbnotes.updateNotes';
const SEEN_KEY = 'vbnotes.updateSeen';
const SKIP_KEY = 'vbnotes.updateSkipped';
/** GitHub is asked at most this often; in between, the last answer is used. */
const EVERY_MS = 6 * 3600_000;

const read = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

/** Whether version `a` is later than `b`: "0.4.15" is later than "0.4.9". */
export function isNewer(a: string, b: string) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

interface UpdateState {
  /** Settings › About › Tell me about updates. */
  on: boolean;
  /** The newest release, when it is newer than this app. */
  latest: Release | null;
  /** Later was clicked for `latest`: Settings still offers it, the sidebar card doesn't. */
  dismissed: boolean;
  setOn: (on: boolean) => void;
  check: () => Promise<void>;
  later: () => void;
}

/** New versions on GitHub (Rust `latest_release`). The desktop app has no self-updater; Download opens the release page. */
export const useUpdates = create<UpdateState>((set, get) => ({
  on: read<boolean>(ON_KEY) ?? true,
  latest: null,
  dismissed: false,
  setOn: (on) => {
    write(ON_KEY, on);
    set({ on, latest: null });
    if (on) void get().check();
  },
  check: async () => {
    if (import.meta.env.DEV || !get().on) return;
    let seen = read<{ at: number; release: Release }>(SEEN_KEY);
    if (!seen || Date.now() - seen.at > EVERY_MS) {
      try {
        seen = { at: Date.now(), release: await api.latestRelease() };
      } catch {
        return; // Offline: asked again the next time the window comes to the front.
      }
      write(SEEN_KEY, seen);
    }
    const { release } = seen;
    const newer = isNewer(release.version, await getVersion());
    set({ latest: newer ? release : null, dismissed: read<string>(SKIP_KEY) === release.version });
  },
  later: () => {
    write(SKIP_KEY, get().latest?.version);
    set({ dismissed: true });
  },
}));

/** Looks for a new version at launch and whenever the window comes to the front. */
export function useUpdateCheck() {
  useEffect(() => {
    const check = () => void useUpdates.getState().check();
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
}
