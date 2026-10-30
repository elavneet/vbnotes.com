# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

Android comes later from the same code. The web version will be a separate React + Vite app.

## Users

Lavneet Sharma, the owner, on iPhone. Three jobs, all frequent: jot a quick note, find and reread an old note, write a long note.

A growing share of notes is written by AI agents (for example Claude Code hooks) as `.md` files into a synced folder, usually iCloud Drive or Google Drive. VBNotes opens that folder and serves it back as a personal knowledge base.

## Product Purpose

Markdown notes kept as plain files in a folder the user owns, edited in a rich editor, and searchable by meaning with a model that runs on the phone. Success means: tap, and you are typing; any note is found in seconds, by words or by meaning; notes written by agents read as well as notes typed by hand.

## Positioning

Plain `.md` files in any folder (no lock-in; agents and other apps write to the same folder) plus meaning search that runs entirely on the device.

## Operating Context

- Notes folder: `On My iPhone/VBNotes` by default, or a folder picked in Files (iCloud Drive). Google Drive sync through Google's API is planned; iOS cannot pick Drive folders. Dropbox and OpenCloud are out of scope for now (decided 2026-10-29).
- Agents add and change files while the app is closed; the app scans again when it comes back.
- The share sheet saves text, links, photos and audio into a new note.

## Capabilities and Constraints

- Expo SDK 58, React Native 0.88. Mobile only: no web-only code.
- The editor is Tiptap inside a WebView. The native preview shown while it starts must match the editor's layout exactly.
- Tags live inline in the text (`#tag`, `#a/b`, `#multi word#`) and nest. Pins and tag icons live in `.vbnotes/meta.json`. Archive and Trash are folders.
- Notes hold photos, audio, tables, code and Mermaid diagrams.
- Meaning search models: LFM2.5 350M (default), MiniLM, multilingual MiniLM. Keyword search always works.
- Snappy over clever: anything laggy is removed; a few lines of React Native beat a new package.

## Brand Commitments

- "Ink & Volt": Ink dark and Paper light themes, the system font, a lime Volt accent used sparingly, tags tinted per tag. Its own look, not a Bear clone. Kept on 2026-10-30.
- Ink and Paper with the system font are the defaults. Since 2026-10-30, Settings also offers Bear's theme choices (Solarized, Dracula, Nord, Gruvbox, Catppuccin, Rosé Pine, Tokyo Night, Everforest, Ayu, One Dark/Light, Gotham, Cobalt, Duotone, plus our own Red Graphite, Dark Graphite and High Contrast) and Bear-style typography: text, heading and code fonts from those built into iOS, size, line height and paragraph spacing.

## Evidence on Hand

Real notes in the simulator's notes folder (`Hello.md`, `ai/`, `dev/`, `finance/`, `osho/`). No users, reviews or metrics exist; none may be invented.

## Product Principles

1. The note is the interface. Controls stay out of the way until they are needed.
2. Plain files first. Whatever VBNotes writes stays readable and editable by agents and other apps.
3. Fast beats clever.
4. Volt marks the one thing to do or the one thing selected, never decoration.

## Accessibility & Inclusion

44 pt touch targets. Text size is set in the app; Dynamic Type is not followed yet (open).
