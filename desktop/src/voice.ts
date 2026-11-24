import { useEffect } from 'react';
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { TextSelection } from '@tiptap/pm/state';
import { startNote } from './actions';
import { api, type VoiceStatus } from './api';
import { openEditor } from './NoteEditor';
import { useNotes } from './store';

/**
 * Voice typing: the shortcut (or the mic button over the note) starts listening, a small pill at the
 * bottom of the note shows it is, and the shortcut again types what was said where the caret is.
 * Held down instead, it listens while held. Esc forgets it. The speech becomes text on this computer
 * (`src-tauri/src/voice.rs`); the model is downloaded the first time, after asking.
 */

const MAC = /Mac/.test(navigator.platform);
export const THIS_COMPUTER = MAC ? 'this Mac' : 'this computer';

/** The shortcuts on offer: each with Space, so the hand is already there. */
export const VOICE_KEYS: Record<string, { label: string }> = MAC
  ? { alt: { label: '⌥ Space' }, 'shift-mod': { label: '⇧⌘ Space' }, 'ctrl-alt': { label: '⌃⌥ Space' } }
  : { ctrl: { label: 'Ctrl+Space' }, 'ctrl-shift': { label: 'Ctrl+Shift+Space' }, 'ctrl-alt': { label: 'Ctrl+Alt+Space' } };
const DEFAULT_KEY = MAC ? 'alt' : 'ctrl';

const ON_KEY = 'vbnotes.voice';
const SHORTCUT_KEY = 'vbnotes.voiceKey';
const TIDY_KEY = 'vbnotes.voiceTidy';
/** Held this long, the shortcut listens only while held. */
const HOLD_MS = 450;

const saved = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };

/**
 * `offer`: the card about the speech model (download it, its progress, ready). `notice`: a short
 * message in the pill. `starting`, `listening`, `writing`: the microphone's way through.
 */
export type VoicePhase = 'idle' | 'offer' | 'starting' | 'listening' | 'writing' | 'notice';

interface VoiceState {
  /** Settings › Voice typing; on unless switched off. */
  on: boolean;
  key: string;
  /** Clean up what was said (um and uh out, corrections made); on unless switched off. */
  tidy: boolean;
  status: VoiceStatus;
  phase: VoicePhase;
  /** When listening started (ms). */
  since: number;
  /** The words so far. */
  heard: string;
  /** Nothing at all comes from the microphone: most likely the app isn't allowed to use it. */
  deaf: boolean;
  notice: { text: string } | null;
  setOn: (on: boolean) => void;
  setKey: (key: string) => void;
  setTidy: (on: boolean) => void;
}

export const useVoice = create<VoiceState>((set) => ({
  on: saved(ON_KEY) !== '0',
  key: VOICE_KEYS[saved(SHORTCUT_KEY) ?? ''] ? saved(SHORTCUT_KEY)! : DEFAULT_KEY,
  tidy: saved(TIDY_KEY) !== '0',
  status: { supported: true, model: 'missing', progress: 0, size: 0, tidy: 'missing', tidyProgress: 0, tidySize: 0 },
  phase: 'idle',
  since: 0,
  heard: '',
  deaf: false,
  notice: null,
  setOn: (on) => {
    save(ON_KEY, on ? '1' : '0');
    if (!on) cancelVoice();
    set({ on });
  },
  setKey: (key) => { save(SHORTCUT_KEY, key); set({ key }); },
  setTidy: (tidy) => {
    save(TIDY_KEY, tidy ? '1' : '0');
    set({ tidy });
    if (tidy) downloadTidyIfWanted();
  },
}));

export const voiceKeyLabel = () => VOICE_KEYS[useVoice.getState().key]?.label ?? '';

/** The microphone's loudness (0 to 1), for the waveform; kept out of the store so it never re-renders. */
export const voiceLevel = { now: 0 };

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function notify(text: string, ms = 5000) {
  if (noticeTimer) clearTimeout(noticeTimer);
  useVoice.setState({ phase: 'notice', notice: { text }, heard: '', deaf: false });
  noticeTimer = setTimeout(() => {
    if (useVoice.getState().phase === 'notice') useVoice.setState({ phase: 'idle', notice: null });
  }, ms);
}

export function hideVoice() {
  const { phase } = useVoice.getState();
  if (phase === 'offer' || phase === 'notice') useVoice.setState({ phase: 'idle', notice: null });
}

