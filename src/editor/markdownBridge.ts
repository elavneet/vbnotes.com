import { Markdown } from '@tiptap/markdown';
import { BridgeExtension } from '@10play/tentap-editor';
import { isBareLink } from '../utils/links';

/**
 * Lets the native side load and read markdown directly, so notes stay plain
 * `.md` files and never pass through HTML. Runs in both worlds: the tiptap
 * extension part inside the WebView, the `extendEditorInstance` part in React Native.
 */
type MarkdownState = {
  /** The caret sits right after a `#tag`, so the toolbar can offer `/` to nest the next one. */
  caretInTag: boolean;
};
type MarkdownInstance = {
  setMarkdown: (markdown: string, options?: { emitUpdate?: boolean }) => void;
  getMarkdown: () => Promise<string>;
  /** Types plain text at the caret, e.g. `#` to start a tag. */
  insertText: (text: string) => void;
};

declare module '@10play/tentap-editor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface BridgeState extends MarkdownState {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EditorBridge extends MarkdownInstance {}
}

export enum MarkdownActionType {
  Set = 'md-set',
  Get = 'md-get',
  Reply = 'md-reply',
  Insert = 'md-insert',
  Changed = 'md-changed',
}

type MarkdownMessage =
  | { type: MarkdownActionType.Set; payload: { markdown: string; emitUpdate?: boolean } }
  | { type: MarkdownActionType.Get; payload: { messageId: string } }
  | { type: MarkdownActionType.Reply; payload: { content: string; messageId: string } }
  | { type: MarkdownActionType.Insert; payload: { text: string } }
  | { type: MarkdownActionType.Changed; payload: { content: string } };

/**
 * The page sends the note's markdown shortly after each edit (`editor-web/markdownPush.ts`), so the
 * app holds the latest text when the note closes. NoteEditor listens here, per editor.
 */
export const markdownListeners = new WeakMap<object, (markdown: string) => void>();

/**
 * Notes are files people also open elsewhere, so text is written the way it was
 * typed. Tiptap's default escaping turned `&` into `&amp;` and `snake_case` into
 * `snake\_case` on every save. Only characters that would really turn into
 * formatting on the next load are escaped.
 */
const PlainMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    const manager = (this.editor as any).markdown;
    if (!manager) return;
    const codeTypes: Set<string> = manager.codeTypes ?? new Set(['code', 'codeBlock']);
    manager.encodeTextForMarkdown = (text: string, node: any, parent: any) => {
      const inCode = (parent?.type && codeTypes.has(parent.type))
        || (node?.marks ?? []).some((m: any) => codeTypes.has(typeof m === 'string' ? m : m.type));
      if (inCode) return text;
      // A bare address is written back as is (see editor-web/links.ts); escaping would break it.
      const link = (node?.marks ?? []).find((m: any) => m?.type === 'link');
      if (link && isBareLink(text, String(link.attrs?.href ?? ''))) return text;
      return text
        .replace(/([`*])/g, '\\$1')
        .replace(/~~/g, '\\~\\~')
        .replace(/(^|[^A-Za-z0-9])_|_(?=[^A-Za-z0-9]|$)/g, (m) => m.replace('_', '\\_'));
    };
  },
});

// A `#tag` (letters, digits, `_`, `-`, `/`) ending right at the caret, at a line start or after a space.
const TAG_AT_CARET = /(?:^|\s)#([A-Za-z0-9_\u00C0-\uFFFF][A-Za-z0-9_\u00C0-\uFFFF\-/]*)$/;
const LETTER = /[A-Za-z\u00C0-\uFFFF]/;

export const MarkdownBridge = new BridgeExtension<MarkdownState, MarkdownInstance, MarkdownMessage>({
  tiptapExtension: PlainMarkdown.configure({ indentation: { style: 'space', size: 2 } }),
  extendEditorState: (editor) => {
    const { empty, $from } = editor.state.selection;
    if (!empty || $from.parent.type.spec.code || editor.isActive('code')) return { caretInTag: false };
    const m = TAG_AT_CARET.exec($from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC'));
    return { caretInTag: !!m && LETTER.test(m[1]) };
  },
  onBridgeMessage: (editor, message, sendMessageBack) => {
    if (message.type === MarkdownActionType.Set) {
      const { markdown, emitUpdate } = message.payload;
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: emitUpdate ?? false } as any);
      return true;
    }
    if (message.type === MarkdownActionType.Insert) {
      editor.chain().focus().insertContent(message.payload.text).run();
      return true;
    }
    if (message.type === MarkdownActionType.Get) {
      sendMessageBack({
        type: MarkdownActionType.Reply,
        payload: { content: editor.getMarkdown(), messageId: message.payload.messageId },
      });
      return true;
    }
    return false;
  },
  extendEditorInstance: (sendBridgeMessage, _webviewRef, _state, _setState, _platform, context) => ({
    insertText: (text) => sendBridgeMessage({ type: MarkdownActionType.Insert, payload: { text } }),
    setMarkdown: (markdown, options) =>
      sendBridgeMessage({ type: MarkdownActionType.Set, payload: { markdown, emitUpdate: options?.emitUpdate } }),
    getMarkdown: () => {
      if (context) return context.rpc<string>({ type: MarkdownActionType.Get } as any);
      // 1.0-style host fallback: not expected with tentap 1.1, kept for safety.
      return new Promise<string>((resolve) => {
        const messageId = `md-${Date.now()}-${Math.random()}`;
        pendingReplies.set(messageId, resolve);
        sendBridgeMessage({ type: MarkdownActionType.Get, payload: { messageId } });
      });
    },
  }),
  onEditorMessage: (message, editor) => {
    if (message.type === MarkdownActionType.Changed) {
      markdownListeners.get(editor)?.(message.payload.content);
      return true;
    }
    if (message.type === MarkdownActionType.Reply) {
      const r = pendingReplies.get(message.payload.messageId);
      if (r) { pendingReplies.delete(message.payload.messageId); r(message.payload.content); return true; }
    }
    return false;
  },
});

const pendingReplies = new Map<string, (md: string) => void>();
