import { Extension, type AnyExtension, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { FOLD_COMMENT, FOLD_MARK } from '../src/editor/noteSyntax';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    folding: {
      /** ⌘': the heading the caret is in, or the section it is under. `pos` names a heading. */
      toggleFold: (pos?: number) => ReturnType;
      /** Fold or unfold every heading. */
      foldAll: () => ReturnType;
      unfoldAll: () => ReturnType;
    };
  }
}

type Token = { type: string; raw?: string; text?: string };

/**
 * Headings that remember being folded, kept in the file: `## Plans<!-- {"fold":"true"} -->`
 * in the file (an HTML comment other apps hide), the `folded` attribute in the editor.
 */
export function foldingHeading(extension: AnyExtension) {
  return extension.extend({
    addAttributes(this: { parent?: () => Record<string, unknown> }) {
      return {
        ...this.parent?.(),
        folded: {
          default: false,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-folded') === 'true',
          renderHTML: (attrs: { folded?: boolean }) => (attrs.folded ? { 'data-folded': 'true' } : {}),
          keepOnSplit: false,
        },
      };
    },
    parseMarkdown: (token: any, h: any) => {
      const tokens = [...((token.tokens ?? []) as Token[])];
      const last = tokens[tokens.length - 1];
      const folded = last?.type === 'html' && FOLD_COMMENT.test((last.raw ?? '').trim());
      if (folded) {
        tokens.pop();
        const prev = tokens[tokens.length - 1];
        if (prev?.type === 'text') tokens[tokens.length - 1] = { ...prev, raw: prev.raw?.trimEnd(), text: prev.text?.trimEnd() };
      }
      return h.createNode('heading', { level: token.depth || 1, ...(folded ? { folded: true } : {}) }, h.parseInline(tokens));
    },
    renderMarkdown(this: { parent?: (...a: unknown[]) => string }, node: any, h: any, ctx: unknown) {
      const md = this.parent?.(node, h, ctx) ?? '';
      return md && node.attrs?.folded ? `${md}${FOLD_MARK}` : md;
    },
  } as never);
}

type Section = { pos: number; node: PMNode; index: number; from: number; end: number; title: boolean };

/**
 * Each heading at the top level with what it folds: the blocks after it, up to the next heading
 * of its level or above. The note's title (a `#` heading on the first line) folds only if the
 * file says it is folded, as it would hide the whole note.
 */
function sections(doc: PMNode): Section[] {
  const heads: Section[] = [];
  doc.forEach((node, offset, index) => {
    if (node.type.name === 'heading') {
      heads.push({ pos: offset, node, index, from: offset + node.nodeSize, end: doc.content.size, title: index === 0 && node.attrs.level === 1 });
    }
  });
  heads.forEach((s, i) => {
    const next = heads.slice(i + 1).find((o) => o.node.attrs.level <= s.node.attrs.level);
    if (next) s.end = next.pos;
  });
  return heads;
}

const foldable = (s: Section) => s.from < s.end && (!s.title || !!s.node.attrs.folded);
const hides = (s: Section, at: number) => !!s.node.attrs.folded && s.from < at && at < s.end;

/** The heading the caret is in, or the nearest one it is under. */
function sectionAt(state: EditorState, list: Section[]) {
  const at = state.selection.from;
  const inHeading = list.find((s) => s.pos < at && at < s.from);
  if (inHeading) return inHeading;
  const under = list.filter((s) => s.from < at && at < s.end && !s.title);
  return under[under.length - 1] ?? null;
}

/** Moves the caret out of folded text: to the end of the outermost folded heading over it. */
function surface(tr: Transaction) {
  const at = tr.selection.from;
  const over = sections(tr.doc).find((s) => hides(s, at) || hides(s, tr.selection.to));
  if (over) tr.setSelection(TextSelection.create(tr.doc, over.from - 1));
}

const fold = (on: boolean) => () => ({ state, tr, dispatch }: CommandProps) => {
  const list = sections(state.doc).filter((s) => !!s.node.attrs.folded !== on && (on ? foldable(s) && !s.title : true));
  if (!list.length) return false;
  if (dispatch) {
    list.forEach((s) => tr.setNodeAttribute(s.pos, 'folded', on));
    if (on) surface(tr);
    tr.setMeta('addToHistory', false);
  }
  return true;
};

/** Whether the transaction swaps the whole note (`setContent`): a new text, not the caret moving. */
const replacesAll = (tr: Transaction) =>
  tr.steps.some((step, i) => step instanceof ReplaceStep && (step as unknown as { from: number }).from === 0 && (step as unknown as { to: number }).to === tr.docs[i].content.size);

