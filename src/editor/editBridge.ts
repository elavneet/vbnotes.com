import { BridgeExtension } from '@10play/tentap-editor';
import type {} from '@tiptap/extension-table';
import type {} from '@tiptap/extension-horizontal-rule';
import type {} from '@tiptap/extension-code-block';

/** Edits the stock bridges lack, for the format keyboard: caret jumps, the keys it replaces, blocks. */
export type EditCommand = 'start' | 'end' | 'backspace' | 'enter' | 'table' | 'rule' | 'codeBlock';

type EditInstance = {
  run: (command: EditCommand) => void;
  /** Puts the caret at the n-th heading and scrolls it into view (the outline). */
  goToHeading: (index: number) => void;
};

declare module '@10play/tentap-editor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EditorBridge extends EditInstance {}
}

enum EditActionType {
  Run = 'edit-run',
  Heading = 'edit-heading',
}

type EditMessage =
  | { type: EditActionType.Run; payload: { command: EditCommand } }
  | { type: EditActionType.Heading; payload: { index: number } };

export const EditBridge = new BridgeExtension<object, EditInstance, EditMessage>({
  forceName: 'vbEdit',
  onBridgeMessage: (editor, message) => {
    if (message.type === EditActionType.Heading) {
      let seen = 0;
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at >= 0) return false;
        if (node.type.name === 'heading' && seen++ === message.payload.index) at = pos + node.nodeSize - 1;
        return node.isBlock;
      });
      if (at >= 0) editor.chain().setTextSelection(at).scrollIntoView().run();
      return true;
    }
    if (message.type !== EditActionType.Run) return false;
    const chain = editor.chain().focus();
    switch (message.payload.command) {
      case 'start': editor.chain().focus('start').scrollIntoView().run(); break;
      case 'end': editor.chain().focus('end').scrollIntoView().run(); break;
      case 'enter': chain.enter().run(); break;
      case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
      case 'rule': chain.setHorizontalRule().run(); break;
      case 'codeBlock': chain.toggleCodeBlock().run(); break;
      case 'backspace': {
        const { empty, $from, from } = editor.state.selection;
        if (empty && $from.parentOffset > 0) {
          // One character, keeping an emoji's two halves together.
          const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset, undefined, '￼');
          const n = before.length === 2 && /[\uDC00-\uDFFF]$/.test(before) ? 2 : 1;
          chain.deleteRange({ from: from - n, to: from }).run();
        } else {
          // Joins with the line above, or deletes a selection, as the Backspace key would.
          chain.keyboardShortcut('Backspace').run();
        }
        break;
      }
    }
    return true;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    run: (command) => sendBridgeMessage({ type: EditActionType.Run, payload: { command } }),
    goToHeading: (index) => sendBridgeMessage({ type: EditActionType.Heading, payload: { index } }),
  }),
});
