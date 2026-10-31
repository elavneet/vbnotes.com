// No console window behind the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod index;
mod meaning;

use index::{Counts, Hit, Index, Known, NoteMeta, Record, TagCount};
use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

/// The open notes folder: its files, its index and a watcher that tells the app when files change.
struct Folder {
    root: PathBuf,
    index: Index,
    _watcher: Debouncer<RecommendedWatcher>,
}

#[derive(Default)]
struct Open(Mutex<Option<Folder>>);

type Res<T> = Result<T, String>;

#[derive(Serialize)]
struct Entry {
    path: String,
    mtime: i64,
    size: i64,
    /// Only in iCloud for now (a `.Name.md.icloud` stand-in): it can't be read until it comes down.
    cloud: bool,
}

#[derive(Serialize)]
struct Stat {
    mtime: i64,
    size: i64,
}

fn text(e: impl ToString) -> String {
    e.to_string()
}

fn stat_of(p: &Path) -> Option<Stat> {
    let m = fs::metadata(p).ok()?;
    let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as i64);
    Some(Stat { mtime, size: m.len() as i64 })
}

/// A path inside the notes folder as the app writes it ("dev/Hello.md"): nothing absolute, no `..`.
fn inside(root: &Path, rel: &str) -> Res<PathBuf> {
    let p = Path::new(rel);
    if rel.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("Not a path in the notes folder: {rel}"));
    }
    Ok(root.join(p))
}

fn with<T>(open: &State<'_, Open>, f: impl FnOnce(&mut Folder) -> Res<T>) -> Res<T> {
    let mut guard = open.0.lock().map_err(text)?;
    f(guard.as_mut().ok_or("No notes folder is open")?)
}

fn is_markdown(name: &str) -> bool {
    let l = name.to_lowercase();
    l.ends_with(".md") || l.ends_with(".markdown") || l.ends_with(".txt")
}

fn join(rel: &str, name: &str) -> String {
    if rel.is_empty() { name.to_string() } else { format!("{rel}/{name}") }
}

/// Every note file under `dir`. Hidden files and folders (`.vbnotes`, `.git`) are skipped.
fn walk(dir: &Path, rel: &str, out: &mut Vec<Entry>) {
    let Ok(items) = fs::read_dir(dir) else { return };
    for item in items.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        let Ok(kind) = item.file_type() else { continue };
        if let Some(hidden) = name.strip_prefix('.') {
            if let Some(real) = hidden.strip_suffix(".icloud") {
                if kind.is_file() && is_markdown(real) {
                    out.push(Entry { path: join(rel, real), mtime: 0, size: 0, cloud: true });
                }
            }
            continue;
        }
        let path = join(rel, &name);
        if kind.is_dir() {
            walk(&item.path(), &path, out);
        } else if kind.is_file() && is_markdown(&name) {
            if let Some(s) = stat_of(&item.path()) {
                out.push(Entry { path, mtime: s.mtime, size: s.size, cloud: false });
            }
        }
    }
}

/// FNV-1a, to name a folder's index file after its path.
fn fnv(s: &str) -> u64 {
    s.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ b as u64).wrapping_mul(0x100_0000_01b3))
}

