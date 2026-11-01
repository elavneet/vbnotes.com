import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { hashText } from '@/utils/markdown';
import { LocalVault } from './localVault';
import { basename, dirname, isMarkdown, joinPath, type VaultEntry } from './types';

// Any extension: Android keeps the name as given only for this type, else it may add its own.
const ANY = 'application/octet-stream';

/**
 * A folder picked on Android (a `content://` tree, often one a sync app keeps in step). Its files
 * can't be reached by adding a path to the folder's address, as on iOS: each one has its own
 * address, found by listing its folder. Those are kept from the last listing, and looked up again
 * when missing. Android can't rename a file there, so a move writes the new file and deletes the old.
 * Writing goes through a truncating handle: a plain write there leaves the old tail of a longer file.
 * The editor page can't load `content://` files, so a note's pictures and sounds are copied to a
 * mirror in the app's cache first, and links resolve there (`baseUrl`, `prepareMedia`).
 */
export class SafVault extends LocalVault {
  private nodes = new Map<string, File | Directory>();
  private mirror = new Directory(Paths.cache, 'vbnotes', 'media', hashText(this.root.uri).replace(/[^A-Za-z0-9-]/g, '-'));

  /** The file or folder at `path`, or null. */
  private find(path: string): File | Directory | null {
    if (!path) return this.root;
    const known = this.nodes.get(path);
    if (known?.exists) return known;
    let at: Directory = this.root;
    const parts = path.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      let next: File | Directory | undefined;
      try { next = at.list().find((it) => it.name === parts[i]); } catch { return null; }
      if (!next) return null;
      if (i === parts.length - 1) { this.nodes.set(path, next); return next; }
      if (!(next instanceof Directory)) return null;
      at = next;
    }
    return at;
  }

  private fileAt(path: string): File | null {
    const f = this.find(path);
    return f instanceof File ? f : null;
  }

  /** The folder at `path`, made (with its parents) if missing. */
  private folder(path: string): Directory {
    if (!path) return this.root;
    const found = this.find(path);
    if (found instanceof Directory) return found;
    const made = this.folder(dirname(path)).createDirectory(basename(path));
    this.nodes.set(path, made);
    return made;
  }

  /** Replaces the file's contents. */
  private put(f: File, data: string | Uint8Array) {
    const handle = f.open(FileMode.Truncate);
    try {
      handle.writeBytesSync(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    } finally {
      handle.close();
    }
  }

  private newFile(path: string): File {
    const f = this.folder(dirname(path)).createFile(basename(path), ANY);
    this.nodes.set(path, f);
    return f;
  }

  override async list(): Promise<VaultEntry[]> {
    const out: VaultEntry[] = [];
    const walk = (dir: Directory, rel: string) => {
      let items: (Directory | File)[] = [];
      try { items = dir.list(); } catch { return; }
      for (const it of items) {
        const name = it.name;
        if (!name || name.startsWith('.')) continue;
        const path = joinPath(rel, name);
        this.nodes.set(path, it);
        if (it instanceof Directory) {
          out.push({ path, name, isDir: true, mtime: 0, size: 0 });
          walk(it, path);
        } else if (isMarkdown(name)) {
          out.push({ path, name, isDir: false, mtime: it.modificationTime ?? 0, size: it.size ?? 0 });
        }
      }
    };
    walk(this.root, '');
    return out;
  }

  override async read(path: string) {
    const f = this.fileAt(path);
    if (!f) throw new Error(`${path} is not there`);
    return f.text();
  }

  override readSync(path: string) {
    const f = this.fileAt(path);
    if (!f) throw new Error(`${path} is not there`);
    return f.textSync();
  }

  override stat(path: string) {
    const f = this.fileAt(path);
    return f ? { mtime: f.modificationTime ?? 0, size: f.size ?? 0 } : null;
  }

  override created() { return null; }

  override get baseUrl() { return this.mirror.uri.endsWith('/') ? this.mirror.uri : `${this.mirror.uri}/`; }

  /** Copies the files at `paths` to the mirror, unless an up-to-date copy is there. */
  prepareMedia(paths: string[]) {
    for (const path of paths) {
      try {
        const src = this.fileAt(path);
        if (!src) continue;
        const copy = this.mirrored(path);
        if (copy.exists && copy.size === src.size) continue;
        copy.write(src.bytesSync());
      } catch (e) {
        console.warn('picture not copied for the editor', path, e);
      }
    }
  }

  private mirrored(path: string) {
    const copy = new File(this.mirror, ...path.split('/'));
    const dir = copy.parentDirectory;
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return copy;
  }

  override async write(path: string, text: string) {
    this.put(this.fileAt(path) ?? this.newFile(path), text);
  }

  override async remove(path: string) {
    this.find(path)?.delete();
    this.nodes.delete(path);
  }

  override async move(from: string, to: string) {
    const src = this.fileAt(from);
    if (!src) return;
    this.put(this.newFile(to), src.bytesSync());
    src.delete();
    this.nodes.delete(from);
  }

  override async mkdir(path: string) { this.folder(path); }

  override async exists(path: string) { return !!this.find(path); }

  override async importFile(source: string, path: string) {
    const bytes = new File(source).bytesSync();
    this.put(this.fileAt(path) ?? this.newFile(path), bytes);
    // The note that links it is open; the editor loads it from the mirror.
    this.mirrored(path).write(bytes);
  }

  /** Copies a folder on the phone (notes, attachments, `.vbnotes`) in, never over a file already here. */
  copyFrom(src: Directory, rel = '') {
    let copied = 0;
    for (const it of src.list()) {
      const path = joinPath(rel, it.name);
      if (it instanceof Directory) copied += this.copyFrom(it, path);
      else if (!this.find(path)) { this.put(this.newFile(path), it.bytesSync()); copied++; }
    }
    return copied;
  }

  // Android has no change events for these folders; the app looks again when it comes back.
  override watch() { return () => {}; }
}
