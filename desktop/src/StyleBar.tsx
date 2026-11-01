import React, { useEffect, useReducer, useState } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import { open } from '@tauri-apps/plugin-dialog';
import { create } from 'zustand';
import { attachmentName } from '@/media/attachmentName';
import { hrefForText } from '@/utils/links';
import { api } from './api';
import { Icon, type IconName } from './Icon';

const MAC = /Mac/.test(navigator.platform);
const KEY = 'vbnotes.styleBar';

/** Bear's style bar: shown from the BIU button or ⇧⌘Y, and remembered. ⌘K asks for a link. */
export const useStyleBar = create<{ shown: boolean; linkAsked: number; toggle: () => void; askLink: () => void }>((set, get) => ({
  shown: (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })(),
  linkAsked: 0,
  toggle: () => {
    const shown = !get().shown;
    set({ shown });
    try { localStorage.setItem(KEY, shown ? '1' : '0'); } catch {}
  },
  askLink: () => set((s) => ({ linkAsked: s.linkAsked + 1 })),
}));

/** A shortcut as menus show it: ⇧⌘L on the Mac, Ctrl+Shift+L elsewhere. */
function keyLabel(key: string) {
  const parts = key.split('-');
  const k = parts.pop()!.toUpperCase();
  const has = (m: string) => parts.includes(m);
  if (MAC) return `${has('Ctrl') ? '⌃' : ''}${has('Alt') ? '⌥' : ''}${has('Shift') ? '⇧' : ''}${has('Mod') ? '⌘' : ''}${k}`;
  return [has('Ctrl') || has('Mod') ? 'Ctrl' : '', has('Alt') ? 'Alt' : '', has('Shift') ? 'Shift' : '', k].filter(Boolean).join('+');
}

type Command = { label: string; icon: IconName | string; key?: string; run: (e: Editor) => unknown; on?: (e: Editor) => boolean };

const chain = (e: Editor) => e.chain().focus() as any;

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): Command => ({
  label: `Heading ${level}`, icon: `H${level}`, key: `Mod-${level}`,
  run: (e) => chain(e).toggleHeading({ level }).run(),
  on: (e) => e.isActive('heading', { level }),
});

