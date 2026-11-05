import { BridgeExtension } from '@10play/tentap-editor';
import type { PlayStatus } from '@/media/player';

/**
 * Audio rows in the editor page (`editor-web/media.ts`) ask the app to play, pause, seek or measure a
 * clip; the app plays it natively (`src/media/player.ts`) and sends the status back to the page.
 * A picture pasted in the page (`editor-web/mediaPaste.ts`) comes to the app to be saved, and the
 * app answers with where it went; a picture the page can't load (still in iCloud) is fetched by the
 * app and handed back. Runs in both worlds: only `type` imports cross over, so the page bundle stays free of app code.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type MediaState = {};
type MediaInstance = { _sendMediaStatus: (s: PlayStatus) => void; _sendReply: (id: number, value: string | null) => void };

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
  Fetch = 'media-fetch',
  /** The app's answer to a Paste or Fetch, by request id. */
  Reply = 'media-reply',
}

export type MediaMessage =
  | { type: MediaAction.Toggle | MediaAction.Probe; payload: { src: string } }
  | { type: MediaAction.Seek; payload: { src: string; fraction: number } }
  | { type: MediaAction.Status; payload: PlayStatus }
  | { type: MediaAction.Paste; payload: { id: number; data: string; ext: string } }
  | { type: MediaAction.Fetch; payload: { id: number; src: string } }
  | { type: MediaAction.Reply; payload: { id: number; value: string | null } };

type PlayMessage = Extract<MediaMessage, { type: MediaAction.Toggle | MediaAction.Seek | MediaAction.Probe }>;

/** The page listens for this DOM event; detail is a `PlayStatus`. */
export const MEDIA_STATUS_EVENT = 'vb-media-status';

/** The app side: set by NoteEditor so the bridge can reach the player without importing it here. */
export const mediaHost: {
  handle?: (m: PlayMessage, report: (s: PlayStatus) => void) => void;
  /** Saves a pasted file (base64) in `attachments/`; resolves with its path. */
  paste?: (data: string, ext: string) => Promise<string>;
  /** A picture the page couldn't load, as a data URL once it is on the phone; null if it never comes. */
  fetch?: (src: string) => Promise<string | null>;
} = {};

/** The page side: requests waiting for the app's answer, by id. */
export const replies = new Map<number, (value: string | null) => void>();

export const MediaBridge = new BridgeExtension<MediaState, MediaInstance, MediaMessage>({
  forceName: 'vbMedia',
  onBridgeMessage: (_editor, message) => {
    if (message.type === MediaAction.Reply) {
      replies.get(message.payload.id)?.(message.payload.value);
      replies.delete(message.payload.id);
      return true;
    }
    if (message.type !== MediaAction.Status) return false;
    window.dispatchEvent(new CustomEvent(MEDIA_STATUS_EVENT, { detail: message.payload }));
    return true;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    _sendMediaStatus: (s) => sendBridgeMessage({ type: MediaAction.Status, payload: s }),
    _sendReply: (id, value) => sendBridgeMessage({ type: MediaAction.Reply, payload: { id, value } }),
  }),
  onEditorMessage: (message, editor) => {
    const instance = editor as unknown as MediaInstance;
    if (message.type === MediaAction.Paste || message.type === MediaAction.Fetch) {
      const p = message.payload;
      const work = 'src' in p ? mediaHost.fetch?.(p.src) : mediaHost.paste?.(p.data, p.ext);
      (work ?? Promise.resolve(null))
        .catch((e) => { console.warn(`${message.type} failed`, e); return null; })
        .then((value) => instance._sendReply(p.id, value));
      return true;
    }
    if (message.type === MediaAction.Status || message.type === MediaAction.Reply || !Object.values(MediaAction).includes(message.type)) return false;
    mediaHost.handle?.(message, (s) => instance._sendMediaStatus(s));
    return true;
  },
});
