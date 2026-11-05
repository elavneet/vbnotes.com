import { BridgeExtension } from '@10play/tentap-editor';
import type { PlayStatus } from '@/media/player';

/**
 * Audio rows in the editor page (`editor-web/media.ts`) ask the app to play, pause, seek or measure a
 * clip; the app plays it natively (`src/media/player.ts`) and sends the status back to the page.
 * A picture pasted in the page (`editor-web/mediaPaste.ts`) comes to the app to be saved, and the
 * app answers with where it went. Runs in both worlds: only `type` imports cross over, so the page bundle stays free of app code.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type MediaState = {};
type MediaInstance = { _sendMediaStatus: (s: PlayStatus) => void; _sendPasted: (id: number, path: string | null) => void };

declare module '@10play/tentap-editor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface BridgeState extends MediaState {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EditorBridge extends MediaInstance {}
}

export enum MediaAction {
  Toggle = 'media-toggle',
  Seek = 'media-seek',
  Probe = 'media-probe',
  Status = 'media-status',
  Paste = 'media-paste',
  Pasted = 'media-pasted',
}

export type MediaMessage =
  | { type: MediaAction.Toggle | MediaAction.Probe; payload: { src: string } }
  | { type: MediaAction.Seek; payload: { src: string; fraction: number } }
  | { type: MediaAction.Status; payload: PlayStatus }
  | { type: MediaAction.Paste; payload: { id: number; data: string; ext: string } }
  | { type: MediaAction.Pasted; payload: { id: number; path: string | null } };

type PlayMessage = Extract<MediaMessage, { type: MediaAction.Toggle | MediaAction.Seek | MediaAction.Probe }>;

/** The page listens for this DOM event; detail is a `PlayStatus`. */
export const MEDIA_STATUS_EVENT = 'vb-media-status';

/** The app side: set by NoteEditor so the bridge can reach the player without importing it here. */
export const mediaHost: {
  handle?: (m: PlayMessage, report: (s: PlayStatus) => void) => void;
  /** Saves a pasted file (base64) in `attachments/`; resolves with its path. */
  paste?: (data: string, ext: string) => Promise<string>;
} = {};

/** The page side: pastes waiting for the app to save them, by request id. */
export const pasteReplies = new Map<number, (path: string | null) => void>();

export const MediaBridge = new BridgeExtension<MediaState, MediaInstance, MediaMessage>({
  forceName: 'vbMedia',
  onBridgeMessage: (_editor, message) => {
    if (message.type === MediaAction.Pasted) {
      pasteReplies.get(message.payload.id)?.(message.payload.path);
      pasteReplies.delete(message.payload.id);
      return true;
    }
    if (message.type !== MediaAction.Status) return false;
    window.dispatchEvent(new CustomEvent(MEDIA_STATUS_EVENT, { detail: message.payload }));
    return true;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    _sendMediaStatus: (s) => sendBridgeMessage({ type: MediaAction.Status, payload: s }),
    _sendPasted: (id, path) => sendBridgeMessage({ type: MediaAction.Pasted, payload: { id, path } }),
  }),
  onEditorMessage: (message, editor) => {
    const instance = editor as unknown as MediaInstance;
    if (message.type === MediaAction.Paste) {
      const { id, data, ext } = message.payload;
      (mediaHost.paste?.(data, ext) ?? Promise.resolve(null))
        .catch((e) => { console.warn('saving a pasted picture failed', e); return null; })
        .then((path) => instance._sendPasted(id, path));
      return true;
    }
    if (message.type === MediaAction.Status || message.type === MediaAction.Pasted || !Object.values(MediaAction).includes(message.type)) return false;
    mediaHost.handle?.(message, (s) => instance._sendMediaStatus(s));
    return true;
  },
});
