import { create } from 'zustand';
import { kvGetSync, kvSet } from '@/utils/kv';
import { DEFAULT_SEARCH_MODEL, type SearchModelId } from '@/search/models';
import { TYPOGRAPHY, type Typography } from '@/theme/typography';
import type { ThemeName } from '@/theme/tokens';

export type ThemePref = 'system' | 'dark' | 'light';
export type SearchMode = 'smart' | 'keyword';

interface SettingsState {
  theme: ThemePref;
  /** Theme ids (`src/theme/themes.ts`) used in light and in dark mode. */
  lightTheme: string;
  darkTheme: string;
  searchMode: SearchMode;
  searchModel: SearchModelId;
  typography: Typography;
  /** Count this device as a user, once a day, with no id (`src/utils/usage.ts`). */
  countUse: boolean;
  setTheme: (t: ThemePref) => void;
  setThemeFor: (name: ThemeName, id: string) => void;
  setSearchMode: (m: SearchMode) => void;
  setSearchModel: (m: SearchModelId) => void;
  setTypography: (patch: Partial<Typography>) => void;
  setCountUse: (on: boolean) => void;
}

const KEY = 'settings.v1';

/** Read at once when the app starts, so the first frame already has the chosen theme. */
function saved() {
  // Before 2026-10-30 only the text size was saved, as `editorFontSize`.
  const { editorFontSize, typography, ...rest } = kvGetSync<Partial<SettingsState> & { editorFontSize?: number }>(KEY) ?? {};
  return { ...rest, typography: { ...TYPOGRAPHY, ...(editorFontSize ? { size: editorFontSize } : null), ...typography } };
}

export const useSettings = create<SettingsState>((set, get) => {
  const persist = () => {
    const { theme, lightTheme, darkTheme, searchMode, searchModel, typography, countUse } = get();
    void kvSet(KEY, { theme, lightTheme, darkTheme, searchMode, searchModel, typography, countUse });
  };
  return {
    theme: 'system',
    lightTheme: 'paper',
    darkTheme: 'ink',
    searchMode: 'smart',
    searchModel: DEFAULT_SEARCH_MODEL,
    countUse: true,
    ...saved(),
    setTheme: (theme) => { set({ theme }); persist(); },
    setThemeFor: (name, id) => { set(name === 'light' ? { lightTheme: id } : { darkTheme: id }); persist(); },
    setSearchMode: (searchMode) => { set({ searchMode }); persist(); },
    setSearchModel: (searchModel) => { set({ searchModel }); persist(); },
    setTypography: (patch) => { set({ typography: { ...get().typography, ...patch } }); persist(); },
    setCountUse: (countUse) => { set({ countUse }); persist(); },
  };
});
