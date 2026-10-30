import { Extension } from '@tiptap/core';
import { sendMessage } from '@10play/tentap-editor';
import { MarkdownActionType } from '../src/editor/markdownBridge';

// At most this often while typing; a single edit goes at once. Leaving right after a key loses nothing.
const PUSH_MS = 150;
let last = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Sends the note's markdown to the app as it is edited. The app used to ask for it when the note
 * closed, but a quick swipe back tore the page down before it answered and the edit was lost.
 */
export const MarkdownPush = Extension.create({
  name: 'markdownPush',
  onUpdate() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      last = Date.now();
      const content = (this.editor as any).getMarkdown() as string;
      sendMessage({ type: MarkdownActionType.Changed, payload: { content } } as never);
    }, Math.max(0, last + PUSH_MS - Date.now()));
  },
});
