//! The note index: the same SQLite schema as the phone app (`src/store/noteDb.ts`). The files stay
//! the truth; this is rebuilt from them when missing, and a launch reads only files whose size or
//! date changed. The app parses notes (title, preview, tags) with the shared TypeScript code and
//! hands the results here.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

const VERSION: i64 = 1;
const SCHEMA: &str = "
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
CREATE TABLE note_tags (tag TEXT NOT NULL, note INTEGER NOT NULL, PRIMARY KEY (tag, note)) WITHOUT ROWID;
CREATE INDEX note_tags_note ON note_tags (note);
CREATE VIRTUAL TABLE notes_text USING fts5 (title, body, tokenize = 'unicode61 remove_diacritics 2');
";

const COLS: &str = "n.path, n.title, n.preview, n.image, n.mtime, n.tags, n.pinned";
const UNTAGGED: &str = ":untagged";

/// One parsed note file, as the app sends it.
#[derive(Deserialize)]
pub struct Record {
    path: String,
    section: String,
    title: String,
    preview: String,
    image: Option<String>,
    mtime: i64,
    size: i64,
    tags: Vec<String>,
    hash: String,
    body: String,
}

/// What a list row needs.
#[derive(Serialize)]
pub struct NoteMeta {
    path: String,
    title: String,
    preview: String,
    image: Option<String>,
    mtime: i64,
    pinned: bool,
    tags: Vec<String>,
}

#[derive(Serialize)]
pub struct Hit {
    note: NoteMeta,
    snippet: String,
}

#[derive(Serialize, Default)]
pub struct Counts {
    notes: i64,
    archive: i64,
    trash: i64,
    untagged: i64,
}

#[derive(Serialize)]
pub struct Known {
    path: String,
    mtime: i64,
    size: i64,
}

#[derive(Serialize)]
pub struct TagCount {
    tag: String,
    n: i64,
}

fn meta(r: &rusqlite::Row) -> rusqlite::Result<NoteMeta> {
    let tags: String = r.get(5)?;
    Ok(NoteMeta {
        path: r.get(0)?,
        title: r.get(1)?,
        preview: r.get(2)?,
        image: r.get(3)?,
        mtime: r.get(4)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        pinned: r.get::<_, i64>(6)? != 0,
    })
}

/// `#a/b` gives rows for `a` and `a/b`, so a parent counts and lists its children's notes.
fn with_parents(tags: &[String]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for t in tags {
        let parts: Vec<&str> = t.split('/').collect();
        for i in 1..=parts.len() {
            out.insert(parts[..i].join("/"));
        }
    }
    out
}

pub struct Index {
    db: Connection,
}

type Res<T> = Result<T, String>;
fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

impl Index {
    pub fn open(file: &Path) -> Res<Index> {
        let db = Connection::open(file).map_err(err)?;
        db.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;").map_err(err)?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
        // An index from another version is rebuilt from the files.
        if version != VERSION {
            db.execute_batch(&format!(
                "DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS note_tags; DROP TABLE IF EXISTS notes_text; {SCHEMA} PRAGMA user_version = {VERSION};"
            ))
            .map_err(err)?;
        }
        Ok(Index { db })
    }

