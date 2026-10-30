import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/**
 * Code switched on, then a paste: the text goes in as code, exactly as copied. One line
 * stays inline code; several lines become a code block so the line breaks survive.
 * Inside a code block ProseMirror already pastes plain text, so that case is left alone.
 */
export const CodePaste = Extension.create({
  name: 'vbCodePaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('vbCodePaste'),
        props: {
          handlePaste: (view, event) => {
            const { state } = view;
            const { code } = state.schema.marks;
            const { $from } = state.selection;
            if (!code || $from.parent.type.spec.code) return false;
            const marks = state.storedMarks ?? $from.marks();
            const text = code.isInSet(marks) ? event.clipboardData?.getData('text/plain') : '';
            if (!text) return false;
            const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
            const block = state.schema.nodes.codeBlock;
            let tr = state.tr;
            if (clean.includes('\n') && block) {
              const node = block.create(null, state.schema.text(clean));
              if (state.selection.empty && $from.parent.content.size === 0) {
                // An empty line becomes the block itself, with the caret at its end.
                const at = $from.before();
                tr = tr.replaceWith(at, $from.after(), node);
                tr.setSelection(TextSelection.create(tr.doc, at + node.nodeSize - 1));
              } else {
                tr = tr.replaceSelectionWith(node);
              }
            } else {
              tr = tr.replaceSelectionWith(state.schema.text(clean, marks), false);
            }
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
