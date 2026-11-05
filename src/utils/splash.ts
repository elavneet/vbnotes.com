import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { markListReady } from './launchTiming';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

/**
 * The launch screen (the app icon on Paper or Ink) stays up until the first screen has something
 * to show. Hidden as soon as React drew its first frame, it left a blank screen for a second or
 * more while the notes list was put together.
 */
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 180 });

// The icons are a font read from the app's files after launch; until it is in, every icon (the
// menu, search, the Volt +) draws as nothing. Loading starts here, the first thing the app does.
const icons = Font.loadAsync(Ionicons.font).catch(() => {});

let gone: () => void = () => {};
/** Resolves once the splash is gone: launch work that can wait (the folder scan) starts then, not under it. */
export const splashGone = new Promise<void>((resolve) => { gone = resolve; });

let hidden = false;
const hide = () => {
  if (hidden) return;
  hidden = true;
  // One frame later, so what was just laid out is on screen under the splash.
  requestAnimationFrame(() => { SplashScreen.hide(); gone(); });
  // The note toolbar's icons, ready before the first note opens.
  void Font.loadAsync(MaterialCommunityIcons.font).catch(() => {});
};

/** The first screen is laid out: the splash goes once the icons are in too. */
export function appReady() {
  markListReady();
  void icons.then(hide);
}
// Whatever happens, never stuck behind the splash.
setTimeout(hide, 4000);