/// The folder to offer on first launch: iCloud Drive › VBNotes when the phone app syncs there, else Documents › VBNotes.
#[tauri::command]
fn suggested_folder(app: AppHandle, create: bool) -> Res<String> {
    let home = app.path().home_dir().map_err(text)?;
    let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs/VBNotes");
    let dir = if icloud.is_dir() { icloud } else { app.path().document_dir().unwrap_or(home.join("Documents")).join("VBNotes") };
    if create {
        fs::create_dir_all(&dir).map_err(text)?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// A folder named on the command line (`vbnotes ~/Notes`, `open -a VBNotes --args ~/Notes`), opened instead of the last one.
#[tauri::command]
fn launch_folder() -> Option<String> {
    std::env::args().skip(1).find(|a| Path::new(a).is_dir())
}

#[tauri::command]
fn open_folder(app: AppHandle, open: State<'_, Open>, path: String) -> Res<()> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    let data = app.path().app_data_dir().map_err(text)?;
    fs::create_dir_all(&data).map_err(text)?;
    let index = Index::open(&data.join(format!("notes.{:016x}.db", fnv(&path))))?;
    // Pictures in notes load straight from the folder.
    app.asset_protocol_scope().allow_directory(&root, true).map_err(text)?;
    let emitter = app.clone();
    let mut watcher = new_debouncer(Duration::from_millis(400), move |res: DebounceEventResult| {
        if res.is_ok() {
            let _ = emitter.emit("folder-changed", ());
        }
    })
    .map_err(text)?;
    watcher.watcher().watch(&root, RecursiveMode::Recursive).map_err(text)?;
    *open.0.lock().map_err(text)? = Some(Folder { root, index, _watcher: watcher });
    Ok(())
}

#[tauri::command]
async fn scan(open: State<'_, Open>) -> Res<Vec<Entry>> {
    with(&open, |f| {
        let mut out = Vec::new();
        walk(&f.root, "", &mut out);
        Ok(out)
    })
}

/// The texts of `paths`; `None` for one that can't be read.
#[tauri::command]
async fn read_files(open: State<'_, Open>, paths: Vec<String>) -> Res<Vec<Option<String>>> {
    with(&open, |f| {
        Ok(paths
            .iter()
            .map(|p| inside(&f.root, p).ok().and_then(|abs| fs::read(abs).ok()).map(|b| String::from_utf8_lossy(&b).into_owned()))
            .collect())
    })
}

#[tauri::command]
async fn write_file(open: State<'_, Open>, path: String, text: String) -> Res<Stat> {
    with(&open, |f| {
        let abs = inside(&f.root, &path)?;
        if let Some(dir) = abs.parent() {
            fs::create_dir_all(dir).map_err(self::text)?;
        }
        fs::write(&abs, text).map_err(self::text)?;
        stat_of(&abs).ok_or_else(|| format!("{path} was not written"))
    })
}

/// Renames or moves a note; never over a file already there.
#[tauri::command]
async fn move_file(open: State<'_, Open>, from: String, to: String) -> Res<Stat> {
    with(&open, |f| {
        let (src, dest) = (inside(&f.root, &from)?, inside(&f.root, &to)?);
        if dest.exists() {
            return Err(format!("{to} already exists"));
        }
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir).map_err(text)?;
        }
        fs::rename(&src, &dest).map_err(text)?;
        stat_of(&dest).ok_or_else(|| format!("{to} is missing after the move"))
    })
}

#[tauri::command]
async fn remove_file(open: State<'_, Open>, path: String) -> Res<()> {
    with(&open, |f| fs::remove_file(inside(&f.root, &path)?).map_err(text))
}

#[tauri::command]
async fn exists(open: State<'_, Open>, path: String) -> Res<bool> {
    with(&open, |f| Ok(inside(&f.root, &path)?.exists()))
}

#[tauri::command]
async fn db_known(open: State<'_, Open>) -> Res<Vec<Known>> {
    with(&open, |f| f.index.known())
}

#[tauri::command]
async fn db_put(open: State<'_, Open>, records: Vec<Record>, pinned: Vec<String>) -> Res<()> {
    with(&open, |f| f.index.put(records, pinned))
}

#[tauri::command]
async fn db_remove(open: State<'_, Open>, paths: Vec<String>) -> Res<()> {
    with(&open, |f| f.index.remove(paths))
}

#[tauri::command]
async fn db_move(open: State<'_, Open>, from: String, to: String, section: String, mtime: i64) -> Res<()> {
    with(&open, |f| f.index.move_note(&from, &to, &section, mtime))
}

#[tauri::command]
async fn db_set_pinned(open: State<'_, Open>, paths: Vec<String>) -> Res<()> {
    with(&open, |f| f.index.set_pinned(paths))
}

#[tauri::command]
async fn db_get(open: State<'_, Open>, path: String) -> Res<Option<NoteMeta>> {
    with(&open, |f| f.index.get(&path))
}

#[tauri::command]
async fn db_list(open: State<'_, Open>, section: String, tag: String, limit: i64, hidden: Vec<String>) -> Res<Vec<NoteMeta>> {
    with(&open, |f| f.index.list(&section, &tag, limit, &hidden))
}

#[tauri::command]
async fn db_search(open: State<'_, Open>, q: String, section: String, limit: i64) -> Res<Vec<Hit>> {
    with(&open, |f| f.index.search(&q, &section, limit))
}

#[tauri::command]
async fn db_counts(open: State<'_, Open>, hidden: Vec<String>) -> Res<Counts> {
    with(&open, |f| f.index.counts(&hidden))
}

#[tauri::command]
async fn db_tag_counts(open: State<'_, Open>) -> Res<Vec<TagCount>> {
    with(&open, |f| f.index.tag_counts())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Open::default())
        .manage(meaning::Meaning::default())
        .invoke_handler(tauri::generate_handler![
            suggested_folder, launch_folder, open_folder, scan, read_files, write_file, move_file, remove_file, exists,
            db_known, db_put, db_remove, db_move, db_set_pinned, db_get, db_list, db_search, db_counts, db_tag_counts,
            meaning::meaning_enable, meaning::meaning_status, meaning::meaning_stale, meaning::meaning_set, meaning::meaning_search
        ])
        .run(tauri::generate_context!())
        .expect("VBNotes could not start");
}
