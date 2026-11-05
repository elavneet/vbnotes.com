import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { sendMessage } from '@10play/tentap-editor';
import { isAudio } from '../src/utils/media';
import { MEDIA_STATUS_EVENT, MediaAction, replies } from '../src/editor/mediaBridge';
import type { PlayStatus } from '../src/media/player';

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>';
const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

/**
 * `![](attachments/x.m4a)`: a play button, a scrubbable track and the time. The sound itself plays
 * in the app (see `src/editor/mediaBridge.ts`), which reports back position and length.
 */
class AudioView implements NodeView {
  dom: HTMLElement;
  private onStatus: (e: Event) => void;
  constructor(node: PMNode) {
    const src = String(node.attrs.src);
    const post = (type: MediaAction, extra?: object) => sendMessage({ type, payload: { src, ...extra } } as never);
    this.dom = document.createElement('div');
    this.dom.className = 'vb-audio';
    this.dom.contentEditable = 'false';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'vb-play';
    play.setAttribute('aria-label', 'Play');
    play.innerHTML = ICON_PLAY;
    const track = document.createElement('div');
    track.className = 'vb-track';
    const fill = document.createElement('div');
    fill.className = 'vb-fill';
    track.appendChild(fill);
    const time = document.createElement('span');
    time.className = 'vb-time';
    time.textContent = node.attrs.alt || 'Audio';
    this.onStatus = (e) => {
      const s = (e as CustomEvent<PlayStatus>).detail;
      if (s.src !== src) {
        // Another clip started: this one is no longer playing.
        if (play.getAttribute('aria-label') === 'Pause') { play.innerHTML = ICON_PLAY; play.setAttribute('aria-label', 'Play'); }
        return;
      }
      if (!s.duration) { this.dom.classList.add('vb-missing'); time.textContent = 'Can\'t play this file'; return; }
      this.dom.classList.remove('vb-missing');
      fill.style.width = `${Math.min(100, (s.position / s.duration) * 100)}%`;
      time.textContent = s.position > 0 ? `${fmt(s.position)} / ${fmt(s.duration)}` : fmt(s.duration);
      play.innerHTML = s.playing ? ICON_PAUSE : ICON_PLAY;
      play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    };
    window.addEventListener(MEDIA_STATUS_EVENT, this.onStatus);
    play.addEventListener('click', () => post(MediaAction.Toggle));
    track.addEventListener('click', (e) => {
      const r = track.getBoundingClientRect();
      post(MediaAction.Seek, { fraction: (e.clientX - r.left) / r.width });
    });
    this.dom.append(play, track, time);
    post(MediaAction.Probe);
  }
  stopEvent() { return true; }
  ignoreMutation() { return true; }
  destroy() { window.removeEventListener(MEDIA_STATUS_EVENT, this.onStatus); }
}

/**
 * Where a picture's path in a note (`attachments/x.jpg`) points. The phone's page resolves it
 * against the notes folder by itself; the desktop app maps it to the file in the folder.
 */
export const mediaSrc = { resolve: (src: string) => src };

/**
 * Where a picture that didn't load can come from: on the phone the app fetches one iCloud hasn't
 * brought down yet and hands it back as a data URL (`index.ts`). Nothing comes elsewhere.
 */
export const mediaFetch = { from: (_src: string): Promise<string | null> => Promise.resolve(null) };

let asks = 0;
/** Sends the app a request and resolves with its answer (`MediaAction.Reply`), or null after `ms`. */
export function askApp(type: MediaAction, payload: object, ms: number) {
  const id = ++asks;
  return new Promise<string | null>((resolve) => {
    replies.set(id, resolve);
    sendMessage({ type, payload: { id, ...payload } } as never);
    setTimeout(() => { if (replies.delete(id)) resolve(null); }, ms);
  });
}

/** A picture; a broken link says which file is missing instead of showing nothing, until it turns up. */
class ImageView implements NodeView {
  dom: HTMLElement;
  constructor(node: PMNode) {
    const src = String(node.attrs.src);
    this.dom = document.createElement('div');
    this.dom.className = 'vb-image';
    const img = document.createElement('img');
    img.src = mediaSrc.resolve(src);
    img.alt = node.attrs.alt ?? '';
    img.draggable = false;
    img.decoding = 'async';
    let asked = false;
    img.addEventListener('error', () => {
      this.dom.classList.add('vb-missing');
      this.dom.textContent = `Missing image: ${src.split('/').pop()}`;
      if (asked) return;
      asked = true;
      void mediaFetch.from(src).then((url) => {
        if (!url) return;
        this.dom.classList.remove('vb-missing');
        this.dom.textContent = '';
        img.src = url;
        this.dom.appendChild(img);
      });
    });
    this.dom.appendChild(img);
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  ignoreMutation() { return true; }
}

/** Draws image nodes as pictures or, for sound files, as a small audio player. */
export const MediaViews = Extension.create({
  name: 'vbMediaViews',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('vbMediaViews'),
        props: {
          nodeViews: {
            image: (node: PMNode, _view: EditorView) => (isAudio(node.attrs.src) ? new AudioView(node) : new ImageView(node)),
          },
        },
      }),
    ];
  },
});
