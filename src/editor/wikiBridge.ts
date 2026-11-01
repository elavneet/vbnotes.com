import { BridgeExtension } from '@10play/tentap-editor';

/**
 * `[[Note title]]` links (`editor-web/wikiLinks.ts`). The page asks the app for notes matching what
 * is typed after `[[`, and asks it to open a linked note. Runs in both worlds: the page side answers
 * replies through `wikiReplies`, the app sets `wikiHost`.
 */
export enum WikiAction {
  Find = 'wiki-find',
  Found = 'wiki-found',
  Open = 'wiki-open',
}

export type WikiNote = { title: string; path: string };

type WikiMessage =
  | { type: WikiAction.Find; payload: { id: number; query: string } }
  | { type: WikiAction.Found; payload: { id: number; notes: WikiNote[] } }
  | { type: WikiAction.Open; payload: { title: string } };

type WikiInstance = { wikiFound: (id: number, notes: WikiNote[]) => void };

declare module '@10play/tentap-editor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EditorBridge extends WikiInstance {}
}

/** The app side: set by NoteEditor, so this file stays free of React Native imports. */
export const wikiHost: { find?: (query: string) => WikiNote[]; open?: (title: string) => void } = {};

/** The page side: answers waiting for the app, by request id. */
export const wikiReplies = new Map<number, (notes: WikiNote[]) => void>();

export const WikiBridge = new BridgeExtension<object, WikiInstance, WikiMessage>({
  forceName: 'vbWiki',
  onBridgeMessage: (_editor, message) => {
    if (message.type !== WikiAction.Found) return false;
    wikiReplies.get(message.payload.id)?.(message.payload.notes);
    wikiReplies.delete(message.payload.id);
    return true;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    wikiFound: (id, notes) => sendBridgeMessage({ type: WikiAction.Found, payload: { id, notes } }),
  }),
  onEditorMessage: (message, editor) => {
    if (message.type === WikiAction.Find) {
      (editor as unknown as WikiInstance).wikiFound(message.payload.id, wikiHost.find?.(message.payload.query) ?? []);
      return true;
    }
    if (message.type === WikiAction.Open) {
      wikiHost.open?.(message.payload.title);
      return true;
    }
    return false;
  },
});
