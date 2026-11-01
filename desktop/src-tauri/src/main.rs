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

/// What a folder dropped on the list brings along besides notes: the pictures, sound and documents they link to.
fn is_media(name: &str) -> bool {
    const MEDIA: [&str; 13] = ["png", "jpg", "jpeg", "gif", "webp", "heic", "avif", "svg", "m4a", "mp3", "wav", "aac", "pdf"];
    name.rsplit_once('.').is_some_and(|(_, ext)| MEDIA.contains(&ext.to_lowercase().as_str()))
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

/// The folders a first launch offers. `icloud`: the iPhone app's own iCloud Drive folder ("VB Notes")
/// once a phone has made it, else iCloud Drive › VBNotes; none when iCloud Drive is off or this isn't
/// a Mac. `here`: Documents › VBNotes, on this computer only.
fn places(app: &AppHandle) -> Res<(Option<PathBuf>, PathBuf)> {
    let home = app.path().home_dir().map_err(text)?;
    let mobile = home.join("Library/Mobile Documents");
    let phone = mobile.join("iCloud~com~lavneet~vbnotes");
    let icloud = if phone.is_dir() {
        Some(phone.join("Documents"))
    } else if mobile.join("com~apple~CloudDocs").is_dir() {
        Some(mobile.join("com~apple~CloudDocs/VBNotes"))
    } else {
        None
    };
    Ok((icloud, app.path().document_dir().unwrap_or(home.join("Documents")).join("VBNotes")))
}

#[derive(Serialize)]
struct Places {
    icloud: Option<String>,
    here: String,
}

#[tauri::command]
fn folder_places(app: AppHandle) -> Res<Places> {
    let (icloud, here) = places(&app)?;
    let show = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(Places { icloud: icloud.map(show), here: show(here) })
}

/// Makes one of the first launch's folders (`icloud` or `here`) and returns its path.
#[tauri::command]
fn make_place(app: AppHandle, place: String) -> Res<String> {
    let (icloud, here) = places(&app)?;
    let dir = if place == "icloud" { icloud.ok_or("iCloud Drive is off on this Mac")? } else { here };
    fs::create_dir_all(&dir).map_err(text)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// A folder named on the command line (`vbnotes ~/Notes`, `open -a VBNotes --args ~/Notes`), opened instead of the last one.
#[tauri::command]
fn launch_folder() -> Option<String> {
    std::env::args().skip(1).find(|a| Path::new(a).is_dir())
}

/// Notes opened from Finder or Explorer ("Open with › VB Notes"), kept until the page takes them:
/// they can arrive before it has loaded, or before a notes folder is chosen.
#[derive(Default)]
struct Opened(Mutex<Vec<String>>);

/// The notes among command-line arguments: Windows and Linux pass opened files that way.
fn note_args(args: impl Iterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.filter(|a| is_markdown(a))
        .map(|a| cwd.join(a))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Keeps opened notes for the page, tells it they are there, and brings the window forward.
fn hand_over(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut opened) = app.state::<Opened>().0.lock() {
        opened.extend(paths);
    }
    let _ = app.emit("files-opened", ());
    show_main(app);
}

/// Brings the window back: from the tray, or when the app is started again while it runs.
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// "Keep running in the tray" (Settings, Windows): closing the window hides it (the page does
/// that), and this icon brings it back or quits.
#[tauri::command]
fn set_tray(app: AppHandle, on: bool) -> Res<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    if !on {
        app.remove_tray_by_id("main");
        return Ok(());
    }
    if app.tray_by_id("main").is_some() {
        return Ok(());
    }
    let show = MenuItem::with_id(&app, "show", "Open VB Notes", true, None::<&str>).map_err(text)?;
    let quit = MenuItem::with_id(&app, "quit", "Quit VB Notes", true, None::<&str>).map_err(text)?;
    let menu = Menu::with_items(&app, &[&show, &quit]).map_err(text)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("VB Notes")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => quit_soon(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(&app).map_err(text)?;
    Ok(())
}

/// Quit from the tray: the page saves the open note and calls `quit`; if it can't, the app goes anyway.
fn quit_soon(app: &AppHandle) {
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        app.exit(0);
    });
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn opened_files(opened: State<'_, Opened>) -> Vec<String> {
    opened.0.lock().map(|mut o| std::mem::take(&mut *o)).unwrap_or_default()
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

/// Copies the open folder (notes, attachments, `.vbnotes`) into `to` before switching to it,
/// never over a file already there. Returns how many files were copied.
#[tauri::command]
async fn copy_folder(open: State<'_, Open>, to: String) -> Res<i64> {
    fn walk(from: &Path, to: &Path, copied: &mut i64) -> Res<()> {
        fs::create_dir_all(to).map_err(text)?;
        for item in fs::read_dir(from).map_err(text)?.flatten() {
            let (src, dest) = (item.path(), to.join(item.file_name()));
            if item.file_type().map_err(text)?.is_dir() {
                walk(&src, &dest, copied)?;
            } else if !dest.exists() {
                fs::copy(&src, &dest).map_err(text)?;
                *copied += 1;
            }
        }
        Ok(())
    }
    let root = with(&open, |f| Ok(f.root.clone()))?;
    let dest = PathBuf::from(&to);
    if dest.starts_with(&root) || root.starts_with(&dest) {
        return Err("Pick a folder outside the current one".into());
    }
    let mut copied = 0;
    walk(&root, &dest, &mut copied)?;
    Ok(copied)
}

/// What each path dropped on the window is: `dir`, `file`, or none when it can't be read.
#[tauri::command]
fn path_kinds(paths: Vec<String>) -> Vec<Option<&'static str>> {
    paths.iter().map(|p| fs::metadata(p).ok().map(|m| if m.is_dir() { "dir" } else { "file" })).collect()
}

/// Copies a folder dropped on the list (an export from another notes app) into the notes folder
/// as `to`: its notes and the pictures and sound they link to. Hidden files and links stay behind,
/// and nothing is copied over a file already there. Returns how many files were copied.
#[tauri::command]
async fn import_folder(open: State<'_, Open>, from: String, to: String) -> Res<i64> {
    fn walk(from: &Path, to: &Path, copied: &mut i64) -> Res<()> {
        for item in fs::read_dir(from).map_err(text)?.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let (src, dest) = (item.path(), to.join(&name));
            let kind = item.file_type().map_err(text)?;
            if kind.is_dir() {
                walk(&src, &dest, copied)?;
            } else if kind.is_file() && (is_markdown(&name) || is_media(&name)) && !dest.exists() {
                fs::create_dir_all(to).map_err(text)?;
                fs::copy(&src, &dest).map_err(text)?;
                *copied += 1;
            }
        }
        Ok(())
    }
    let (root, dest) = with(&open, |f| Ok((f.root.clone(), inside(&f.root, &to)?)))?;
    let src = PathBuf::from(&from);
    if src.starts_with(&root) || root.starts_with(&src) {
        return Err("That folder is already part of your notes".into());
    }
    let mut copied = 0;
    walk(&src, &dest, &mut copied)?;
    Ok(copied)
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
async fn db_titles(open: State<'_, Open>, q: String, limit: i64) -> Res<Vec<NoteMeta>> {
    with(&open, |f| f.index.titles(&q, limit))
}

/// Where a new file `to` goes in the folder, its parent made; never a file already there.
fn new_file(root: &Path, to: &str) -> Res<PathBuf> {
    let dest = inside(root, to)?;
    if dest.exists() {
        return Err(format!("{to} already exists"));
    }
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(text)?;
    }
    Ok(dest)
}

