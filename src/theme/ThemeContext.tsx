import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, type Theme } from './tokens';
import { themeFor } from './themes';
import { useSettings } from '@/store/settings';

const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const pref = useSettings((s) => s.theme);
  const light = useSettings((s) => s.lightTheme);
  const dark = useSettings((s) => s.darkTheme);
  const theme = useMemo(() => {
    const name = pref === 'system' ? (scheme === 'light' ? 'light' : 'dark') : pref;
    return themeFor(name, name === 'light' ? light : dark);
  }, [pref, scheme, light, dark]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
