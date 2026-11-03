import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';

const key = new PluginKey('vbHeadingMarks');

/** The heading the caret sits at the very start of, if it does. */
function headingStart(state: EditorState) {
  const { $from, empty } = state.selection;
  return empty && $from.parent.type.name === 'heading' && $from.parentOffset === 0 ? $from : null;
}

/**
 * Headings as Bear shows them: with the caret at the start of a heading its `#`s appear in front of
 * it, Backspace there takes them away (the line becomes text), and typing `# ` at the start of a
 * line makes it a heading again (Tiptap's input rule), its `#`s hidden once the caret moves on.
 */
export const HeadingMarks = Extension.create({
  name: 'vbHeadingMarks',
  // Ahead of the stock Backspace, which would join the heading to the line above.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => (headingStart(editor.state) ? editor.commands.setNode('paragraph') : false),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations: (state) => {
            const at = headingStart(state);
            // An empty heading shows its placeholder instead.
            if (!at || !at.parent.content.size) return null;
            const level = at.parent.attrs.level as number;
            const marks = Decoration.widget(at.pos, () => {
              const el = document.createElement('span');
              el.className = 'vb-hmark';
              el.textContent = `${'#'.repeat(level)} `;
              el.contentEditable = 'false';
              return el;
            }, { side: -1, key: `hmark-${level}`, ignoreSelection: true });
            return DecorationSet.create(state.doc, [marks]);
          },
        },
      }),
    ];
  },
});
