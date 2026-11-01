import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { sendMessage } from '@10play/tentap-editor';
import { WikiAction, wikiReplies, type WikiNote } from '../src/editor/wikiBridge';

let asked = 0;

/** Where linked notes come from: the app, through messages. The desktop app sets both directly. */
export const wikiSource = {
  find: (query: string): Promise<WikiNote[]> => new Promise((resolve) => {
    const id = ++asked;
    wikiReplies.set(id, resolve);
    sendMessage({ type: WikiAction.Find, payload: { id, query } } as never);
    // An app that never answers leaves no list behind.
    setTimeout(() => { if (wikiReplies.delete(id)) resolve([]); }, 3000);
  }),
  open: (title: string) => { sendMessage({ type: WikiAction.Open, payload: { title } } as never); },
};

const LINK = /\[\[([^[\]\n]+)\]\]/g;
// `[[` and what follows it up to the caret, with no `]` yet: a link being typed.
const TYPING = /\[\[([^[\]\n]{0,80})$/;
const LEAF = '￼';

const textOf = (node: PMNode) => node.textBetween(0, node.content.size, undefined, LEAF);

/** The title of the `[[link]]` the caret is in, for the "Open" button (`links.ts`). */
export function wikiAtCaret(state: EditorState): string | null {
  const { empty, $from } = state.selection;
  if (!empty || $from.parent.type.spec.code) return null;
  const at = $from.parentOffset;
  for (const m of textOf($from.parent).matchAll(LINK)) {
    if (at >= m.index + 2 && at <= m.index + m[0].length - 2) return m[1].trim() || null;
  }
  return null;
}

/** Paints `[[links]]` like links. Only decorations: the file keeps plain `[[Title]]`, as Obsidian and Bear write it. */
function scan(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  const code = doc.type.schema.marks.code;
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    const text = textOf(node);
    if (!text.includes('[[')) return false;
    for (const m of text.matchAll(LINK)) {
      const from = pos + 1 + m.index;
      const to = from + m[0].length;
      const title = m[1].trim();
      if (!title || (code && doc.rangeHasMark(from, to, code))) continue;
      decos.push(
        Decoration.inline(from, from + 2, { class: 'vb-wiki-br' }),
        Decoration.inline(from + 2, to - 2, { class: 'vb-wiki', 'data-wiki': title }),
        Decoration.inline(to - 2, to, { class: 'vb-wiki-br' }),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

type Ask = { from: number; query: string };
type AskState = { ask: Ask | null; dismissed: number | null };

const askKey = new PluginKey<AskState>('vbWikiAsk');

function askAt(state: EditorState): Ask | null {
  const { empty, $from } = state.selection;
  if (!empty || $from.parent.type.spec.code || (state.schema.marks.code && state.schema.marks.code.isInSet($from.marks()))) return null;
  const m = TYPING.exec($from.parent.textBetween(Math.max(0, $from.parentOffset - 84), $from.parentOffset, undefined, LEAF));
  return m ? { from: $from.pos - m[0].length, query: m[1] } : null;
}

/** The list under a `[[` being typed: notes whose title holds what follows it. */
class Suggestions {
  private el: HTMLDivElement;
  private notes: WikiNote[] = [];
  private index = 0;
  private query: string | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private touch: { y: number; moved: boolean } | null = null;
  private onFocusChange: () => void;

  constructor(private view: EditorView) {
    const el = (this.el = document.createElement('div'));
    el.className = 'vb-wiki-menu';
    el.setAttribute('role', 'listbox');
    el.hidden = true;
    // The list must never take the caret (or the keyboard) away from the text.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => this.pick(this.rowOf(e)));
    el.addEventListener('mousemove', (e) => { const i = this.rowOf(e); if (i >= 0 && i !== this.index) { this.index = i; this.mark(); } });
    el.addEventListener('touchstart', (e) => { this.touch = { y: e.touches[0]?.clientY ?? 0, moved: false }; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (this.touch && Math.abs((e.touches[0]?.clientY ?? 0) - this.touch.y) > 8) this.touch.moved = true; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const t = this.touch;
      this.touch = null;
      if (!t || t.moved) return;
      e.preventDefault();
      this.pick(this.rowOf(e));
    });
    this.onFocusChange = () => requestAnimationFrame(() => this.update(this.view));
    view.dom.addEventListener('focus', this.onFocusChange);
    view.dom.addEventListener('blur', this.onFocusChange);
  }

  get open() { return !this.el.hidden; }

  private rowOf(e: Event) {
    const row = (e.target as Element | null)?.closest?.('[data-i]');
    return row ? Number(row.getAttribute('data-i')) : -1;
  }

  update(view: EditorView) {
    this.view = view;
    const ask = askKey.getState(view.state)?.ask;
    if (!ask || !view.hasFocus()) {
      this.query = null;
      this.notes = [];
      this.seq++;
      this.el.hidden = true;
      return;
    }
    if (ask.query !== this.query) {
      this.query = ask.query;
      // Until the app answers, the list already shown narrows to what still matches.
      const q = ask.query.trim().toLowerCase();
      const kept = this.notes.filter((n) => n.title.toLowerCase().includes(q));
      if (kept.length !== this.notes.length) { this.notes = kept; this.index = 0; this.render(q); }
      const seq = ++this.seq;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void wikiSource.find(ask.query.trim()).then((notes) => {
          if (seq !== this.seq) return;
          this.notes = notes;
          this.index = 0;
          this.render(ask.query.trim());
          this.place();
        });
      }, 60);
    }
    this.place();
  }

  private render(query: string) {
    const q = query.toLowerCase();
    this.el.replaceChildren(...this.notes.map((n, i) => {
      const row = document.createElement('div');
      row.className = 'vb-wiki-row';
      row.setAttribute('role', 'option');
      row.dataset.i = String(i);
      // The typed part of the title in bold.
      const at = q ? n.title.toLowerCase().indexOf(q) : -1;
      if (at < 0) row.textContent = n.title;
      else {
        const b = document.createElement('b');
        b.textContent = n.title.slice(at, at + q.length);
        row.append(n.title.slice(0, at), b, n.title.slice(at + q.length));
      }
      return row;
    }));
    this.mark();
  }

  private mark() {
    this.el.querySelectorAll('[data-i]').forEach((row, i) => {
      row.classList.toggle('on', i === this.index);
      row.setAttribute('aria-selected', String(i === this.index));
      if (i === this.index) (row as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    });
  }

  private place() {
    const ask = askKey.getState(this.view.state)?.ask;
    const host = this.view.dom.parentElement;
    if (!ask || !host || !this.notes.length || this.query === null) { this.el.hidden = true; return; }
    // The editor is moved into its page container after the view is made, so attach late.
    if (this.el.parentElement !== host) host.appendChild(this.el);
    this.el.hidden = false;
    const box = host.getBoundingClientRect();
    const start = this.view.coordsAtPos(ask.from);
    const caret = this.view.coordsAtPos(this.view.state.selection.head);
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    // Below the line, or above it when the line is near the bottom of the visible page.
    let top = caret.bottom + 6;
    if (top + h > window.innerHeight - 8 && caret.top - h - 6 > 8) top = caret.top - h - 6;
    const left = Math.max(8, Math.min(start.left - box.left - 8, box.width - w - 8));
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top - box.top + host.scrollTop)}px)`;
  }

  move(by: number) {
    this.index = (this.index + by + this.notes.length) % this.notes.length;
    this.mark();
  }

  /** Writes `[[Title]]` over what was typed, and the closing `]]` if it was typed already; the caret goes after it. */
  pick(i = this.index) {
    const note = this.notes[i];
    const { state } = this.view;
    const ask = askKey.getState(state)?.ask;
    if (!note || !ask) return;
    const { $from, from } = state.selection;
    const next = $from.parent.textBetween($from.parentOffset, Math.min($from.parent.content.size, $from.parentOffset + 2), undefined, LEAF);
    const link = `[[${note.title}]]`;
    const tr = state.tr.insertText(link, ask.from, next === ']]' ? from + 2 : from);
    tr.setSelection(TextSelection.create(tr.doc, ask.from + link.length)).setMeta(askKey, { close: true });
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  close() {
    this.view.dispatch(this.view.state.tr.setMeta(askKey, { close: true }));
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.view.dom.removeEventListener('focus', this.onFocusChange);
    this.view.dom.removeEventListener('blur', this.onFocusChange);
    this.el.remove();
  }
}

const linkKey = new PluginKey<DecorationSet>('vbWikiLinks');

/**
 * `[[Note title]]` links between notes. Typing `[[` lists notes by title (↑ ↓ and Return, or a tap);
 * picking one writes its title and the closing `]]`. A link opens with ⌘-click on the desktop, a tap
 * on the phone, or the "Open" button while the caret is in it.
 */
export const WikiLinks = Extension.create({
  name: 'vbWikiLinks',
  // Before the list and Enter keymaps, so Return picks a note while the list is open.
  priority: 1000,
  addProseMirrorPlugins() {
    let menu: Suggestions | null = null;
    return [
      new Plugin<DecorationSet>({
        key: linkKey,
        state: {
          init: (_, { doc }) => scan(doc),
          apply: (tr, old) => (tr.docChanged ? scan(tr.doc) : old),
        },
        props: { decorations: (state) => linkKey.getState(state) },
      }),
      new Plugin<AskState>({
        key: askKey,
        state: {
          init: () => ({ ask: null, dismissed: null }),
          apply: (tr, prev, _old, state) => {
            const ask = askAt(state);
            if (!ask) return { ask: null, dismissed: null };
            if ((tr.getMeta(askKey) as { close?: boolean } | undefined)?.close) return { ask: null, dismissed: ask.from };
            const dismissed = prev.dismissed === null ? null : tr.mapping.map(prev.dismissed);
            if (dismissed === ask.from) return { ask: null, dismissed };
            // Opens as `[[` is typed; stays open while the caret stays in what follows it.
            const was = !!prev.ask && tr.mapping.map(prev.ask.from) === ask.from;
            return { ask: was || tr.docChanged ? ask : null, dismissed: null };
          },
        },
        view: (view) => (menu = new Suggestions(view)),
        props: {
          decorations: (state) => {
            const ask = askKey.getState(state)?.ask;
            return ask ? DecorationSet.create(state.doc, [Decoration.inline(ask.from, state.selection.head, { class: 'vb-wiki-typing' })]) : null;
          },
          handleKeyDown: (_view, e) => {
            if (!menu?.open) return false;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') menu.move(e.key === 'ArrowDown' ? 1 : -1);
            else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.isComposing) menu.pick();
            else if (e.key === 'Escape') menu.close();
            else return false;
            e.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
