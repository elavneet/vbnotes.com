import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { findTags, tagHue } from '../src/utils/tags';

/** A tag followed by a stray `/` or `-` (`#work/`), in document positions. */
type Tail = { from: number; end: number; rawEnd: number; hue: string };
type PillState = { pills: DecorationSet; tails: Tail[] };

const key = new PluginKey<PillState>('vbTagPills');

const pill = (from: number, to: number, hue: string) => [
  Decoration.inline(from, from + 1, { class: 'vb-tag vb-tag-hash', 'data-hue': hue }),
  Decoration.inline(from + 1, to, { class: 'vb-tag vb-tag-name', 'data-hue': hue }),
];

/** Paints `#tags` as pills tinted per tag. Only decorations: the text stays plain `#tag` in the file. */
function scan(doc: PMNode): PillState {
  const decos: Decoration[] = [];
  const tails: Tail[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false; // code blocks
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, '￼');
    if (text.indexOf('#') === -1) return false;
    const base = pos + 1;
    for (const t of findTags(text)) {
      const from = base + t.start;
      if (doc.rangeHasMark(from, base + t.rawEnd, doc.type.schema.marks.code)) continue;
      const hue = String(tagHue(t.tag));
      if (t.rawEnd > t.end) tails.push({ from, end: base + t.end, rawEnd: base + t.rawEnd, hue });
      else decos.push(...pill(from, base + t.end, hue));
    }
    return false;
  });
  return { pills: DecorationSet.create(doc, decos), tails };
}

/**
 * `#work/` is a nested tag still being typed: while the caret is on it the pill takes in the `/`;
 * once the caret moves on, the stray `/` is hidden and the pill reads `#work`.
 */
function decorations(state: EditorState) {
  const { pills, tails } = key.getState(state)!;
  if (!tails.length) return pills;
  const { from, to } = state.selection;
  const extra: Decoration[] = [];
  for (const t of tails) {
    if (from >= t.from && to <= t.rawEnd) extra.push(...pill(t.from, t.rawEnd, t.hue));
    else extra.push(...pill(t.from, t.end, t.hue), Decoration.inline(t.end, t.rawEnd, { class: 'vb-tag-tail' }));
  }
  return pills.add(state.doc, extra);
}

export const TagPills = Extension.create({
  name: 'vbTagPills',
  addProseMirrorPlugins() {
    return [
      new Plugin<PillState>({
        key,
        state: {
          init: (_, { doc }) => scan(doc),
          apply: (tr, old) => (tr.docChanged ? scan(tr.doc) : old),
        },
        props: { decorations },
      }),
    ];
  },
});
