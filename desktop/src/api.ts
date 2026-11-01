import { invoke } from '@tauri-apps/api/core';
import type { NoteMeta, NoteRecord, Section, SectionCounts } from '@/store/noteModel';
import type { MeaningMatch } from '@/search/fuse';

/** A note file as a folder scan finds it. `cloud`: only in iCloud for now, not readable yet. */
export interface Entry { path: string; mtime: number; size: number; cloud: boolean }
export interface Stat { mtime: number; size: number }
export interface Hit { note: NoteMeta; snippet: string }
/** Search by meaning (`src-tauri/src/meaning.rs`): the model download, then the notes it has read. */
export interface MeaningStatus {
  state: 'off' | 'downloading' | 'loading' | 'ready' | 'error';
  /** The model download, 0 to 1. */
  progress: number;
  /** Chunks waiting for the model. */
  pending: number;
  indexed: number;
  error?: string | null;
}

import type { ChatMessage } from '@/ai/prompt';

/** AI chat settings as Rust keeps them (`src-tauri/src/ai.rs`); the API key itself never comes back. */
export interface AiSettings { enabled: boolean; provider: string; model: string; baseUrl: string }
export interface AiView extends AiSettings { hasKey: boolean; needsKey: boolean }

/** The Rust side (`src-tauri/src/main.rs`): the notes folder and its index. Paths are relative to the folder. */
export const api = {
  /** The first launch's choices: VB Notes in iCloud Drive (none without it), and Documents › VBNotes. */
  folderPlaces: () => invoke<{ icloud: string | null; here: string }>('folder_places'),
  makePlace: (place: 'icloud' | 'here') => invoke<string>('make_place', { place }),
  launchFolder: () => invoke<string | null>('launch_folder'),
  openFolder: (path: string) => invoke<void>('open_folder', { path }),
  scan: () => invoke<Entry[]>('scan'),
  readFiles: (paths: string[]) => invoke<(string | null)[]>('read_files', { paths }),
  writeFile: (path: string, text: string) => invoke<Stat>('write_file', { path, text }),
  moveFile: (from: string, to: string) => invoke<Stat>('move_file', { from, to }),
  removeFile: (path: string) => invoke<void>('remove_file', { path }),
  copyFolder: (to: string) => invoke<number>('copy_folder', { to }),
  exists: (path: string) => invoke<boolean>('exists', { path }),
  known: () => invoke<{ path: string; mtime: number; size: number }[]>('db_known'),
  put: (records: NoteRecord[], pinned: string[]) => invoke<void>('db_put', { records, pinned }),
  remove: (paths: string[]) => invoke<void>('db_remove', { paths }),
  move: (from: string, to: string, section: Section, mtime: number) => invoke<void>('db_move', { from, to, section, mtime }),
  setPinned: (paths: string[]) => invoke<void>('db_set_pinned', { paths }),
  get: (path: string) => invoke<NoteMeta | null>('db_get', { path }),
  list: (section: Section, tag: string, limit: number, hidden: string[] = []) => invoke<NoteMeta[]>('db_list', { section, tag, limit, hidden }),
  search: (q: string, section: Section, limit: number) => invoke<Hit[]>('db_search', { q, section, limit }),
  titles: (q: string, limit: number) => invoke<NoteMeta[]>('db_titles', { q, limit }),
  importFile: (from: string, to: string) => invoke<Stat>('import_file', { from, to }),
  welcomePicture: (to: string) => invoke<Stat>('welcome_picture', { to }),
  /** Paths dropped on the window: a folder, a file, or null when it can't be read. */
  pathKinds: (paths: string[]) => invoke<('dir' | 'file' | null)[]>('path_kinds', { paths }),
  importFolder: (from: string, to: string) => invoke<number>('import_folder', { from, to }),
  /** Notes opened from Finder or Explorer since the last call ("Open with › VB Notes"). */
  openedFiles: () => invoke<string[]>('opened_files'),
  /** The tray icon behind "Keep running in the tray" (Windows). */
  setTray: (on: boolean) => invoke<void>('set_tray', { on }),
  quit: () => invoke<void>('quit'),
  /** The page is drawn in its theme: the hidden window takes `background` and shows. */
  windowReady: (background: string) => invoke<void>('window_ready', { background }),
  aiSettings: () => invoke<AiView>('ai_settings'),
  /** `key`: a new key for the chosen provider, '' to remove it, undefined to keep it. */
  aiSave: (settings: AiSettings, key?: string) => invoke<AiView>('ai_save', { settings, key: key ?? null }),
  aiModels: () => invoke<string[]>('ai_models'),
  /** The reply streams back as `ai-delta` events ({ id, text }) and ends with `ai-done` ({ id, error, cost }). */
  aiChat: (id: string, system: string, messages: ChatMessage[]) => invoke<void>('ai_chat', { id, system, messages }),
  aiCancel: (id: string) => invoke<void>('ai_cancel', { id }),
  /** OpenRouter only: what the key has used and has left (`keyUsageFrom` reads it). */
  aiKeyUsage: () => invoke<unknown>('ai_key_usage'),
  counts: (hidden: string[]) => invoke<SectionCounts>('db_counts', { hidden }),
  tagCounts: () => invoke<{ tag: string; n: number }[]>('db_tag_counts'),
  meaningEnable: (on: boolean) => invoke<void>('meaning_enable', { on }),
  meaningStatus: () => invoke<MeaningStatus>('meaning_status'),
  meaningStale: () => invoke<{ path: string; hash: string }[]>('meaning_stale'),
  meaningSet: (notes: { path: string; hash: string; chunks: string[] }[]) => invoke<void>('meaning_set', { notes }),
  meaningSearch: (q: string, section: Section, limit: number) => invoke<MeaningMatch[]>('meaning_search', { q, section, limit }),
};
