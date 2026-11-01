import React, { useEffect, useMemo } from 'react';
import { Platform, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SystemUI from 'expo-system-ui';
import { ThemeProvider, useTheme } from '@/theme';
import { useNotes } from '@/store/notes';
import { useIndexing } from '@/search/useIndexing';
import { WebViewWarmup } from '@/editor/WebViewWarmup';
import { useSharedIn } from '@/media/useSharedIn';
import { useUpdateCheck } from '@/store/appUpdate';
import { FolderChoice } from '@/components/FolderChoice';
import '@/utils/splash';

export const unstable_settings = { anchor: 'index' };

function Shell() {
  const t = useTheme();
  const needsFolder = useNotes((s) => s.needsFolder);
  useIndexing();
  useSharedIn();
  useUpdateCheck();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.colors.bg);
  }, [t]);
  // The native stack paints its own container in the navigation theme's background. The stock
  // light grey showed at the rounded corners while a screen slid in or out.
  const navigation = useMemo(() => {
    const base = t.name === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: t.colors.bg } };
  }, [t]);
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />
      <NavigationTheme value={navigation}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg }, animation: 'default' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="note/[id]" options={{ animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right' }} />
          <Stack.Screen name="search" options={{ presentation: 'modal', animation: 'fade' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="chat" options={{ animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right' }} />
        </Stack>
      </NavigationTheme>
      <WebViewWarmup />
      {needsFolder ? <FolderChoice /> : null}
    </View>
  );
}

export default function RootLayout() {
  const boot = useNotes((s) => s.boot);
  useEffect(() => { void boot(); }, [boot]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
