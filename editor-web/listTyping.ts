import { Extension, InputRule } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import type {} from '@tiptap/extension-list';

const ITEMS = ['listItem', 'taskItem'];
const LISTS = ['bulletList', 'orderedList', 'taskList'];

/** The list item whose first line holds the caret, and how many lists deep it sits. */
function itemAt(state: EditorState) {
  const { $from } = state.selection;
  const d = $from.depth - 1;
  if (d < 1 || !ITEMS.includes($from.node(d).type.name) || $from.index(d) !== 0) return null;
  let depth = 0;
  for (let i = d; i > 0; i--) if (ITEMS.includes($from.node(i).type.name)) depth++;
  return { name: $from.node(d).type.name, list: $from.node(d - 1).type.name, depth };
}

/** The last line in a list: its node and where its text ends. */
function lastLine(list: PMNode, pos: number) {
  let line: { node: PMNode; end: number } | null = null;
  list.descendants((node, at) => {
    if (node.isTextblock) line = { node, end: pos + 1 + at + node.nodeSize - 1 };
  });
  return line as { node: PMNode; end: number } | null;
}

/**
 * The line at `at` (a position between blocks) right under a list joins the list's last line, and
 * an empty one just goes, with the caret at the end of the line above. Two lists it kept apart
 * become one. Backspace at the line's start and Delete at the end of the list do this; stock Tiptap
 * made the line a new item of the list above (Backspace then took it out again, so Backspace went
 * back and forth and never got anywhere) or tucked it into the last item.
 */
function joinListAbove(state: EditorState, at: number): Transaction | null {
  const $at = state.doc.resolve(at);
  const block = $at.nodeAfter;
  const list = $at.nodeBefore;
  if (!block?.isTextblock || block.type.spec.code || !list || !LISTS.includes(list.type.name)) return null;
  const line = lastLine(list, at - list.nodeSize);
  if (!line || (block.content.size && line.node.type.spec.code)) return null;
  const tr = state.tr.delete(at, at + block.nodeSize);
  if (block.content.size) tr.insert(line.end, block.content);
  const seam = tr.mapping.map(at + block.nodeSize);
  const $seam = tr.doc.resolve(seam);
  if ($seam.nodeBefore?.type === $seam.nodeAfter?.type && LISTS.includes($seam.nodeAfter?.type.name ?? '') && canJoin(tr.doc, seam)) {
    tr.join(seam);
  }
  return tr.setSelection(TextSelection.create(tr.doc, line.end)).scrollIntoView();
}

/** At the end of a list's last line: the position after the list, if a line follows it. */
function afterList(state: EditorState) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.index(d - 1) < $from.node(d - 1).childCount - 1) {
      return LISTS.includes($from.node(d).type.name) ? $from.after(d) : null;
    }
  }
  return null;
}

/**
 * Lists as Bear edits them. Backspace at the start of an item takes its bullet away (one level
 * for a sub item); stock Tiptap joined the line to the item above, indented and without a bullet,
 * so a heading typed there sat inside the list. `# ` to `###### ` at the start of an item take
 * the line out of the list as a heading, and `- ` (or `* `, `+ `) makes it a sub item of the one
 * above; stock Tiptap left those characters as text in the bullet.
 */
export const ListTyping = Extension.create({
  name: 'vbListTyping',
  // Ahead of the stock Backspace and of the heading and list input rules.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { empty, $from } = editor.state.selection;
        if (!empty || $from.parentOffset > 0) return false;
        const item = itemAt(editor.state);
        if (item) return editor.commands.liftListItem(item.name);
        const tr = $from.depth > 0 ? joinListAbove(editor.state, $from.before()) : null;
        if (tr) editor.view.dispatch(tr);
        return !!tr;
      },
      Delete: ({ editor }) => {
        const { empty, $from } = editor.state.selection;
        if (!empty || $from.parentOffset < $from.parent.content.size) return false;
        const at = afterList(editor.state);
        const tr = at === null ? null : joinListAbove(editor.state, at);
        if (tr) editor.view.dispatch(tr);
        return !!tr;
      },
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^(#{1,6})\s$/,
        handler: ({ state, range, match, chain }) => {
          const item = itemAt(state);
          if (!item) return null;
          let c = chain().deleteRange(range);
          for (let i = 0; i < item.depth; i++) c = c.liftListItem(item.name);
          c.setNode('heading', { level: match[1].length }).run();
        },
      }),
      new InputRule({
        find: /^\s*[-+*]\s$/,
        handler: ({ state, range, chain, can }) => {
          const item = itemAt(state);
          // A numbered item stays as typed: sinking it would make a numbered sub list.
          if (!item || item.list === 'orderedList' || !can().sinkListItem(item.name)) return null;
          chain().deleteRange(range).sinkListItem(item.name).run();
        },
      }),
    ];
  },
});
