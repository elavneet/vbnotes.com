@AGENTS.md

# VBNotes

A markdown notes app for iPhone (Android later). Notes are plain `.md` files in a folder, edited in a rich editor, and searchable by meaning with an AI model that runs on the phone. The owner is Lavneet Sharma. The full write-up, with diagrams and history, is the Melta note "VBNotes: Bear-style markdown notes with on-device meaning search" (id `dyq2p5bftgq5`).

## Rules from the owner

- **The phone app stays mobile only.** Don't add `Platform.OS === 'web'` branches or web-only packages to it. The desktop app (2026-10-31, Lavneet asked for "cross platform, no electron") is separate: Tauri 2 in `desktop/`, sharing the editor extensions and plain-TypeScript code, with its own `package.json` for the Tauri packages.
- **Lavneet builds the phone app.** Never run a build or install on the iPhone. For phone build errors, find the cause and say the fix. Simulator builds are fine.
- **Ink & Volt colours, Bear controls, lean code.** The "Ink & Volt" style: Ink dark and Paper light themes, the system font, a lime Volt accent used sparingly, tags tinted per tag. These stay the defaults; since 2026-10-30 Settings also offers Bear's theme set (public palettes plus our own Red Graphite, Dark Graphite and High Contrast) and Bear-style typography, as Lavneet asked. The note screen's controls copy Bear exactly (Lavneet asked on 2026-10-30): the toolbar over the keyboard, the format keyboard that replaces it, the back circle and (i)/⋮ pill, the Statistics/Outline sheet, the drop-down menu, and the sidebar order. Check whether a few lines of RN code do the job before adding a package. Drop anything laggy.
- Don't commit unless asked.
- Never click or type on the simulator (cliclick once opened Safari and another app). Use deep links and temporary code patches instead (see Testing).

## Stack

- Expo SDK 58, React Native 0.88, React 19.3, expo-router 58.
- zustand for state; `expo-sqlite` for the note index.
- Editor: `@10play/tentap-editor` 1.1 (Tiptap 3 in a WebView) with our own web bundle in `editor-web/`.
- Search: `react-native-executorch` 0.10.7. It needs a development build; in Expo Go, search falls back to keywords.
- Folder access: `expo-file-system` plus our iOS module `modules/vb-folder`.
- Media: expo-audio, expo-image-picker, expo-image-manipulator, expo-document-picker.
- Share sheet: expo-share-intent.
- Expo docs for this version: https://docs.expo.dev/versions/v58.0.0/

## Where things are

