import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { Directory, Paths } from 'expo-file-system';
import { hashText } from '@/utils/markdown';
import { UNTAGGED, type NoteMeta, type NoteRecord, type Section, type SectionCounts } from './noteModel';

export { UNTAGGED, type NoteMeta, type NoteRecord, type Section, type SectionCounts } from './noteModel';

const VERSION = 1;
const SCHEMA = `
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  preview TEXT NOT NULL,
  image TEXT,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  tags TEXT NOT NULL,
  hash TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX notes_feed ON notes (section, pinned DESC, mtime DESC);
-- Each tag and every tag above it: #a/b gives rows for a and a/b, so a parent counts and lists its children's notes.
CREATE TABLE note_tags (tag TEXT NOT NULL, note INTEGER NOT NULL, PRIMARY KEY (tag, note)) WITHOUT ROWID;
CREATE INDEX note_tags_note ON note_tags (note);
CREATE VIRTUAL TABLE notes_text USING fts5 (title, body, tokenize = 'unicode61 remove_diacritics 2');
`;

type Row = { path: string; title: string; preview: string; image: string | null; mtime: number; tags: string; pinned: number };
const COLS = 'n.path, n.title, n.preview, n.image, n.mtime, n.tags, n.pinned';

const withParents = (tags: string[]) => {
  const out = new Set<string>();
  for (const t of tags) {
    const parts = t.split('/');
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return out;
};

/**
 * The note list, tags and keyword search in SQLite, one database per notes folder. The files stay
 * the truth: this is rebuilt from them when missing, and a launch reads only files whose size or
 * date changed. Screens ask for the rows they show instead of holding every note in memory.
 */
export class NoteDb {
  // Unchanged rows come back as the same objects, so list rows do not re-render on every save.
  private seen = new Map<string, NoteMeta>();

  constructor(private db: SQLiteDatabase) {}

  private meta(r: Row): NoteMeta {
    const old = this.seen.get(r.path);
    if (old && old.mtime === r.mtime && old.pinned === !!r.pinned && old.title === r.title) return old;
    const m = { path: r.path, title: r.title, preview: r.preview, image: r.image, mtime: r.mtime, pinned: !!r.pinned, tags: JSON.parse(r.tags) as string[] };
    if (this.seen.size > 5000) this.seen.clear();
    this.seen.set(r.path, m);
    return m;
  }

  /** Size and date of every indexed file, to find what changed on disk. */
  known(): Map<string, { mtime: number; size: number }> {
    const out = new Map<string, { mtime: number; size: number }>();
    for (const r of this.db.getAllSync<{ path: string; mtime: number; size: number }>('SELECT path, mtime, size FROM notes')) {
      out.set(r.path, { mtime: r.mtime, size: r.size });
    }
    return out;
  }

  put(records: NoteRecord[], pinned: ReadonlySet<string>) {
    this.db.withTransactionSync(() => {
      for (const n of records) {
        const { id } = this.db.getFirstSync<{ id: number }>(
          `INSERT INTO notes (path, section, title, preview, image, mtime, size, tags, hash, pinned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (path) DO UPDATE SET section = excluded.section, title = excluded.title, preview = excluded.preview,
             image = excluded.image, mtime = excluded.mtime, size = excluded.size, tags = excluded.tags, hash = excluded.hash
           RETURNING id`,
          n.path, n.section, n.title, n.preview, n.image, n.mtime, n.size, JSON.stringify(n.tags), n.hash, pinned.has(n.path) ? 1 : 0,
        )!;
        this.db.runSync('DELETE FROM note_tags WHERE note = ?', id);
        for (const tag of withParents(n.tags)) this.db.runSync('INSERT INTO note_tags (tag, note) VALUES (?, ?)', tag, id);
        this.db.runSync('DELETE FROM notes_text WHERE rowid = ?', id);
        this.db.runSync('INSERT INTO notes_text (rowid, title, body) VALUES (?, ?, ?)', id, n.title, n.body);
      }
    });
  }

  remove(paths: string[]) {
    this.db.withTransactionSync(() => {
      for (const p of paths) {
        const row = this.db.getFirstSync<{ id: number }>('DELETE FROM notes WHERE path = ? RETURNING id', p);
        if (!row) continue;
        this.db.runSync('DELETE FROM note_tags WHERE note = ?', row.id);
        this.db.runSync('DELETE FROM notes_text WHERE rowid = ?', row.id);
      }
    });
  }

  move(from: string, to: string, section: Section, mtime: number) {
    this.db.runSync('UPDATE notes SET path = ?, section = ?, mtime = ? WHERE path = ?', to, section, mtime, from);
  }

  setPinned(paths: readonly string[]) {
    this.db.withTransactionSync(() => {
      this.db.runSync('UPDATE notes SET pinned = 0 WHERE pinned = 1');
      for (const p of paths) this.db.runSync('UPDATE notes SET pinned = 1 WHERE path = ?', p);
    });
  }

  get(path: string): NoteMeta | null {
    const r = this.db.getFirstSync<Row>(`SELECT ${COLS} FROM notes n WHERE n.path = ?`, path);
    return r ? this.meta(r) : null;
  }

  /** The newest `limit` notes of a section, optionally of one tag (and its nested tags), pinned first. */
  list(section: Section, tag: string, limit: number): NoteMeta[] {
    const sql = `SELECT ${COLS} FROM notes n WHERE n.section = ?`
      + (tag === UNTAGGED ? " AND n.tags = '[]'" : tag ? ' AND n.id IN (SELECT note FROM note_tags WHERE tag = ?)' : '')
      + ' ORDER BY n.pinned DESC, n.mtime DESC LIMIT ?';
    const params = tag && tag !== UNTAGGED ? [section, tag, limit] : [section, limit];
    return this.db.getAllSync<Row>(sql, params).map((r) => this.meta(r));
  }

  /** The newest `limit` notes of a section by date alone, for "Recent". */
  recent(section: Section, limit: number): NoteMeta[] {
    return this.db.getAllSync<Row>(`SELECT ${COLS} FROM notes n WHERE n.section = ? ORDER BY n.mtime DESC LIMIT ?`, section, limit)
      .map((r) => this.meta(r));
  }

  /**
   * Notes with every typed word, as a word start ("gro" finds "Groceries"), best first: an exact
   * title, then title words weighing 8× text words. The snippet is the text around the match.
   */
  search(q: string, section: Section, limit: number): { note: NoteMeta; snippet: string }[] {
    const words = q.split(/\s+/).map((w) => w.replace(/"/g, '')).filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (!words.length) return [];
    try {
      return this.db.getAllSync<Row & { snippet: string }>(
        `SELECT ${COLS}, snippet(notes_text, 1, '', '', '…', 16) AS snippet
         FROM notes_text JOIN notes n ON n.id = notes_text.rowid
         WHERE notes_text MATCH ? AND n.section = ?
         ORDER BY lower(n.title) = ? DESC, bm25(notes_text, 8.0, 1.0) LIMIT ?`,
        words.map((w) => `"${w}"*`).join(' '), section, q.trim().toLowerCase(), limit,
      ).map((r) => ({ note: this.meta(r), snippet: r.snippet }));
    } catch (e) {
      console.warn('search failed', e);
      return [];
    }
  }

  counts(): SectionCounts {
    const c: SectionCounts = { notes: 0, archive: 0, trash: 0, untagged: 0 };
    for (const r of this.db.getAllSync<{ section: Section; n: number }>('SELECT section, count(*) AS n FROM notes GROUP BY section')) c[r.section] = r.n;
    c.untagged = this.db.getFirstSync<{ n: number }>("SELECT count(*) AS n FROM notes WHERE section = 'notes' AND tags = '[]'")?.n ?? 0;
    return c;
  }

  /** Notes per tag in Notes (archive and trash left out), parents counting their children's notes once. */
  tagCounts(): { tag: string; n: number }[] {
    return this.db.getAllSync('SELECT t.tag, count(*) AS n FROM note_tags t JOIN notes ON notes.id = t.note WHERE notes.section = \'notes\' GROUP BY t.tag');
  }

  hashOf(path: string): string | undefined {
    return this.db.getFirstSync<{ hash: string }>('SELECT hash FROM notes WHERE path = ?', path)?.hash;
  }

  hashes(): Map<string, string> {
    return new Map(this.db.getAllSync<{ path: string; hash: string }>('SELECT path, hash FROM notes').map((r) => [r.path, r.hash]));
  }

  close() { this.db.closeSync(); }
}

/** Kept with the app's other private files (`.vbnotes-kv`), hidden from the Files app. */
export function openNoteDb(vaultId: string): NoteDb {
  // No `:` from the hash in the name: Finder and devicectl read it as a folder separator.
  const name = `notes.${hashText(vaultId).replace(':', '-')}.db`;
  const db = openDatabaseSync(name, undefined, new Directory(Paths.document, '.vbnotes-kv').uri);
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version;
  // An index from another version is rebuilt from the files.
  if (version !== VERSION) {
    db.execSync(`DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS note_tags; DROP TABLE IF EXISTS notes_text; ${SCHEMA} PRAGMA user_version = ${VERSION};`);
  }
  return new NoteDb(db);
}
