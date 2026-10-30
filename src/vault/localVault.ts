import { Directory, File, Paths } from 'expo-file-system';
import { FolderAccess } from './folderAccess';
import { basename, dirname, isMarkdown, joinPath, type Vault, type VaultEntry, type VaultKind } from './types';

/**
 * Native vault on top of a real folder. Default root is <Documents>/VBNotes, which
 * iOS exposes in the Files app ("On My iPhone / VBNotes") thanks to file sharing in app.json.
 * A folder picked in Files (iCloud Drive, another app) is a `picked` vault over the same code.
 */
export class LocalVault implements Vault {
  constructor(public root: Directory, public id = 'local', public label = root.uri, public kind: VaultKind = 'local') {}

  static default(): LocalVault {
    const dir = new Directory(Paths.document, 'VBNotes');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return new LocalVault(dir, 'local', 'On this device · VBNotes');
  }

  private file(path: string) { return new File(this.root, ...path.split('/')); }
  private dir(path: string) { return path ? new Directory(this.root, ...path.split('/')) : this.root; }

  async list(): Promise<VaultEntry[]> {
    const out: VaultEntry[] = [];
    const walk = (dir: Directory, rel: string) => {
      let items: (Directory | File)[] = [];
      try { items = dir.list(); } catch { return; }
      for (const it of items) {
        const name = it.name;
        if (!name) continue;
        if (name.startsWith('.')) {
          // iCloud stands in for a note not on the phone yet (or removed to save space) with `.Name.md.icloud`.
          const real = /^\.(.+)\.icloud$/.exec(name)?.[1];
          if (real && isMarkdown(real) && it instanceof File) out.push({ path: joinPath(rel, real), name: real, isDir: false, mtime: 0, size: 0, cloud: true });
          continue;
        }
        const path = joinPath(rel, name);
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

  async read(path: string) { return this.file(path).text(); }

  readSync(path: string) { return this.file(path).textSync(); }

  stat(path: string) {
    const f = this.file(path);
    return f.exists ? { mtime: f.modificationTime ?? 0, size: f.size ?? 0 } : null;
  }

  created(path: string) {
    try { return this.file(path).info().creationTime ?? null; } catch { return null; }
  }

  async write(path: string, text: string) {
    const parent = dirname(path);
    if (parent) await this.mkdir(parent);
    await this.file(path).write(text);
  }

  async remove(path: string) {
    const f = this.file(path);
    if (f.exists) { f.delete(); return; }
    const d = this.dir(path);
    if (d.exists) d.delete();
  }

  async move(from: string, to: string) {
    const parent = dirname(to);
    if (parent) await this.mkdir(parent);
    const src = this.file(from);
    if (src.exists) {
      const dest = this.file(to);
      if (dirname(from) === dirname(to)) src.rename(basename(to));
      else await src.move(dest);
      return;
    }
    const d = this.dir(from);
    if (d.exists) await d.move(this.dir(to));
  }

  async mkdir(path: string) {
    const d = this.dir(path);
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
  }

  async exists(path: string) { return this.file(path).exists || this.dir(path).exists; }

  async importFile(source: string, path: string) {
    const parent = dirname(path);
    if (parent) await this.mkdir(parent);
    new File(source).copy(this.file(path));
  }

  get baseUrl() { return this.root.uri.endsWith('/') ? this.root.uri : `${this.root.uri}/`; }

  fetchFromCloud() {
    return this.kind === 'picked' && FolderAccess ? FolderAccess.downloadFromCloud(this.root.uri).catch(() => 0) : Promise.resolve(0);
  }

  /** Copies everything in this vault (notes, attachments, `.vbnotes`) into `dest`, never over a file already there. */
  copyInto(dest: Directory) {
    let copied = 0;
    const walk = (from: Directory, to: Directory) => {
      if (!to.exists) to.create({ intermediates: true, idempotent: true });
      for (const it of from.list()) {
        if (it instanceof Directory) walk(it, new Directory(to, it.name));
        else if (!new File(to, it.name).exists) { it.copy(new File(to, it.name)); copied++; }
      }
    };
    walk(this.root, dest);
    return copied;
  }

  watch(cb: () => void) {
    try {
      const sub = this.root.watch(() => cb(), { debounceMs: 400 } as any);
      return () => sub.remove();
    } catch {
      return () => {};
    }
  }
}
