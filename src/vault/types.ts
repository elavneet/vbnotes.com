/**
 * A vault is a folder of markdown files. The app never owns the data; it reads and
 * writes plain `.md` files so any sync (iCloud Drive, Google Drive, Syncthing) works.
 */
export interface VaultEntry {
  /** Path relative to the vault root, "/" separated, e.g. "dev/code/Hello.md". */
  path: string;
  name: string;
  isDir: boolean;
  mtime: number;
  size: number;
  /** Only in iCloud for now (a `.name.icloud` stand-in): it can't be read until it comes down. */
  cloud?: boolean;
}

/** `icloud`: the app's own folder in iCloud Drive. `picked`: one chosen in Files. */
export type VaultKind = 'local' | 'picked' | 'icloud';

export interface Vault {
  id: string;
  kind: VaultKind;
  /** Human readable location for the settings screen. */
  label: string;
  /** Flat recursive listing of markdown files and directories. Hidden entries (dot-prefixed) are skipped, except iCloud stand-ins (`cloud`). */
  list(): Promise<VaultEntry[]>;
  read(path: string): Promise<string>;
  /** Same as `read`, at once: the editor's first frame needs the text. */
  readSync?(path: string): string;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Copies a file from outside the vault (a photo, a recording) to `path`. */
  importFile(source: string, path: string): Promise<void>;
  /** `file://` URL of the vault folder, ending in `/`; note links like `attachments/x.jpg` resolve against it. */
  readonly baseUrl: string;
  /**
   * Makes the pictures and sounds at `paths` reachable from `baseUrl`, for a folder whose files a
   * relative link can't reach (one picked on Android). Undefined where links already reach them.
   */
  prepareMedia?(paths: string[]): void;
  /** Date (ms) and size of a file as a listing reports them; null if it is not there. */
  stat?(path: string): { mtime: number; size: number } | null;
  /** When the file was created (ms), if the file system knows. */
  created?(path: string): number | null;
  /** Optional change watcher; returns an unsubscribe. */
  watch?(cb: () => void): () => void;
  /** Asks the cloud for files that are not on the phone yet; resolves with how many. */
  fetchFromCloud?(): Promise<number>;
}

export const RESERVED_FOLDERS = { archive: 'Archive', trash: 'Trash' } as const;
export const META_PATH = '.vbnotes/meta.json';

export interface VaultMeta {
  pinned: string[];
  /** Tag path → Ionicons name, for tags given an icon by hand. */
  tagIcons: Record<string, string>;
  /**
   * Tag names whose notes stay out of the main Notes list, at any level (`melta` hides `#melta` and
   * `#go2lister/melta`); they still show under their tag. Shared with the desktop app.
   */
  hiddenTags?: string[];
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}
export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}
export function isMarkdown(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}
