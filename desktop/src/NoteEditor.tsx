import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, PlaceholderBridge, TenTapStartKit, useEditor } from '@10play/tentap-editor';
import { Extension, type AnyExtension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MarkdownBridge } from '@/editor/markdownBridge';
import { openableUrl } from '@/utils/links';
import { splitTitle } from '@/utils/markdown';
import { PlainTable } from '../../editor-web/plainTable';
import { TagPills } from '../../editor-web/tagPills';
import { RichCodeBlock, mermaidFrom, type Mermaid } from '../../editor-web/codeBlocks';
import { MediaViews } from '../../editor-web/media';
import { LinkTaps, withPlainLinks } from '../../editor-web/links';
import { CodePaste } from '../../editor-web/codePaste';
import { MergeFormats } from '../../editor-web/mergeFormats';
import { WikiLinks, wikiSource } from '../../editor-web/wikiLinks';
import { LineNumbers } from '../../editor-web/lineNumbers';
import { HeadingMarks } from '../../editor-web/headingMarks';
import { ListTyping } from '../../editor-web/listTyping';
import { MarkdownClipboard } from '../../editor-web/markdownClipboard';
import { addFiles, useFileDrop } from './fileDrop';
import { MEDIA, PastedMedia, dropMedia } from './noteMedia';
import { onContentsChanged, useNotes } from './store';
import { StyleBar, StyleKeys } from './StyleBar';

// Diagrams use the app's own Mermaid, loaded the first time a note has one: it works offline and
// where jsDelivr is blocked.
mermaidFrom(() => import('mermaid').then((m) => m.default as unknown as Mermaid));

/** ⌘-click (Ctrl-click) on a link opens it in the browser, on a `[[link]]` its note; a plain click puts the caret in it to edit. */
const LinkClicks = Extension.create({
  name: 'vbLinkClicks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('vbLinkClicks'),
        props: {
          handleClick: (_view, _pos, e) => {
            if (!(e.metaKey || e.ctrlKey)) return false;
            const wiki = (e.target as Element | null)?.closest?.('[data-wiki]');
            if (wiki) { wikiSource.open(wiki.getAttribute('data-wiki') ?? ''); return true; }
            const a = (e.target as Element | null)?.closest?.('a[href]');
            const url = a ? openableUrl(a.getAttribute('href')) : null;
            if (!url) return false;
            void openUrl(url);
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Return pressed just after macOS ends a composition (its inline word predictions are one) is a
 * keydown ProseMirror leaves to the browser, so Japanese input can confirm a word with it. WebKit's
 * own Return then put a newline that does not show at the end of a code block, and a second one
 * made a paragraph after it. When the browser is about to break the line itself, Return goes to
 * the editor's keymap instead.
 */
const BrowserReturn = Extension.create({
  name: 'vbBrowserReturn',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('vbBrowserReturn'),
        props: {
          handleDOMEvents: {
            beforeinput: (view, e) => {
              const type = (e as InputEvent).inputType;
              if (type !== 'insertParagraph' && type !== 'insertLineBreak') return false;
              e.preventDefault();
              // Take in text the composition left in the page before acting on it.
              (view as unknown as { domObserver?: { forceFlush?: () => void } }).domObserver?.forceFlush?.();
              const enter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: type === 'insertLineBreak' });
              view.someProp('handleKeyDown', (f) => f(view, enter));
              return true;
            },
          },
        },
      }),
    ];
  },
});

/**
 * The phone's editor, extension for extension, so a note reads and saves the same on both:
 * tentap's starter kit (as its web side builds it) plus the extensions in `editor-web/`.
 * Touch-only ones (word taps, the markdown push to the native app) are left out.
 */
const EXTENSIONS: AnyExtension[] = (() => {
  const bridges = [
    ...withPlainLinks(TenTapStartKit.map((b) => (b.name === 'placeholder' ? PlaceholderBridge.configureExtension({ placeholder: 'Start writing…' }) : b))),
    MarkdownBridge,
  ];
  const out: AnyExtension[] = [];
  const names = new Set<string>();
  const add = (e: AnyExtension | undefined) => { if (e && !names.has(e.name)) { names.add(e.name); out.push(e); } };
  for (const b of bridges) {
    const { config, extendConfig } = b as unknown as { config?: unknown; extendConfig?: unknown };
    b.configureTiptapExtensionsOnRunTime(config, extendConfig).forEach(add);
  }
  [TagPills, WikiLinks, LinkTaps, LinkClicks, BrowserReturn, StyleKeys, PastedMedia, CodePaste, MergeFormats, MediaViews, RichCodeBlock, HorizontalRule, PlainTable, TableRow, TableHeader, TableCell, LineNumbers, HeadingMarks, ListTyping, MarkdownClipboard].forEach(add);
  return out;
})();

