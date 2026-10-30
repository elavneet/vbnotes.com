import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/** What the editor's audio row shows. Times are seconds. */
export interface PlayStatus { src: string; playing: boolean; position: number; duration: number }
type Report = (s: PlayStatus) => void;

/**
 * One sound at a time, played natively for the note's audio rows: it follows the silent switch
 * setting, keeps going with the screen locked, and needs no file access inside the WebView.
 */
let current: { src: string; player: AudioPlayer; stop: () => void } | null = null;

function open(src: string, url: string, report: Report) {
  if (current?.src === src) return current.player;
  release();
  const player = createAudioPlayer(url, { updateInterval: 250 });
  const sub = player.addListener('playbackStatusUpdate', (s) => {
    if (s.didJustFinish) void player.seekTo(0).then(() => player.pause());
    report({ src, playing: s.playing && !s.didJustFinish, position: s.didJustFinish ? 0 : s.currentTime, duration: s.duration });
  });
  current = { src, player, stop: () => sub.remove() };
  return player;
}

export function release() {
  if (!current) return;
  current.stop();
  current.player.remove();
  current = null;
}

export function toggle(src: string, url: string, report: Report) {
  const player = open(src, url, report);
  if (player.playing) { player.pause(); return; }
  void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).finally(() => player.play());
}

export function seek(src: string, url: string, fraction: number, report: Report) {
  const player = open(src, url, report);
  if (player.duration > 0) void player.seekTo(Math.max(0, Math.min(1, fraction)) * player.duration);
}

/** Length of a clip before it is played: loads it on the side, reports once, lets it go. */
export function probe(src: string, url: string, report: Report) {
  if (current?.src === src) {
    const p = current.player;
    report({ src, playing: p.playing, position: p.currentTime, duration: p.duration });
    return;
  }
  const player = createAudioPlayer(url, { updateInterval: 1000 });
  let done = false;
  const finish = (duration: number) => {
    if (done) return;
    done = true;
    sub.remove();
    player.remove();
    report({ src, playing: false, position: 0, duration });
  };
  const sub = player.addListener('playbackStatusUpdate', (s) => { if (s.isLoaded && s.duration > 0) finish(s.duration); });
  setTimeout(() => finish(player.duration || 0), 4000);
}