/** Follows the Rust side: the model's download, and the microphone while it listens. */
export async function initVoice() {
  await listen<VoiceStatus>('voice', (e) => {
    const was = useVoice.getState().status.model;
    useVoice.setState({ status: e.payload });
    // The speech model first, then the clean-up model.
    if (was === 'downloading' && e.payload.model === 'ready') downloadTidyIfWanted();
  });
  await listen<number>('voice-level', (e) => { voiceLevel.now = e.payload; });
  await listen<string>('voice-heard', (e) => {
    if (useVoice.getState().phase === 'listening' || useVoice.getState().phase === 'writing') useVoice.setState({ heard: e.payload });
  });
  await listen<boolean>('voice-deaf', (e) => useVoice.setState({ deaf: e.payload }));
  // The microphone or the model failed: what was heard before that is still typed.
  await listen<string>('voice-failed', (e) => void stopVoice(e.payload));
  useVoice.setState({ status: await api.voiceStatus() });
  downloadTidyIfWanted();
}

/** Asks Rust for the speech model; the offer card shows how far it has got. */
export function downloadVoice() {
  useVoice.setState((s) => ({ status: { ...s.status, model: 'downloading', progress: 0, error: null } }));
  void api.voiceDownload().catch((e) => useVoice.setState((s) => ({ status: { ...s.status, model: 'error', error: String(e) } })));
}

export async function deleteVoiceModel() {
  await api.voiceDelete();
  useVoice.setState({ status: await api.voiceStatus() });
}

/** Asks Rust for the clean-up model; Settings shows how far it has got. */
export function downloadTidy() {
  useVoice.setState((s) => ({ status: { ...s.status, tidy: 'downloading', tidyProgress: 0, tidyError: null } }));
  void api.voiceTidyDownload().catch((e) => useVoice.setState((s) => ({ status: { ...s.status, tidy: 'error', tidyError: String(e) } })));
}

/** With the clean-up on and the speech model there, the clean-up model too (once). */
function downloadTidyIfWanted() {
  const { tidy, status } = useVoice.getState();
  if (tidy && status.model === 'ready' && status.tidy === 'missing') downloadTidy();
}

/** Deletes the clean-up model and turns the clean-up off, or it would be downloaded again. */
export async function deleteTidyModel() {
  await api.voiceTidyDelete();
  useVoice.getState().setTidy(false);
  useVoice.setState({ status: await api.voiceStatus() });
}

/** "671 MB", "1.2 GB". */
export const sizeText = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

/** A hold that ends once listening has started stops it then. */
let stopWhenStarted = false;

export async function startVoice() {
  const s = useVoice.getState();
  if (!s.on || !s.status.supported || s.phase === 'starting' || s.phase === 'listening' || s.phase === 'writing') return;
  if (s.status.model !== 'ready') {
    useVoice.setState({ phase: 'offer', notice: null });
    return;
  }
  if (noticeTimer) clearTimeout(noticeTimer);
  stopWhenStarted = false;
  voiceLevel.now = 0;
  useVoice.setState({ phase: 'starting', heard: '', deaf: false, notice: null });
  // Words need a note to go in: with none open, a new one.
  if (!useNotes.getState().selected) await startNote();
  try {
    await api.voiceStart(s.tidy && s.status.tidy === 'ready');
  } catch (e) {
    notify(String(e), 7000);
    return;
  }
  if (useVoice.getState().phase !== 'starting') {
    // Cancelled while the microphone was starting.
    void api.voiceCancel();
    return;
  }
  useVoice.setState({ phase: 'listening', since: Date.now() });
  if (stopWhenStarted) void stopVoice();
}

/**
 * Stops listening and types what was said into the open note. `failure`: the microphone or the model
 * stopped it, which is said once what was heard is typed.
 */
export async function stopVoice(failure?: string) {
  const { phase } = useVoice.getState();
  if (phase === 'starting' && !failure) { stopWhenStarted = true; return; }
  if (failure && !/[.!?]$/.test(failure)) failure += '.';
  if (phase !== 'listening') {
    if (failure) { void api.voiceCancel(); notify(failure, 7000); }
    return;
  }
  useVoice.setState({ phase: 'writing' });
  let said: string;
  try {
    said = (await api.voiceStop()).trim();
  } catch (e) {
    notify(failure ?? String(e), 7000);
    return;
  }
  if (!said) { notify(failure ?? 'Didn’t catch anything.', failure ? 7000 : 2500); return; }
  let typed = false;
  try { typed = typeIntoNote(said); } catch (e) { console.warn('voice typing failed', e); }
  if (!typed) {
    // Never lose what was said.
    await navigator.clipboard.writeText(said).catch(() => {});
    notify(`${failure ? `${failure} ` : ''}Couldn’t type it into a note, so what you said is on the clipboard.`, 7000);
    return;
  }
  if (failure) { notify(`${failure} What was heard before that is typed.`, 7000); return; }
  useVoice.setState({ phase: 'idle', heard: '' });
}

