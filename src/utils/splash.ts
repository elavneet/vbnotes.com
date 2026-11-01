import * as SplashScreen from 'expo-splash-screen';

/**
 * The launch screen (the app icon on Paper or Ink) stays up until the first screen has something
 * to show. Hidden as soon as React drew its first frame, it left a blank screen for a second or
 * more while the notes list was put together.
 */
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 180 });

let hidden = false;
export function appReady() {
  if (hidden) return;
  hidden = true;
  // One frame later, so what was just laid out is on screen under the splash.
  requestAnimationFrame(() => SplashScreen.hide());
}
// Whatever happens, never stuck behind the splash.
setTimeout(appReady, 4000);
