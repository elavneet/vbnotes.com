import { BridgeExtension } from '@10play/tentap-editor';

/**
 * Tapping a link in the editor page (`editor-web/links.ts`) asks the app to open it in the browser.
 * Runs in both worlds: the page only imports the enum, the app sets `linkHost.open`.
 */
export enum LinkAction {
  Open = 'link-open',
}

type LinkMessage = { type: LinkAction.Open; payload: { url: string } };

/** The app side: set by NoteEditor, so this file stays free of React Native imports. */
export const linkHost: { open?: (url: string) => void } = {};

export const LinkOpenBridge = new BridgeExtension<object, object, LinkMessage>({
  forceName: 'vbLinks',
  onEditorMessage: (message) => {
    if (message.type !== LinkAction.Open) return false;
    linkHost.open?.(message.payload.url);
    return true;
  },
});