/** Turns the microphone off and forgets what was said. */
export function cancelVoice() {
  const { phase } = useVoice.getState();
  if (phase === 'starting' || phase === 'listening') void api.voiceCancel();
  if (phase !== 'writing') useVoice.setState({ phase: 'idle', heard: '', notice: null, deaf: false });
}

export function toggleVoice() {
  const { phase } = useVoice.getState();
  if (phase === 'listening' || phase === 'starting') void stopVoice();
  else if (phase === 'offer') hideVoice();
  else void startVoice();
}

/**
 * Types `said` at the caret, with a space before it after a word. In a note's empty title line, its
 * first sentence names the note and the rest goes under it. False when no note is open.
 */
function typeIntoNote(said: string): boolean {
  const editor = openEditor.editor;
  if (!editor || editor.isDestroyed) return false;
  const { $from, empty } = editor.state.selection;
  const block = $from.parent;
  if (empty && block.type.name === 'heading' && block.content.size === 0 && $from.depth === 1 && $from.index(0) === 0) {
    const first = /^(.{1,80}?[.!?])(?:\s+([\s\S]+))?$/.exec(said);
    const title = (first ? first[1] : said.length <= 80 ? said : '').replace(/\.$/, '');
    if (title) {
      const rest = first?.[2] ?? '';
      editor.chain().focus().command(({ tr }) => {
        tr.insertText(title);
        // A new line under the title, for the rest and for what is typed next.
        const end = tr.selection.from;
        tr.split(end, 1, [{ type: editor.schema.nodes.paragraph }]);
        tr.setSelection(TextSelection.create(tr.doc, end + 2));
        if (rest) tr.insertText(rest);
        return true;
      }).scrollIntoView().run();
      return true;
    }
  }
  const before = block.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, ' ');
  const text = (before && !/\s/.test(before) ? ' ' : '') + said;
  editor.chain().focus().command(({ tr }) => { tr.insertText(text); return true; }).scrollIntoView().run();
  return true;
}

function isVoiceKey(e: KeyboardEvent, key: string) {
  if (e.code !== 'Space') return false;
  const { altKey: alt, ctrlKey: ctrl, metaKey: meta, shiftKey: shift } = e;
  switch (key) {
    case 'alt': return alt && !ctrl && !meta && !shift;
    case 'shift-mod': return shift && meta && !alt && !ctrl;
    case 'ctrl-alt': return ctrl && alt && !meta && !shift;
    case 'ctrl': return ctrl && !alt && !meta && !shift;
    case 'ctrl-shift': return ctrl && shift && !alt && !meta;
    default: return false;
  }
}

/** The shortcut (tap, or hold while talking) and Esc, ahead of the editor and the rest of the page. */
export function useVoiceKeys() {
  useEffect(() => {
    let pressed = 0;
    const down = (e: KeyboardEvent) => {
      const v = useVoice.getState();
      if (!v.on || !v.status.supported) return;
      if (e.key === 'Escape' && v.phase !== 'idle' && v.phase !== 'writing') {
        e.preventDefault();
        e.stopPropagation();
        if (v.phase === 'offer' || v.phase === 'notice') hideVoice(); else cancelVoice();
        return;
      }
      if (!isVoiceKey(e, v.key)) return;
      e.preventDefault();
      e.stopPropagation();
      // Settings and the finder have the keyboard while they are open.
      if (e.repeat || document.querySelector('.sheet-scrim, .finder-scrim')) return;
      if (v.phase === 'listening' || v.phase === 'starting') { pressed = 0; void stopVoice(); return; }
      if (v.phase === 'offer') { hideVoice(); return; }
      pressed = Date.now();
      void startVoice();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !pressed) return;
      const held = Date.now() - pressed > HOLD_MS;
      pressed = 0;
      if (held) void stopVoice();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, []);
}