    pub fn known(&self) -> Res<Vec<Known>> {
        let mut st = self.db.prepare_cached("SELECT path, mtime, size FROM notes").map_err(err)?;
        let rows = st
            .query_map([], |r| Ok(Known { path: r.get(0)?, mtime: r.get(1)?, size: r.get(2)? }))
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn put(&mut self, records: Vec<Record>, pinned: Vec<String>) -> Res<()> {
        let pinned: BTreeSet<String> = pinned.into_iter().collect();
        let tx = self.db.transaction().map_err(err)?;
        for n in &records {
            let id: i64 = tx
                .query_row(
                    "INSERT INTO notes (path, section, title, preview, image, mtime, size, tags, hash, pinned)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                     ON CONFLICT (path) DO UPDATE SET section = excluded.section, title = excluded.title, preview = excluded.preview,
                       image = excluded.image, mtime = excluded.mtime, size = excluded.size, tags = excluded.tags, hash = excluded.hash
                     RETURNING id",
                    params![
                        n.path, n.section, n.title, n.preview, n.image, n.mtime, n.size,
                        serde_json::to_string(&n.tags).unwrap_or_else(|_| "[]".into()), n.hash,
                        pinned.contains(&n.path) as i64
                    ],
                    |r| r.get(0),
                )
                .map_err(err)?;
            tx.execute("DELETE FROM note_tags WHERE note = ?1", [id]).map_err(err)?;
            for tag in with_parents(&n.tags) {
                tx.execute("INSERT INTO note_tags (tag, note) VALUES (?1, ?2)", params![tag, id]).map_err(err)?;
            }
            tx.execute("DELETE FROM notes_text WHERE rowid = ?1", [id]).map_err(err)?;
            tx.execute("INSERT INTO notes_text (rowid, title, body) VALUES (?1, ?2, ?3)", params![id, n.title, n.body])
                .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn remove(&mut self, paths: Vec<String>) -> Res<()> {
        let tx = self.db.transaction().map_err(err)?;
        for p in &paths {
            let id: Option<i64> = tx
                .query_row("DELETE FROM notes WHERE path = ?1 RETURNING id", [p], |r| r.get(0))
                .optional()
                .map_err(err)?;
            if let Some(id) = id {
                tx.execute("DELETE FROM note_tags WHERE note = ?1", [id]).map_err(err)?;
                tx.execute("DELETE FROM notes_text WHERE rowid = ?1", [id]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }

    pub fn move_note(&self, from: &str, to: &str, section: &str, mtime: i64) -> Res<()> {
        self.db
            .execute("UPDATE notes SET path = ?1, section = ?2, mtime = ?3 WHERE path = ?4", params![to, section, mtime, from])
            .map(|_| ())
            .map_err(err)
    }

    pub fn set_pinned(&mut self, paths: Vec<String>) -> Res<()> {
        let tx = self.db.transaction().map_err(err)?;
        tx.execute("UPDATE notes SET pinned = 0 WHERE pinned = 1", []).map_err(err)?;
        for p in &paths {
            tx.execute("UPDATE notes SET pinned = 1 WHERE path = ?1", [p]).map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn get(&self, path: &str) -> Res<Option<NoteMeta>> {
        self.db
            .query_row(&format!("SELECT {COLS} FROM notes n WHERE n.path = ?1"), [path], meta)
            .optional()
            .map_err(err)
    }

    /// The newest `limit` notes of a section, optionally of one tag (and its nested tags), pinned first.
    pub fn list(&self, section: &str, tag: &str, limit: i64) -> Res<Vec<NoteMeta>> {
        let filter = if tag == UNTAGGED {
            " AND n.tags = '[]'"
        } else if !tag.is_empty() {
            " AND n.id IN (SELECT note FROM note_tags WHERE tag = ?3)"
        } else {
            ""
        };
        let sql = format!("SELECT {COLS} FROM notes n WHERE n.section = ?1{filter} ORDER BY n.pinned DESC, n.mtime DESC LIMIT ?2");
        let mut st = self.db.prepare_cached(&sql).map_err(err)?;
        let rows = if filter.contains("?3") {
            st.query_map(params![section, limit, tag], meta)
        } else {
            st.query_map(params![section, limit], meta)
        }
        .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    /// Notes with every typed word as a word start ("gro" finds "Groceries"), best first: an exact
    /// title, then title words weighing 8× text words. The snippet is the text around the match.
    pub fn search(&self, q: &str, section: &str, limit: i64) -> Res<Vec<Hit>> {
        let words: Vec<String> = q
            .split_whitespace()
            .map(|w| w.replace('"', ""))
            .filter(|w| w.chars().any(|c| c.is_alphanumeric()))
            .map(|w| format!("\"{w}\"*"))
            .collect();
        if words.is_empty() {
            return Ok(vec![]);
        }
        let sql = format!(
            "SELECT {COLS}, snippet(notes_text, 1, '', '', '…', 16) FROM notes_text JOIN notes n ON n.id = notes_text.rowid
             WHERE notes_text MATCH ?1 AND n.section = ?2
             ORDER BY lower(n.title) = ?3 DESC, bm25(notes_text, 8.0, 1.0) LIMIT ?4"
        );
        let mut st = self.db.prepare_cached(&sql).map_err(err)?;
        let rows = st
            .query_map(params![words.join(" "), section, q.trim().to_lowercase(), limit], |r| {
                Ok(Hit { note: meta(r)?, snippet: r.get(7)? })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn counts(&self) -> Res<Counts> {
        let mut c = Counts::default();
        let mut st = self.db.prepare_cached("SELECT section, count(*) FROM notes GROUP BY section").map_err(err)?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(err)?;
        for row in rows {
            let (section, n) = row.map_err(err)?;
            match section.as_str() {
                "notes" => c.notes = n,
                "archive" => c.archive = n,
                "trash" => c.trash = n,
                _ => {}
            }
        }
        c.untagged = self
            .db
            .query_row("SELECT count(*) FROM notes WHERE section = 'notes' AND tags = '[]'", [], |r| r.get(0))
            .map_err(err)?;
        Ok(c)
    }

    /// Notes per tag in Notes (archive and trash left out), parents counting their children's notes once.
    pub fn tag_counts(&self) -> Res<Vec<TagCount>> {
        let mut st = self
            .db
            .prepare_cached(
                "SELECT t.tag, count(*) FROM note_tags t JOIN notes ON notes.id = t.note WHERE notes.section = 'notes' GROUP BY t.tag",
            )
            .map_err(err)?;
        let rows = st.query_map([], |r| Ok(TagCount { tag: r.get(0)?, n: r.get(1)? })).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }
}
