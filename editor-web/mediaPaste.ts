import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { sendMessage } from '@10play/tentap-editor';
import { MediaAction, pasteReplies } from '../src/editor/mediaBridge';

/** Pictures and sounds a paste can bring, by type, with the extension they are saved under. */
const TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac',
};

/**
 * Puts files from `attachments/` in the note at `pos` (else over the selection), under the title
 * when that is where they were aimed, so the first line stays the title.
 */
export function insertMedia(editor: Editor, paths: string[], pos?: number) {
  const nodes = paths.map((src) => ({ type: 'image', attrs: { src } }));
  const title = editor.state.doc.firstChild?.nodeSize ?? 0;
  const at = pos ?? editor.state.selection.from;
  const chain = editor.chain().focus();
  (at < title ? chain.insertContentAt(title, nodes) : pos === undefined ? chain.insertContent(nodes) : chain.insertContentAt(pos, nodes)).run();
}

/**
 * A picture or sound pasted into a note (a screenshot, an image copied in a browser or Finder) is
 * handed to `save`, which keeps it in `attachments/` and returns its path, and goes in at the caret.
 * Copied text that has pictures in it (part of a web page) pastes as text, as before.
 */
export function pastedMedia(save: (file: File, ext: string) => Promise<string | null>) {
  return Extension.create({
    name: 'vbPastedMedia',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey('vbPastedMedia'),
          props: {
            handlePaste: (_view, event) => {
              const data = event.clipboardData;
              const files = [...(data?.files ?? [])].filter((f) => TYPES[f.type]);
              if (!files.length) return false;
              const html = data?.getData('text/html');
              if (html && new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim()) return false;
              void (async () => {
                const saved: string[] = [];
                for (const f of files) {
                  const path = await save(f, TYPES[f.type]);
                  if (path) saved.push(path);
                }
                if (saved.length) insertMedia(editor, saved);
              })().catch((e) => console.warn('pasting a picture failed', e));
              return true;
            },
          },
        }),
      ];
    },
  });
}

let pasteId = 0;
/** The phone: the page sends the file to the app, which saves it (`mediaHost.paste`) and answers with its path. */
export const AppPastedMedia = pastedMedia(async (file, ext) => {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const id = ++pasteId;
  return new Promise<string | null>((resolve) => {
    pasteReplies.set(id, resolve);
    sendMessage({ type: MediaAction.Paste, payload: { id, data, ext } } as never);
    setTimeout(() => { if (pasteReplies.delete(id)) resolve(null); }, 30000);
  });
});
