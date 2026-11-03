import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

type State = { on: boolean; set: DecorationSet };
const key = new PluginKey<State>('vbLineNumbers');

/**
 * The setting comes in the editor's stylesheet (`--vb-lines: 1`, from `editorCss`): the phone
 * swaps that sheet with `injectCSS`, the desktop rewrites it in place.
 */
const wanted = () => getComputedStyle(document.documentElement).getPropertyValue('--vb-lines').trim() === '1';

/**
 * One number per line, the way the note reads, after the title: each paragraph, heading, list item, picture or rule,
 * one per row of a table, one per line of a code block. They are attributes on the blocks
 * (`data-ln`, `data-lns` on a code block), drawn by `editorCss`, so the text never holds them.
 */
function numbers(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  let n = 0;
  const mark = (pos: number, node: PMNode) => out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-ln': String(++n) }));
  doc.descendants((node, pos) => {
    // A title (a heading on the first line) is not counted: numbering starts under it.
    if (pos === 0 && node.type.name === 'heading') return false;
    if (node.type.name === 'table') {
      // The row's number goes on its first cell's first paragraph.
      node.forEach((row, rowOffset) => {
        const rowPos = pos + 1 + rowOffset;
        let done = false;
        row.descendants((child, childPos) => {
          if (done) return false;
          if (!child.isTextblock) return true;
          mark(rowPos + 1 + childPos, child);
          done = true;
          return false;
        });
      });
      return false;
    }
    if (node.type.name === 'codeBlock') {
      const lines = node.textContent.split('\n').length;
      const list = Array.from({ length: lines }, (_, i) => n + 1 + i).join('\n');
      n += lines;
      out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-lns': list }));
      return false;
    }
    if (node.isTextblock || node.isAtom) {
      mark(pos, node);
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, out);
}

const off: State = { on: false, set: DecorationSet.empty };

/** Line numbers in the margin, as in a code editor, while Settings › Typography › Line numbers is on. */
export const LineNumbers = Extension.create({
  name: 'vbLineNumbers',
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key,
        state: {
          init: (_, { doc }) => (wanted() ? { on: true, set: numbers(doc) } : off),
          apply: (tr, old) => {
            const on = tr.getMeta(key) as boolean | undefined;
            if (on !== undefined) return on ? { on, set: numbers(tr.doc) } : off;
            return old.on && tr.docChanged ? { on: true, set: numbers(tr.doc) } : old;
          },
        },
        props: { decorations: (state) => key.getState(state)?.set },
        view: (view) => {
          const sync = () => {
            const on = wanted();
            if (on !== key.getState(view.state)?.on) view.dispatch(view.state.tr.setMeta(key, on).setMeta('addToHistory', false));
          };
          // Both ways of changing the sheet rewrite a <style> in <head>.
          const watch = new MutationObserver(sync);
          watch.observe(document.head, { childList: true, subtree: true, characterData: true });
          return { destroy: () => watch.disconnect() };
        },
      }),
    ];
  },
});