/** Saves the open note at once; toolbar actions call it before moving the note. */
export const openEditor = { flush: async () => {} };

export function NoteEditor({ path }: { path: string }) {
  const readText = useNotes((s) => s.readText);
  const [text, setText] = useState<{ path: string; md: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A note iCloud keeps only in the cloud takes a moment to come down; past a moment, say so.
  const [slow, setSlow] = useState(false);
  const inICloud = useNotes((s) => !!s.folder?.includes('/Mobile Documents/'));
  useEffect(() => {
    let live = true;
    setError(null);
    setSlow(false);
    const wait = setTimeout(() => { if (live) setSlow(true); }, 400);
    readText(path).then((md) => { if (live) setText({ path, md }); }, (e) => { if (live) setError(String(e)); });
    return () => { live = false; clearTimeout(wait); };
  }, [path, readText]);
  if (error) return <div className="editor-empty">{error}</div>;
  if (!text || text.path !== path) {
    return slow ? <div className="editor-empty">{inICloud ? 'Downloading this note from iCloud…' : 'Opening…'}</div> : <div className="editor-scroll" />;
  }
  return <Pane key={path} path={path} initial={text.md} />;
}

function Pane({ path, initial }: { path: string; initial: string }) {
  const fresh = useNotes((s) => s.fresh === path);
  const editorRef = useRef<Editor | null>(null);
  const state = useRef({ dirty: false, timer: null as ReturnType<typeof setTimeout> | null });

  const flush = async () => {
    const s = state.current;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    const editor = editorRef.current;
    if (!editor || !s.dirty) return;
    s.dirty = false;
    await useNotes.getState().saveNote(path, editor.getMarkdown());
  };

  // Declared before `useEditor`, so on leaving the note it runs while the editor still exists:
  // the last words are saved and the file is named after the title.
  useEffect(() => {
    openEditor.flush = flush;
    return () => {
      openEditor.flush = async () => {};
      void flush().then(() => useNotes.getState().syncTitle(path));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per note (this component is keyed by path).
  }, []);

  const editor = useEditor({
    extensions: EXTENSIONS,
    // A new, empty note starts in its title line, as on the phone; Backspace there makes it plain text.
    ...(fresh && !initial.trim()
      ? { content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] } }
      : { content: initial, contentType: 'markdown' }),
    // A new note starts in its title line, above a tag it may come with; one made with its title
    // (⌘O) starts on the empty line under it.
    autofocus: fresh ? (splitTitle(initial).title ? 'end' : 'start') : false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { spellcheck: 'true' } },
    onUpdate: () => {
      const s = state.current;
      s.dirty = true;
      if (s.timer) clearTimeout(s.timer);
      // Written 1 s after typing stops, like the phone.
      s.timer = setTimeout(() => void flush(), 1000);
    },
  } as Parameters<typeof useEditor>[0]);
  editorRef.current = editor;

  // The file changed elsewhere (the phone, through iCloud): show the new text unless there are unsaved edits here.
  useEffect(() => onContentsChanged((changed) => {
    if (!editor || !changed.includes(path) || state.current.dirty) return;
    void useNotes.getState().readText(path).then((md) => {
      if (md !== editor.getMarkdown()) editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false } as never);
    });
  }), [editor, path]);

  // Pictures and sounds dropped on the note go in where they land; other files come in as notes, as on the list.
  const scrollRef = useRef<HTMLDivElement>(null);
  const onDrop = useCallback(async (paths: string[], at: { x: number; y: number }) => {
    const media = paths.filter((p) => MEDIA.test(p));
    if (editor && media.length) await dropMedia(editor, media, editor.view.posAtCoords({ left: at.x, top: at.y })?.pos ?? editor.state.selection.to);
    const rest = paths.filter((p) => !MEDIA.test(p));
    if (rest.length) await addFiles(rest);
  }, [editor]);
  const dropping = useFileDrop(scrollRef, onDrop);

  return (
    <>
      <div className={`editor-scroll${dropping ? ' dropping' : ''}`} ref={scrollRef}>
        <EditorContent editor={editor} className="editor" />
      </div>
      <StyleBar editor={editor} />
    </>
  );
}