/// Copies a file picked outside the folder (a picture for a note) to `to` in it, never over a file
/// already there. The same file again (a note opened twice from Finder) is already there: no copy.
#[tauri::command]
async fn import_file(open: State<'_, Open>, from: String, to: String) -> Res<Stat> {
    with(&open, |f| {
        let there = inside(&f.root, &to)?;
        if there.is_file() && fs::read(&there).ok() == fs::read(&from).ok() {
            return stat_of(&there).ok_or_else(|| format!("{to} can't be read"));
        }
        let dest = new_file(&f.root, &to)?;
        fs::copy(&from, &dest).map_err(text)?;
        stat_of(&dest).ok_or_else(|| format!("{to} was not copied"))
    })
}

/// The welcome note's picture, the phone app's own (`assets/welcome`), built into the app.
#[tauri::command]
async fn welcome_picture(open: State<'_, Open>, to: String) -> Res<Stat> {
    with(&open, |f| {
        let dest = new_file(&f.root, &to)?;
        fs::write(&dest, include_bytes!("../../../assets/welcome/mountains.png")).map_err(text)?;
        stat_of(&dest).ok_or_else(|| format!("{to} was not written"))
    })
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
        // First, so a second copy hands over its files before it sets anything up.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            show_main(app);
            hand_over(app, note_args(args.into_iter().skip(1), Path::new(&cwd)));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Open::default())
        .manage(Opened::default())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            hand_over(app.handle(), note_args(std::env::args().skip(1), &cwd));
            Ok(())
        })
        .manage(meaning::Meaning::default())
        .invoke_handler(tauri::generate_handler![
            folder_places, make_place, launch_folder, open_folder, scan, read_files, write_file, move_file, copy_folder, remove_file, exists,
            db_known, db_put, db_remove, db_move, db_set_pinned, db_get, db_list, db_search, db_titles, db_counts, db_tag_counts, import_file, welcome_picture, path_kinds, import_folder, opened_files, set_tray, quit,
            meaning::meaning_enable, meaning::meaning_status, meaning::meaning_stale, meaning::meaning_set, meaning::meaning_search
        ])
        .build(tauri::generate_context!())
        .expect("VBNotes could not start")
        .run(|_app, _event| {
            // macOS sends opened files as an event, whether the app was running or not.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned());
                hand_over(_app, paths.filter(|p| is_markdown(p)).collect());
            }
        });
}
