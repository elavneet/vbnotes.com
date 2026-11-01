import { useEffect } from 'react';
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from './api';
import { openEditor } from './NoteEditor';

const TRAY_KEY = 'vbnotes.tray';
/** Windows only: a Mac keeps the app in the Dock, and Linux desktops differ on tray icons. */
export const TRAY_OFFERED = /^Win/.test(navigator.platform);

const saved = () => { try { return localStorage.getItem(TRAY_KEY) === '1'; } catch { return false; } };

/** "Keep running in the tray": closing the window hides it, and the tray icon brings it back. */
export const useTray = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: TRAY_OFFERED && saved(),
  set: (on) => {
    try { localStorage.setItem(TRAY_KEY, on ? '1' : '0'); } catch {}
    set({ on });
    void api.setTray(on).catch((e) => console.warn('tray icon failed', e));
  },
}));

/**
 * The close button saves the open note first, then closes the window (which quits the app) or,
 * with the tray on, hides it. Quit in the tray menu saves the note too.
 */
export function useWindowClose() {
  useEffect(() => {
    if (useTray.getState().on) void api.setTray(true).catch((e) => console.warn('tray icon failed', e));
    const win = getCurrentWindow();
    const offClose = win.onCloseRequested(async (e) => {
      await openEditor.flush();
      if (!useTray.getState().on) return;
      e.preventDefault();
      await win.hide();
    });
    const offQuit = listen('quit-requested', async () => {
      await openEditor.flush();
      await api.quit();
    });
    return () => { void offClose.then((f) => f()); void offQuit.then((f) => f()); };
  }, []);
}