// Bear's shortcuts. ⌘B, ⌘I, ⌘U and ⇧⌘H are the editor's own.
const C = {
  todo: { label: 'Todo', icon: 'todo', key: 'Mod-t', run: (e) => chain(e).toggleTaskList().run(), on: (e) => e.isActive('taskList') },
  list: { label: 'List', icon: 'list', key: 'Mod-l', run: (e) => chain(e).toggleBulletList().run(), on: (e) => e.isActive('bulletList') },
  ordered: { label: 'Ordered List', icon: 'listOrdered', key: 'Shift-Mod-l', run: (e) => chain(e).toggleOrderedList().run(), on: (e) => e.isActive('orderedList') },
  quote: { label: 'Block Quote', icon: 'quote', key: 'Shift-Mod-t', run: (e) => chain(e).toggleBlockquote().run(), on: (e) => e.isActive('blockquote') },
  rule: { label: 'Separator', icon: 'rule', key: 'Alt-Mod-s', run: (e) => chain(e).setHorizontalRule().run() },
  bold: { label: 'Bold', icon: 'bold', key: 'Mod-b', run: (e) => chain(e).toggleBold().run(), on: (e) => e.isActive('bold') },
  italic: { label: 'Italic', icon: 'italic', key: 'Mod-i', run: (e) => chain(e).toggleItalic().run(), on: (e) => e.isActive('italic') },
  underline: { label: 'Underline', icon: 'underline', key: 'Mod-u', run: (e) => chain(e).toggleUnderline().run(), on: (e) => e.isActive('underline') },
  strike: { label: 'Strikethrough', icon: 'strike', key: 'Shift-Mod-u', run: (e) => chain(e).toggleStrike().run(), on: (e) => e.isActive('strike') },
  highlight: { label: 'Highlight', icon: 'highlight', key: 'Shift-Mod-h', run: (e) => chain(e).toggleHighlight().run(), on: (e) => e.isActive('highlight') },
  code: { label: 'Code', icon: 'code', key: 'Alt-Mod-c', run: (e) => chain(e).toggleCode().run(), on: (e) => e.isActive('code') },
  // ⌃⌘C has no match on Windows and Linux, where Ctrl is ⌘.
  codeBlock: { label: 'Code Block', icon: 'codeBlock', key: MAC ? 'Ctrl-Mod-c' : undefined, run: (e) => chain(e).toggleCodeBlock().run(), on: (e) => e.isActive('codeBlock') },
  table: { label: 'Table', icon: 'table', run: (e) => chain(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
} satisfies Record<string, Command>;

const HEADINGS = ([1, 2, 3, 4, 5, 6] as const).map(heading);

/** The bar's shortcuts in the editor. Alt-Mod-c is the editor's code block key; Bear uses it for code. */
export const StyleKeys = Extension.create({
  name: 'vbStyleKeys',
  priority: 200,
  addKeyboardShortcuts() {
    const keys: Record<string, () => boolean> = { 'Mod-k': () => { useStyleBar.getState().askLink(); return true; } };
    for (const c of [...HEADINGS, C.todo, C.list, C.ordered, C.quote, C.rule, C.strike, C.code, C.codeBlock]) {
      if (c.key) keys[c.key] = () => { c.run(this.editor); return true; };
    }
    return keys;
  },
});

const glyph = (icon: string, size = 18) => (/^H\d$/.test(icon) ? <span className="sb-h">{icon}</span> : <Icon name={icon as IconName} size={size} />);
const tip = (c: Command) => (c.key ? `${c.label} (${keyLabel(c.key)})` : c.label);

/** Pictures (and sounds) picked on disk are copied into the folder's `attachments/`, like the phone's. */
async function addPictures(editor: Editor) {
  const picked = await open({
    multiple: true,
    title: 'Add pictures',
    filters: [{ name: 'Pictures and sound', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'm4a', 'mp3', 'wav', 'aac'] }],
  });
  for (const file of Array.isArray(picked) ? picked : picked ? [picked] : []) {
    const path = attachmentName(file.split('.').pop() ?? 'jpg');
    await api.importFile(file, path);
    chain(editor).setImage({ src: path }).run();
  }
}

type Menu = 'heading' | 'list' | 'more' | 'link' | null;

export function StyleBar({ editor }: { editor: Editor | null }) {
  const { shown, linkAsked, toggle } = useStyleBar();
  const [menu, setMenu] = useState<Menu>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  // Buttons light up for what the caret is in.
  useEffect(() => {
    if (!editor || (!shown && !menu)) return;
    let frame = 0;
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(redraw); };
    editor.on('transaction', later);
    return () => { cancelAnimationFrame(frame); editor.off('transaction', later); };
  }, [editor, shown, menu]);

  useEffect(() => { if (linkAsked) setMenu('link'); }, [linkAsked]);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.('.style-bar')) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(null); editor?.commands.focus(); } };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [menu, editor]);

  if (!editor || (!shown && menu !== 'link')) return null;
  const flip = (m: Menu) => () => setMenu(menu === m ? null : m);
  const act = (c: Command) => () => { setMenu(null); c.run(editor); };
  const button = (c: Command) => (
    <button className={`sb-btn${c.on?.(editor) ? ' on' : ''}`} onClick={act(c)} title={tip(c)} aria-label={c.label} aria-pressed={c.on ? c.on(editor) : undefined}>
      {glyph(c.icon)}
    </button>
  );
  const items = (list: (Command | '-')[]) => list.map((c, i) => (c === '-' ? <div key={i} className="sb-sep" /> : (
    <button key={c.label} className={`sb-item${c.on?.(editor) ? ' on' : ''}`} onClick={act(c)} role="menuitem">
      <span className="sb-item-icon">{glyph(c.icon, 16)}</span>
      <span className="sb-item-label">{c.label}</span>
      {c.key ? <span className="sb-key">{keyLabel(c.key)}</span> : null}
    </button>
  )));
  const hide: Command = { label: 'Hide Style Bar', icon: 'hide', key: 'Shift-Mod-y', run: () => toggle() };
  const level = HEADINGS.find((h) => h.on!(editor));

  return (
    // Clicks on the bar keep the caret (and the selection) in the note.
    <div className="style-bar" role="toolbar" aria-label="Formatting" onMouseDown={(e) => { if (!(e.target as Element).closest('input')) e.preventDefault(); }}>
      <div className="sb-group">
        <span className="sb-anchor">
          <button className={`sb-btn sb-more${level ? ' on' : ''}${menu === 'heading' ? ' open' : ''}`} onClick={flip('heading')} title="Headings" aria-haspopup="menu" aria-expanded={menu === 'heading'}>
            <Icon name="heading" /><Icon name="down" size={12} weight={2.2} />
          </button>
          {menu === 'heading' ? <div className="sb-pop" role="menu">{items(HEADINGS)}</div> : null}
        </span>
        {button(C.todo)}
        <span className="sb-anchor">
          <button className={`sb-btn sb-more${menu === 'list' ? ' open' : ''}`} onClick={flip('list')} title="Lists and blocks" aria-haspopup="menu" aria-expanded={menu === 'list'}>
            <Icon name="list" /><Icon name="down" size={12} weight={2.2} />
          </button>
          {menu === 'list' ? <div className="sb-pop" role="menu">{items([C.list, C.ordered, C.quote, C.todo, '-', C.rule])}</div> : null}
        </span>
      </div>
      <div className="sb-group">
        {button(C.bold)}
        {button(C.italic)}
        {button(C.highlight)}
      </div>
      <div className="sb-group">
        <span className="sb-anchor">
          <button className={`sb-btn${editor.isActive('link') ? ' on' : ''}${menu === 'link' ? ' open' : ''}`} onClick={flip('link')} title={`Link (${keyLabel('Mod-k')})`} aria-label="Link">
            <Icon name="link" />
          </button>
          {menu === 'link' ? <LinkBox editor={editor} done={() => setMenu(null)} /> : null}
        </span>
        {button(C.table)}
        <button className="sb-btn" onClick={() => { setMenu(null); void addPictures(editor).catch((e) => console.warn('adding a picture failed', e)); }} title="Add pictures" aria-label="Add pictures">
          <Icon name="image" />
        </button>
        <span className="sb-anchor">
          <button className={`sb-btn${menu === 'more' ? ' open' : ''}`} onClick={flip('more')} title="More" aria-label="More" aria-haspopup="menu" aria-expanded={menu === 'more'}>
            <Icon name="more" weight={2.6} />
          </button>
          {menu === 'more' ? <div className="sb-pop right" role="menu">{items([C.underline, C.strike, C.code, C.codeBlock, '-', hide])}</div> : null}
        </span>
      </div>
    </div>
  );
}

/** The link popover: an address for the selected text, or for a new link at the caret. Empty removes a link. */
function LinkBox({ editor, done }: { editor: Editor; done: () => void }) {
  const current = String(editor.getAttributes('link').href ?? '');
  const [text, setText] = useState(current);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = text.trim();
    const c = chain(editor);
    if (!typed) { if (current) c.extendMarkRange('link').unsetLink().run(); done(); return; }
    const href = hrefForText(typed);
    if (current) c.extendMarkRange('link').setLink({ href }).run();
    else if (editor.state.selection.empty) c.insertContent({ type: 'text', text: typed, marks: [{ type: 'link', attrs: { href } }] }).run();
    else c.setLink({ href }).run();
    done();
  };
  return (
    <form className="sb-pop sb-link" onSubmit={submit}>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste or type a link" spellCheck={false} aria-label="Link address" />
      <button type="submit">{current && !text.trim() ? 'Remove' : current ? 'Update' : 'Add'}</button>
    </form>
  );
}