const SVG = 'http://www.w3.org/2000/svg';

/** A tap or click on the fold controls: they act at once and keep the caret and keyboard where they were. */
function control(el: HTMLElement, view: EditorView, getPos: () => number | undefined) {
  const act = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos === undefined) return;
    const heading = view.state.doc.resolve(pos).before(1);
    view.dispatch(foldTr(view.state, heading));
  };
  el.addEventListener('mousedown', act);
  el.addEventListener('touchend', act);
  el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  return el;
}

function foldTr(state: EditorState, pos: number) {
  const tr = state.tr;
  const s = sections(state.doc).find((x) => x.pos === pos);
  if (!s) return tr;
  tr.setNodeAttribute(pos, 'folded', !s.node.attrs.folded).setMeta('addToHistory', false);
  if (!s.node.attrs.folded) surface(tr);
  return tr;
}

function chevron(view: EditorView, getPos: () => number | undefined) {
  const el = document.createElement('span');
  el.className = 'vb-fold';
  el.contentEditable = 'false';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Fold or unfold this heading');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M9 6l6 6-6 6');
  svg.appendChild(path);
  el.appendChild(svg);
  return control(el, view, getPos);
}

function pill(view: EditorView, getPos: () => number | undefined) {
  const el = document.createElement('span');
  el.className = 'vb-fold-pill';
  el.contentEditable = 'false';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Unfold');
  el.textContent = '…';
  return control(el, view, getPos);
}

function decorations(state: EditorState) {
  const out: Decoration[] = [];
  const hidden = new Set<number>();
  const here = state.selection.from;
  for (const s of sections(state.doc)) {
    if (!foldable(s)) continue;
    const folded = !!s.node.attrs.folded;
    const classes = ['vb-foldable', folded ? 'vb-folded' : '', s.pos < here && here < s.from ? 'vb-fold-here' : ''].filter(Boolean).join(' ');
    out.push(Decoration.node(s.pos, s.from, { class: classes }));
    out.push(Decoration.widget(s.pos + 1, chevron, { side: -10, key: 'fold', ignoreSelection: true, stopEvent: () => true }));
    if (!folded) continue;
    out.push(Decoration.widget(s.from - 1, pill, { side: 10, key: 'fold-pill', ignoreSelection: true, stopEvent: () => true }));
    state.doc.nodesBetween(s.from, s.end, (node, pos) => {
      if (!hidden.has(pos)) {
        hidden.add(pos);
        out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'vb-hidden' }));
      }
      return false;
    });
  }
  return DecorationSet.create(state.doc, out);
}

const key = new PluginKey<DecorationSet>('vbFolding');

/**
 * Folding headings: a
 * folded heading hides everything up to the next heading of its level or above and shows "…"
 * after its text. The chevron left of a heading shows while the pointer is over it or the caret
 * is in it, and always on a folded one. ⌘' folds the heading at the caret. The caret never stays in
 * hidden text: moving it there (or an edit that lands there) unfolds that heading.
 */
export const Folding = Extension.create({
  name: 'vbFolding',
  addCommands() {
    return {
      toggleFold: (pos?: number) => ({ state, tr, dispatch }: CommandProps) => {
        const list = sections(state.doc);
        const s = pos === undefined ? sectionAt(state, list) : list.find((x) => x.pos === pos);
        if (!s || !foldable(s)) return false;
        if (dispatch) {
          tr.setNodeAttribute(s.pos, 'folded', !s.node.attrs.folded).setMeta('addToHistory', false);
          if (!s.node.attrs.folded) surface(tr);
        }
        return true;
      },
      foldAll: fold(true),
      unfoldAll: fold(false),
    } as never;
  },
  addKeyboardShortcuts() {
    return { "Mod-'": () => this.editor.commands.toggleFold() };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorations(state),
          apply: (tr, old, _prev, state) => (tr.docChanged || tr.selectionSet ? decorations(state) : old),
        },
        props: { decorations: (state) => key.getState(state) },
        // The caret (or an edit) inside folded text unfolds the heading over it. A note loaded
        // in place of another leaves the caret wherever it maps to; that only moves it out.
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged || t.selectionSet)) return null;
          const { from, to } = state.selection;
          const open = sections(state.doc).filter((s) => hides(s, from) || hides(s, to));
          if (!open.length) return null;
          const tr = state.tr;
          if (trs.some(replacesAll)) surface(tr);
          else open.forEach((s) => tr.setNodeAttribute(s.pos, 'folded', false));
          return tr.setMeta('addToHistory', false);
        },
      }),
    ];
  },
});
