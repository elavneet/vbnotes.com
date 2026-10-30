import { invoke } from '@tauri-apps/api/core';
import type { NoteMeta, NoteRecord, Section, SectionCounts } from '@/store/noteModel';

/** A note file as a folder scan finds it. `cloud`: only in iCloud for now, not readable yet. */
export interface Entry { path: string; mtime: number; size: number; cloud: boolean }
export interface Stat { mtime: number; size: number }
export interface Hit { note: NoteMeta; snippet: string }

/** The Rust side (`src-tauri/src/main.rs`): the notes folder and its index. Paths are relative to the folder. */
export const api = {
  suggestedFolder: (create: boolean) => invoke<string>('suggested_folder', { create }),
  launchFolder: () => invoke<string | null>('launch_folder'),
  openFolder: (path: string) => invoke<void>('open_folder', { path }),
  scan: () => invoke<Entry[]>('scan'),
  readFiles: (paths: string[]) => invoke<(string | null)[]>('read_files', { paths }),
  writeFile: (path: string, text: string) => invoke<Stat>('write_file', { path, text }),
  moveFile: (from: string, to: string) => invoke<Stat>('move_file', { from, to }),
  removeFile: (path: string) => invoke<void>('remove_file', { path }),
  exists: (path: string) => invoke<boolean>('exists', { path }),
  known: () => invoke<{ path: string; mtime: number; size: number }[]>('db_known'),
  put: (records: NoteRecord[], pinned: string[]) => invoke<void>('db_put', { records, pinned }),
  remove: (paths: string[]) => invoke<void>('db_remove', { paths }),
  move: (from: string, to: string, section: Section, mtime: number) => invoke<void>('db_move', { from, to, section, mtime }),
  setPinned: (paths: string[]) => invoke<void>('db_set_pinned', { paths }),
  get: (path: string) => invoke<NoteMeta | null>('db_get', { path }),
  list: (section: Section, tag: string, limit: number) => invoke<NoteMeta[]>('db_list', { section, tag, limit }),
  search: (q: string, section: Section, limit: number) => invoke<Hit[]>('db_search', { q, section, limit }),
  counts: () => invoke<SectionCounts>('db_counts'),
  tagCounts: () => invoke<{ tag: string; n: number }[]>('db_tag_counts'),
};
