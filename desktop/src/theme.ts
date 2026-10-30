import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { TenTapStartKit } from '@10play/tentap-editor';
import { THEMES, themeFor } from '@/theme/themes';
import type { Theme, ThemeName } from '@/theme/tokens';
import { TYPOGRAPHY, type Typography } from '@/theme/typography';
import { editorCss } from '@/editor/editorCss';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'vbnotes.theme';

interface ThemeState { pref: ThemePref; light: string; dark: string; typography: Typography }

const DEFAULTS: ThemeState = { pref: 'system', light: 'paper', dark: 'ink', typography: TYPOGRAPHY };

function saved(): ThemeState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...s, typography: { ...TYPOGRAPHY, ...s.typography } };
  } catch {
    return DEFAULTS;
  }
}

/** Light/dark/system, the theme used for each and the editor's type, as on the phone (Settings). */
export const useThemePrefs = create<ThemeState & { set: (patch: Partial<ThemeState>) => void }>((set, get) => ({
  ...saved(),
  set: (patch) => {
    set(patch);
    const { pref, light, dark, typography } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ pref, light, dark, typography })); } catch {}
  },
}));

const media = window.matchMedia('(prefers-color-scheme: dark)');
const watchScheme = (cb: () => void) => { media.addEventListener('change', cb); return () => media.removeEventListener('change', cb); };
const useSystemDark = () => useSyncExternalStore(watchScheme, () => media.matches);

export function useTheme(): Theme {
  const { pref, light, dark } = useThemePrefs();
  const isDark = useSystemDark();
  const name: ThemeName = pref === 'system' ? (isDark ? 'dark' : 'light') : pref;
  return themeFor(name, name === 'light' ? light : dark);
}

export const themesOf = (name: ThemeName) => THEMES.filter((t) => t.name === name);

// Tentap's own editor styles (task lists, images…) first; ours (`editorCss`) after, so they win.
const bridgeCss = TenTapStartKit.map((b) => b.extendCSS ?? '').join('\n');

/** The theme's colours as CSS variables for the app's screens, and the phone's editor styles for the editor. */
export function useApplyTheme(theme: Theme) {
  const typography = useThemePrefs((s) => s.typography);
  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.colors)) root.style.setProperty(`--${k}`, v);
    root.style.colorScheme = theme.name;
    root.dataset.theme = theme.name;
    let style = document.getElementById('vb-editor-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'vb-editor-css';
      document.head.appendChild(style);
    }
    style.textContent = `${bridgeCss}\n${editorCss(theme, typography)}`;
  }, [theme, typography]);
}
