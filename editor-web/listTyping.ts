import { Extension, InputRule } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type {} from '@tiptap/extension-list';

const ITEMS = ['listItem', 'taskItem'];

/** The list item whose first line holds the caret, and how many lists deep it sits. */
function itemAt(state: EditorState) {
  const { $from } = state.selection;
  const d = $from.depth - 1;
  if (d < 1 || !ITEMS.includes($from.node(d).type.name) || $from.index(d) !== 0) return null;
  let depth = 0;
  for (let i = d; i > 0; i--) if (ITEMS.includes($from.node(i).type.name)) depth++;
  return { name: $from.node(d).type.name, list: $from.node(d - 1).type.name, depth };
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
        const item = empty && $from.parentOffset === 0 ? itemAt(editor.state) : null;
        return item ? editor.commands.liftListItem(item.name) : false;
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
