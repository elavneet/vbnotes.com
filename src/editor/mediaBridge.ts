import { BridgeExtension } from '@10play/tentap-editor';
import type { PlayStatus } from '@/media/player';

/**
 * Audio rows in the editor page (`editor-web/media.ts`) ask the app to play, pause, seek or measure a
 * clip; the app plays it natively (`src/media/player.ts`) and sends the status back to the page.
 * Runs in both worlds: only `type` imports cross over, so the page bundle stays free of app code.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type MediaState = {};
type MediaInstance = { _sendMediaStatus: (s: PlayStatus) => void };

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
}

export type MediaMessage =
  | { type: MediaAction.Toggle | MediaAction.Probe; payload: { src: string } }
  | { type: MediaAction.Seek; payload: { src: string; fraction: number } }
  | { type: MediaAction.Status; payload: PlayStatus };

/** The page listens for this DOM event; detail is a `PlayStatus`. */
export const MEDIA_STATUS_EVENT = 'vb-media-status';

/** The app side: set by NoteEditor so the bridge can reach the player without importing it here. */
export const mediaHost: {
  handle?: (m: Exclude<MediaMessage, { type: MediaAction.Status }>, report: (s: PlayStatus) => void) => void;
} = {};

export const MediaBridge = new BridgeExtension<MediaState, MediaInstance, MediaMessage>({
  forceName: 'vbMedia',
  onBridgeMessage: (_editor, message) => {
    if (message.type !== MediaAction.Status) return false;
    window.dispatchEvent(new CustomEvent(MEDIA_STATUS_EVENT, { detail: message.payload }));
    return true;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    _sendMediaStatus: (s) => sendBridgeMessage({ type: MediaAction.Status, payload: s }),
  }),
  onEditorMessage: (message, editor) => {
    if (message.type === MediaAction.Status || !Object.values(MediaAction).includes(message.type)) return false;
    mediaHost.handle?.(message, (s) => (editor as unknown as MediaInstance)._sendMediaStatus(s));
    return true;
  },
});