| Path | What it does |
|---|---|
| `PRODUCT.md` | Product brief read by the impeccable design skill (`~/.claude/skills/impeccable`): users, jobs, constraints, the Ink & Volt commitment |
| `src/app/` | Screens: `index` (notes feed + library drawer), `note/[id]`, `search`, `settings`, `_layout` (runs indexing and share handling; gives the navigation theme the app background, or light grey shows at the screen corners while a screen slides), `+native-intent` (share-sheet links) |
| `src/store/notes.ts` | The notes store: scans the folder (reading only new or changed files), saves, renames a file after its title, archive/trash, pins and tag icons in `.vbnotes/meta.json`. `useNoteList`/`useNote` read rows from the index |
| `src/store/noteModel.ts` | The note model shared with the desktop app: `NoteMeta`, `NoteRecord`, `TagNode`, `sectionOf`, `recordFrom` (title, preview, tags, hash, plain text of a file), `buildTags`. Plain TypeScript, no React Native |
| `src/store/noteDb.ts` | The note index: SQLite per notes folder (`.vbnotes-kv/notes.<hash>-<length>.db`) with each note's title, preview, tags, date, pin and text hash, a tag table (each tag plus its parents) and FTS5 full-text search. Rebuilt from the files when missing or when its `VERSION` changes |
| `src/store/settings.ts` | Light/dark/system mode, the light and the dark theme, search mode, search model, typography (saved in `.vbnotes-kv/settings.v1.json`) |
| `src/theme/` | `tokens.ts` Ink and Paper by hand; `themes.ts` the other themes, each a few base colours that `make` turns into a full theme; `typography.ts` the editor fonts (iOS built-ins only) with their measured ascent and descent, and the size, line height and paragraph spacing |
| `src/vault/` | The notes folder. `localVault.ts` reads and writes files; `index.ts` handles the saved location, the folder picker and fallback; `folderAccess.ts` wraps the native module |
| `modules/vb-folder/` | iOS Swift module: security-scoped bookmarks so a picked folder (iCloud Drive etc.) stays open after a relaunch, and asks iCloud to download notes that are only in the cloud. Changing it needs a rebuild |
| `editor-web/` | The editor page (Vite). `tagPills.ts` tag pills (a stray trailing `/` is hidden), `links.ts` tap to open links plus the "Open" chip, `codeBlocks.ts` code colours and Mermaid diagrams, `media.ts` images and audio rows, `codePaste.ts` paste while code is on, `wordTaps.ts` double tap selects what is under the finger (WebKit picks the previous word for `//` or a line start), `mergeFormats.ts` code, quote and list keys over lines that are partly formatted make one block (stock Tiptap split or nested them), `markdownPush.ts` sends the note's markdown to the app as it is edited |
| `src/editor/` | App side of the editor: `markdownBridge.ts` (load/save markdown, minimal escaping), `mediaBridge.ts`, `linkBridge.ts`, `editorCss.ts` (all editor styles, from the theme), `highlight.ts` (code colours; a block that names no language is coloured as the one it looks like, `guessLanguage`) |
| `src/editor/editorHtml.js` | Built bundle (about 1.1 MB). Never edit it by hand; run `npm run editor:build` |
| `src/components/NoteEditor.tsx` | Hosts the editor WebView: autosave, attachments, audio playback, opening links |
| `src/components/EditorToolbar.tsx`, `FormatKeyboard.tsx` | Bear-style bar over the keyboard; BIU swaps the keyboard for the format keyboard (tentap `CustomKeyboard`, native `TenTapKeyboard` driver). Keys that tentap lacks go through `src/editor/editBridge.ts` (caret jumps, delete, return, table, rule, code block, outline jumps) |
| `src/components/QuickOpen.tsx` | The dock's Volt search-and-add button opens it: a Spotlight-style finder. Typed text matches notes by title and words (`keywordSearch`); the first row always creates a note titled with the text (Return picks it), and the file is named after that title at once |
| `src/components/NoteInfoSheet.tsx`, `MenuPopover.tsx` | The note's (i) sheet (counts, dates, outline) and ⋮ menu |
| `src/components/NotePreview.tsx` | Native drawing of the note shown while the WebView starts. It must match the editor pixel for pixel (same numbers as `EDITOR` in `editorCss.ts` and the same `Typography`), or the note jumps when it opens. WebKit rounds a font's ascent and descent up to whole points; `cssLine` copies that. A new font needs its UIKit ascender/descender measured (`onTextLayout` at 100 pt) and its weights checked: where UIKit and WebKit pick different faces for 500/600/800, map the weight in `weights` |
| `src/components/Library.tsx` | Drawer/side panel: All notes, Untagged, nested tags with icons (hold a tag to change its icon; the right 30% of a row folds its sub tags), Archive, Trash |
| `src/search/` | `models.ts` lists the search models; `nativeEmbedder.ts` loads one; `semanticIndex.ts` handles chunks, int8 vectors and the saved index; `index.ts` merges keyword and meaning results; `useIndexing.ts` |
| `src/media/` | Attachments (`attachments/` folder in the vault), the audio player, share-sheet intake |
| `desktop/` | The desktop app (Tauri 2, macOS/Windows/Linux). `src-tauri/src/main.rs` folder commands (scan, read, write, move, a watcher that emits `folder-changed`; paths are checked to stay inside the folder), `index.rs` the same SQLite schema and queries as `noteDb.ts`. `src/store.ts` the desktop notes store (async port of `notes.ts`), `NoteEditor.tsx` the phone's editor extensions in the page itself (`host.ts` stands in for `window.ReactNativeWebView`: links open in the browser, sounds play in the page, pictures load through Tauri's asset protocol), `Settings.tsx` (⌘,) appearance, themes, typography, folder. The page builds from the repo's `node_modules` (`desktop/vite.config.ts` aliases tentap and ProseMirror like `editor-web`) |
| `docs/screenshots/` | README pictures: phone from the simulator, desktop from the app with a demo folder |
| `src/utils/tags.ts` | Tag parsing (`#tag`, `#a/b`, `#multi word#`); `rawEnd` includes a trailing `/` or `-` |

## How the main parts work

