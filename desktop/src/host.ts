import { convertFileSrc } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { LinkAction } from '@/editor/linkBridge';
import { MEDIA_STATUS_EVENT, MediaAction } from '@/editor/mediaBridge';
import type { PlayStatus } from '@/media/player';
import { mediaSrc } from '../../editor-web/media';
import { openableUrl } from '@/utils/links';

/**
 * The phone's editor extensions (`editor-web/`) talk to the app through `window.ReactNativeWebView`.
 * On the desktop the editor runs in the app's own page, so that object is this: links open in the
 * browser, sound files play here.
 */
let root = '';

/** `attachments/x.jpg` in a note → the file in the notes folder. Web addresses stay as they are. */
export function fileUrl(src: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src;
  let path = src;
  try { path = decodeURIComponent(src); } catch {}
  return convertFileSrc(`${root}/${path.replace(/^\.?\//, '')}`);
}

const players = new Map<string, HTMLAudioElement>();
const report = (s: PlayStatus) => window.dispatchEvent(new CustomEvent(MEDIA_STATUS_EVENT, { detail: s }));

function player(src: string): HTMLAudioElement {
  let a = players.get(src);
  if (a) return a;
  a = new Audio(fileUrl(src));
  a.preload = 'metadata';
  const send = () => report({ src, playing: !a!.paused, position: a!.currentTime, duration: Number.isFinite(a!.duration) ? a!.duration : 0 });
  for (const ev of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended']) a.addEventListener(ev, send);
  a.addEventListener('error', () => report({ src, playing: false, position: 0, duration: 0 }));
  players.set(src, a);
  return a;
}

function onMessage(raw: string) {
  let m: { type?: string; payload?: any };
  try { m = JSON.parse(raw); } catch { return; }
  const p = m.payload ?? {};
  switch (m.type) {
    case LinkAction.Open: {
      const url = openableUrl(p.url);
      if (url) void openUrl(url);
      break;
    }
    case MediaAction.Probe:
      player(p.src);
      break;
    case MediaAction.Toggle: {
      const a = player(p.src);
      if (a.paused) {
        // One sound at a time.
        players.forEach((other) => { if (other !== a) other.pause(); });
        void a.play();
      } else a.pause();
      break;
    }
    case MediaAction.Seek: {
      const a = player(p.src);
      if (Number.isFinite(a.duration)) a.currentTime = a.duration * p.fraction;
      break;
    }
  }
}

/** Points pictures and sounds at `folder` and starts listening to the editor extensions. */
export function setupHost(folder: string) {
  root = folder.replace(/[\\/]+$/, '');
  players.forEach((a) => a.pause());
  players.clear();
  mediaSrc.resolve = fileUrl;
  (window as unknown as { ReactNativeWebView: { postMessage: (m: string) => void } }).ReactNativeWebView = { postMessage: onMessage };
}
