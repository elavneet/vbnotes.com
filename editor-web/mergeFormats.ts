import { Extension, isNodeActive, type CommandProps } from '@tiptap/core';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type {} from '@tiptap/extension-blockquote';
import type {} from '@tiptap/extension-code';
import type {} from '@tiptap/extension-code-block';
import type {} from '@tiptap/extension-list';

const LISTS = ['bulletList', 'orderedList', 'taskList'];

/** The whole blocks the selection touches, as siblings in the deepest parent where `type` may take their place. */
function span(state: EditorState, type: NodeType) {
  const { $from, $to } = state.selection;
  for (let d = $from.sharedDepth($to.pos); d >= 0; d--) {
    const start = $from.index(d);
    const end = $to.indexAfter(d);
    if ($from.node(d).canReplaceWith(start, end, type)) {
      return { from: $from.posAtIndex(start, d), to: $from.posAtIndex(end, d), kids: $from.node(d).content.content.slice(start, end) };
    }
  }
  return null;
}

/** Puts `node` where the blocks were and selects its text, as they were selected before. */
function put(tr: Transaction, from: number, to: number, node: PMNode) {
  tr.replaceWith(from, to, node);
  tr.setSelection(TextSelection.between(tr.doc.resolve(from + 1), tr.doc.resolve(from + node.nodeSize - 1)));
}

/**
 * Code on lines that are all code already takes them out of the code block, one line each.
 * Otherwise the lines join into one code block, including any code already among them.
 */
function codeBlock({ state, tr, dispatch, editor }: CommandProps) {
  const { from, to, $from, $to } = state.selection;
  const blocks: [number, PMNode][] = [];
  let other = false;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.isTextblock && n.type.spec.code) blocks.push([pos, n]);
    else if (n.isTextblock) other = true;
    return !n.isTextblock;
  });
  const { schema } = state;
  const line = (text: string, type: NodeType) => type.create(null, text ? schema.text(text) : null);
  if (blocks.length && !other) {
    if (!dispatch) return true;
    const [first] = blocks[0];
    const [lastPos, last] = blocks[blocks.length - 1];
    for (const [pos, n] of blocks.reverse()) tr.replaceWith(pos, pos + n.nodeSize, n.textContent.split('\n').map((l) => line(l, schema.nodes.paragraph)));
    tr.setSelection(TextSelection.between(tr.doc.resolve(first + 1), tr.doc.resolve(tr.mapping.map(lastPos + last.nodeSize, 1) - 1)));
    return true;
  }
  const s = span(state, schema.nodes.codeBlock);
  if (!s) return false;
  if (!dispatch) return true;
  // Images and rules keep their markdown, so nothing is lost.
  const text = state.doc.textBetween(s.from, s.to, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : editor.markdown?.serialize(leaf.toJSON()).trim() ?? ''));
  const node = line(text, schema.nodes.codeBlock);
  put(tr, s.from, s.to, node);
  // One line made into a block keeps the caret or selection where it was.
  if (s.kids.length === 1 && s.kids[0] === $from.parent && $from.sameParent($to)) {
    const end = s.from + node.nodeSize - 1;
    tr.setSelection(TextSelection.create(tr.doc, Math.min(s.from + 1 + $from.parentOffset, end), Math.min(s.from + 1 + $to.parentOffset, end)));
  }
  return true;
}

/** A list over lines that include a list: one list of the chosen kind, items and their nesting kept. */
const toggleList = (name: string, itemName: string) => () => ({ state, tr, dispatch, commands }: CommandProps) => {
  const type = state.schema.nodes[name];
  const item = state.schema.nodes[itemName];
  const s = span(state, type);
  if (!s || s.kids.length < 2 || !s.kids.some((k) => LISTS.includes(k.type.name))) return commands.toggleList(name, itemName);
  const items = s.kids.flatMap((k) => (LISTS.includes(k.type.name)
    ? k.content.content.map((it) => (it.type === item ? it : item.createAndFill(null, it.content)))
    : [item.createAndFill(null, k)]));
  if (items.some((it) => !it)) return commands.toggleList(name, itemName);
  if (dispatch) put(tr, s.from, s.to, type.create(null, items as PMNode[]));
  return true;
};

/**
 * Formatting a selection that is partly formatted already makes one block of it. Stock Tiptap
 * left a code block between lines of inline code, quoted a quote inside a new quote, and put an
 * existing list inside the new one. Marks (bold and the rest) and headings already did this.
 */
export const MergeFormats = Extension.create({
  name: 'vbMergeFormats',
  // Runs after the stock extensions, so these commands replace theirs.
  priority: 1,
  addCommands() {
    return {
      toggleCode: () => (props) => {
        const { $from, $to } = props.state.selection;
        // Within one line, inline code as before.
        if ($from.sameParent($to) && !$from.parent.type.spec.code) return props.commands.toggleMark('code');
        return codeBlock(props);
      },
      toggleCodeBlock: () => codeBlock,
      toggleBlockquote: () => ({ state, tr, dispatch, commands }) => {
        const type = state.schema.nodes.blockquote;
        const s = span(state, type);
        if (!s || !s.kids.some((k) => k.type === type) || isNodeActive(state, type)) return commands.toggleWrap(type.name);
        if (dispatch) put(tr, s.from, s.to, type.create(null, s.kids.flatMap((k) => (k.type === type ? k.content.content : [k]))));
        return true;
      },
      toggleBulletList: toggleList('bulletList', 'listItem'),
      toggleOrderedList: toggleList('orderedList', 'listItem'),
      toggleTaskList: toggleList('taskList', 'taskItem'),
    };
  },
});