- **Notes:** each note is one `.md` file in the notes folder. The default folder is `<Documents>/VBNotes`, which shows in the Files app under On My iPhone. Notes can also live in any folder picked in Files (iCloud Drive, SeafilePro…). Google Drive, Dropbox and OpenCloud can't be picked: their storage apps don't allow folder picking on iOS (`NSExtensionFileProviderSupportsPickingFolders`). Attachments are saved under `attachments/` and linked relative to the folder.
- **Note index (2026-10-30):** the list, tag counts and keyword search come from the SQLite index, not from every note held in memory. A launch opens the saved folder, its index, its pins and the settings synchronously before the first frame (`openAtLaunch` in `notes.ts`, `kvGetSync`), so the list never starts blank or in the wrong theme. The scan then reads only files whose size or date changed (all of them on a first launch, in batches of 100 so the list fills as it goes); a later scan changes the list once at the end, and not at all when nothing changed. Saves and moves store the file's own date and size (`vault.stat`), or the next scan would read them again. A note iCloud has removed from the phone (a hidden `.Name.md.icloud` stand-in) keeps its row until it comes back. The list loads 200 rows at a time and the next 200 near the end. Note texts are read when a note opens (`getText` reads the file at once if it is not cached). Keyword search is FTS5 word starts ("gro" finds "Groceries"); it no longer finds text in the middle of a word.
- **Editor:** the note's markdown ships inside the page, so the first frame is already styled. The page sends the markdown to the app as it is edited (at most every 150 ms); the app writes it 1 s after typing stops, and at once when the note closes. Asking the page for it on close lost edits on a quick swipe back (the page was gone before it answered). Images resolve against `webviewBaseURL` = the notes folder. That needs `originWhitelist={['about:*','file://*']}` on `RichText`; without it the editor stays blank. Audio plays natively through `mediaBridge`, because WKWebView would not play local files. A tapped link opens through `linkBridge` → `Linking.openURL`; `src/utils/links.ts` blocks `javascript:`, `file:` and similar links.
- **Scrolling:** tentap turns the WebView's own scrolling off (`scrollEnabled={false}`), so the editor scrolls inside `#root > div` (`editor-web/index.html`). Without that box a long note could not be scrolled at all. `disableColorHighlight: true` is set: tentap's selection tint rewrapped the selected text on every change, which broke dragging the selection handles. The editor's view ends at the top of the toolbar and keyboard (`NoteEditor` measures them), so a selection handle dragged down scrolls the note at the toolbar instead of selecting text hidden under the keyboard.
- **Bare web addresses** stay bare in the file (`withPlainLinks` in `editor-web/links.ts`). Before this, every save rewrote them as `[url](url)`.
- **Meaning search:** notes are split into chunks sized for the model, with the title on each chunk. Each chunk is embedded on the phone and saved as int8 in `.vbnotes-kv/semantic.index.v2.<model>.json`. A long run (a first launch, a new model) saves every 20 s, so closing the app doesn't start it over. Queries use the `query:` prompt and notes the `document:` prompt for LFM2.5. Meaning matches are kept if they score at least the model's `minScore` and are within 0.25 of the best match, up to 10. Keyword results are merged in with reciprocal rank fusion.
  - Models: Standard is LFM2.5 350M (default, about 193 MB, strongest, no Hindi); Light is MiniLM (44 MB); Many languages is a multilingual MiniLM (about 235 MB, matches Hindi to English and back).
  - Switching models re-indexes every note and deletes the other models' downloads.
  - The library's timing logs and download stats are turned off. The timing filter is `src/utils/quietLogs.ts`, imported first in `index.ts`: the logs come from a worklet runtime whose console copies `console.log` when react-native-worklets loads.
  - **Model download** runs inside the app (react-native-executorch's blob-util stream), not as an iOS background download. Measured 2026-10-29 on the simulator: in-app 2.4 MB/s, iOS background session 0.05–0.9 MB/s. So the app keeps the screen awake while it downloads (`expo-keep-awake`), and if the app is left the download stops; `useIndexing` starts it again when the app is back and the library continues from the `.partial` file. Settings shows "Keep VBNotes open…" meanwhile.
  - `@kesha-antonov/react-native-background-downloader` must stay out of `package.json`: if it is linked natively, the library uses it automatically. It still sits in `node_modules` as an optional peer of react-native-executorch; that is harmless while it is not autolinked.

## Commands

```bash
npx tsc --noEmit && npx tsc -p editor-web/tsconfig.json && npx expo lint   # before calling anything done
npm run editor:build                                                      # after any change in editor-web/
npx expo install <pkg>                                                    # never npm install for Expo packages
(cd ios && pod install)                                                   # after adding or changing a native module
npx expo run:ios --no-bundler --device A1447AEE-B91B-4B6A-8171-1077B7E46732   # simulator build (iPhone 15 Pro)
```

Desktop:

```bash
(cd desktop && npx tsc -p tsconfig.json)                                  # typecheck the desktop page
(cd desktop && npx tauri build --debug --no-bundle)                       # quick build: desktop/src-tauri/target/debug/vbnotes <folder>
(cd desktop && APPLE_SIGNING_IDENTITY="Developer ID Application: Ramarya Software Services LLP (J9YMW2253U)" npx tauri build --target universal-apple-darwin)
```

Releases: push a `v*` tag; `.github/workflows/release.yml` builds Windows, Linux and Android into that tag's release. The macOS dmg is built and signed here, notarized with `xcrun notarytool`, and uploaded with `gh release upload`. `main` on GitHub (`elavneet/vbnotes.com`) only takes pull requests (a ruleset with no bypass).

VBNotes' Metro runs on port 8081 (Lavneet usually has it running). Port 8082 is the Go2Lister project's Metro, so leave it alone. The lint warning about `editorHtml.js` is expected.

## Testing on the simulator

- **Open the app and notes:**
  - Simulator UDID `A1447AEE-B91B-4B6A-8171-1077B7E46732`.
  - Open the dev build with `xcrun simctl openurl <udid> "vbnotes://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`, then deep link to a note with `vbnotes://note/<url-encoded path>` and screenshot with `xcrun simctl io <udid> screenshot <file>`.
  - There is no expo-dev-client: the debug build always loads JS from Metro on port 8081 (Lavneet's), and the `url=` part of that link is ignored. A second Metro on another port is not used by the simulator. Your simulator app therefore shows up in Lavneet's Metro logs; keep sessions short and terminate the app afterwards (`xcrun simctl terminate <udid> com.lavneet.vbnotes`).
  - Notes are in `$(xcrun simctl get_app_container <udid> com.lavneet.vbnotes data)/Documents/VBNotes`. To seed a test note, write a file there and relaunch.
- **UI that needs a tap:** patch the code for a moment (flip a `useState` default, or call `openDrawer()` in a `setTimeout`), screenshot, then restore. Lavneet's phone hot-reloads from the same Metro, so keep these patches short and inert.
- **Run code inside the editor or app without taps:** add a temporary hook that `fetch`es a script or test set from a local server on `127.0.0.1:8099` and POSTs results back. The phone can't reach that server, so the hook does nothing there. For the editor, use `editor.injectJS(script)`. Remove the hook afterwards (grep for `TEMP-`).
- **Preview vs editor jump:** keep the preview on and fade the editor to 0, screenshot, restore, then screenshot the editor. Diff the two with ffmpeg (`blend=all_mode=difference`) and scan pixel rows. On 2026-10-28 the remaining difference was 1–2 device pixels.
- **Settings for a test:** write `.vbnotes-kv/settings.v1.json` in the app's `Documents` (for example `{"theme":"dark","darkTheme":"dracula","typography":{"size":17,"line":1.8,"para":1,"text":"georgia","head":"avenir","code":"sfMono"}}`), relaunch, and delete the file afterwards.
- **Phone files (read only):** `xcrun devicectl device info files --device 00008110-001908900A43801E --domain-type appDataContainer --domain-identifier com.lavneet.vbnotes --subdirectory Documents/...`
- **Signing:** team `J9YMW2253U`. The app group `group.com.lavneet.vbnotes` is used by the share extension `SavetoVBNotes`.

## Open items

- **Note index limits (2026-10-30):** the list, tags and keyword search scale to tens of thousands of notes, but the meaning index still keeps every vector in memory and in one JSON file; past a few thousand notes it should move into SQLite too. `ios/` was regenerated (`prebuild --clean`) and the phone rebuilt with `expo-sqlite` on 2026-10-30.
- **Sync scope (decided 2026-10-29):** only iCloud Drive (works today through the folder picker) and Google Drive. Google Drive needs sync through Google's API, because iOS can't pick Drive folders. Not built yet. WebDAV/OpenCloud and Dropbox are dropped for now.
- Picking folders on Android is untested (it uses SAF `content://` folders).
- Raw HTML in notes is lost on save. Mermaid code lines show in list previews.
- Tag autocomplete; reusing one editor WebView across notes.
