import React, { useEffect, useRef, useState } from 'react';
import { EditorContent, PlaceholderBridge, TenTapStartKit, useEditor } from '@10play/tentap-editor';
import { Extension, type AnyExtension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MarkdownBridge } from '@/editor/markdownBridge';
import { openableUrl } from '@/utils/links';
import { PlainTable } from '../../editor-web/Editor';
import { TagPills } from '../../editor-web/tagPills';
import { RichCodeBlock } from '../../editor-web/codeBlocks';
import { MediaViews } from '../../editor-web/media';
import { LinkTaps, withPlainLinks } from '../../editor-web/links';
import { CodePaste } from '../../editor-web/codePaste';
import { MergeFormats } from '../../editor-web/mergeFormats';
import { onContentsChanged, useNotes } from './store';

/** ⌘-click (Ctrl-click) on a link opens it in the browser; a plain click puts the caret in it to edit. */
const LinkClicks = Extension.create({
  name: 'vbLinkClicks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('vbLinkClicks'),
        props: {
          handleClick: (_view, _pos, e) => {
            if (!(e.metaKey || e.ctrlKey)) return false;
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
  [TagPills, LinkTaps, LinkClicks, CodePaste, MergeFormats, MediaViews, RichCodeBlock, HorizontalRule, PlainTable, TableRow, TableHeader, TableCell].forEach(add);
  return out;
})();

/** Saves the open note at once; toolbar actions call it before moving the note. */
export const openEditor = { flush: async () => {} };

export function NoteEditor({ path }: { path: string }) {
  const readText = useNotes((s) => s.readText);
  const [text, setText] = useState<{ path: string; md: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    readText(path).then((md) => { if (live) setText({ path, md }); }, (e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [path, readText]);
  if (error) return <div className="editor-empty">{error}</div>;
  if (!text || text.path !== path) return <div className="editor-scroll" />;
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
    content: initial,
    contentType: 'markdown',
    // A new note starts in its title line, above a tag it may come with.
    autofocus: fresh ? 'start' : false,
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

  return (
    <div className="editor-scroll">
      <EditorContent editor={editor} className="editor" />
    </div>
  );
}
