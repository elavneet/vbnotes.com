import { Extension, combineTransactionSteps, getChangedRanges, getMarkRange, type AnyExtension } from '@tiptap/core';
import type { Node as PMNode, MarkType } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { sendMessage, type BridgeExtension } from '@10play/tentap-editor';
import { LinkAction } from '../src/editor/linkBridge';
import { hrefForText, isBareLink, linkLabel, looksLikeAddress, openableUrl } from '../src/utils/links';

const ICON_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

const open = (url: string) => sendMessage({ type: LinkAction.Open, payload: { url } } as never);

/**
 * Tentap's link bridge, writing a bare address back as plain text: `https://x.com` stays
 * `https://x.com` in the file instead of becoming `[https://x.com](https://x.com)` on the next save.
 */
export function withPlainLinks(bridges: BridgeExtension[]): BridgeExtension[] {
  return bridges.map((bridge) => {
    if (bridge.name !== 'link' || !bridge.tiptapExtension) return bridge;
    const plain = bridge.clone();
    plain.tiptapExtension = (bridge.tiptapExtension as AnyExtension).extend({
      renderMarkdown(this: { parent?: (...args: unknown[]) => string }, node: any, h: any, ctx: any) {
        const text = ctx?.meta?.markText;
        if (typeof text === 'string' && isBareLink(text, node.attrs?.href ?? '')) return h.renderChildren(node);
        return this.parent?.(node, h, ctx) ?? '';
      },
    } as never);
    return plain;
  });
}

function linkMark(doc: PMNode, pos: number, type: MarkType) {
  return doc.nodeAt(pos)?.marks.find((m) => m.type === type);
}

/** The openable link the caret sits in (or right after). */
function linkAtCaret(state: EditorState) {
  const type = state.schema.marks.link;
  if (!type || !state.selection.empty) return null;
  const range = getMarkRange(state.selection.$from, type);
  const url = range ? openableUrl(linkMark(state.doc, range.from, type)?.attrs.href) : null;
  return url ? { url } : null;
}

/** While editing, a link under the caret gets a small "Open" button below its line. */
class LinkChip {
  private el: HTMLButtonElement;
  private url = '';
  private onFocusChange: () => void;

  constructor(private view: EditorView) {
    const el = (this.el = document.createElement('button'));
    el.type = 'button';
    el.className = 'vb-link-chip';
    el.hidden = true;
    // The chip must never take the caret (or the keyboard) away from the text.
    const keep = (e: Event) => e.preventDefault();
    el.addEventListener('mousedown', keep);
    el.addEventListener('touchstart', keep, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); this.fire(); });
    el.addEventListener('click', () => this.fire());
    // Focus changes are not transactions; look again once the focus has settled.
    this.onFocusChange = () => requestAnimationFrame(() => this.update(this.view));
    view.dom.addEventListener('focus', this.onFocusChange);
    view.dom.addEventListener('blur', this.onFocusChange);
  }

  private fire() {
    if (this.url) open(this.url);
  }

  update(view: EditorView) {
    this.view = view;
    const host = view.dom.parentElement;
    const link = host && view.hasFocus() ? linkAtCaret(view.state) : null;
    if (!host || !link) { this.el.hidden = true; return; }
    // The editor is moved into its page container after the view is made, so attach late.
    if (this.el.parentElement !== host) host.appendChild(this.el);
    if (link.url !== this.url || this.el.hidden) {
      this.url = link.url;
      this.el.innerHTML = ICON_OPEN;
      const label = document.createElement('span');
      label.textContent = `Open ${linkLabel(link.url)}`;
      this.el.appendChild(label);
      this.el.setAttribute('aria-label', `Open ${link.url}`);
    }
    this.el.hidden = false;
    const box = host.getBoundingClientRect();
    const caret = view.coordsAtPos(view.state.selection.head);
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    // Below the line, or above it when the line is near the bottom of the visible page.
    let top = caret.bottom + 8;
    if (top + h > window.innerHeight - 8) top = caret.top - h - 8;
    const left = Math.max(12, Math.min(caret.left - box.left - 18, box.width - w - 12));
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top - box.top + host.scrollTop)}px)`;
  }

  destroy() {
    this.view.dom.removeEventListener('focus', this.onFocusChange);
    this.view.dom.removeEventListener('blur', this.onFocusChange);
    this.el.remove();
  }
}

/**
 * A bare address that is edited keeps pointing where its text says (or stops being a link once
 * it is no longer an address). Links written as `[text](url)` are left alone.
 */
function followEditedAddresses(oldState: EditorState, newState: EditorState, transform: ReturnType<typeof combineTransactionSteps>) {
  const type = newState.schema.marks.link;
  const { doc } = newState;
  const back = transform.mapping.invert();
  const tr = newState.tr;
  const seen = new Set<number>();
  for (const { newRange } of getChangedRanges(transform)) {
    doc.nodesBetween(Math.max(0, newRange.from - 1), Math.min(doc.content.size, newRange.to + 1), (node, pos) => {
      if (!node.isText) return;
      const mark = type.isInSet(node.marks);
      const range = mark && getMarkRange(doc.resolve(pos), type, mark.attrs);
      if (!mark || !range || seen.has(range.from)) return;
      seen.add(range.from);
      const text = doc.textBetween(range.from, range.to);
      const href = String(mark.attrs.href ?? '');
      // Trailing spaces are the autolink plugin's to unlink first.
      if (isBareLink(text, href) || text !== text.trim()) return;
      const from = back.map(range.from, -1);
      const to = back.map(range.to, 1);
      const before = from < to && to <= oldState.doc.content.size ? oldState.doc.textBetween(from, to) : '';
      if (!isBareLink(before, href)) return;
      if (looksLikeAddress(text)) tr.addMark(range.from, range.to, type.create({ ...mark.attrs, href: hrefForText(text) }));
      else tr.removeMark(range.from, range.to, type);
    });
  }
  return tr.steps.length ? tr : null;
}

/**
 * Links that open and stay editable. With the keyboard down, a tap on a link opens it in the
 * browser; while typing, a tap puts the caret in it (to edit) and shows an "Open" button.
 */
export const LinkTaps = Extension.create({
  name: 'vbLinkTaps',
  addProseMirrorPlugins() {
    let tap: { x: number; y: number; at: number; focused: boolean; moved: boolean } | null = null;
    return [
      new Plugin({
        key: new PluginKey('vbLinkTaps'),
        view: (view) => new LinkChip(view),
        appendTransaction: (trs, oldState, newState) => {
          if (!newState.schema.marks.link || !trs.some((t) => t.docChanged) || oldState.doc.eq(newState.doc)) return null;
          return followEditedAddresses(oldState, newState, combineTransactionSteps(oldState.doc, [...trs]));
        },
        props: {
          handleDOMEvents: {
            touchstart: (view, e) => {
              const t = e.touches[0];
              tap = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: Date.now(), focused: view.hasFocus(), moved: false } : null;
              return false;
            },
            touchmove: (_view, e) => {
              const t = e.touches[0];
              if (tap && t && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > 10) tap.moved = true;
              return false;
            },
            touchend: (view, e) => {
              const t = tap;
              tap = null;
              // A long press is for selecting text, not opening.
              if (!t || t.moved || Date.now() - t.at > 450 || (t.focused && view.editable)) return false;
              const target = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement;
              const a = target?.closest('a[href]');
              const url = a && view.dom.contains(a) ? openableUrl(a.getAttribute('href')) : null;
              if (!url) return false;
              // No focus, no caret, no keyboard: just open it.
              e.preventDefault();
              open(url);
              return true;
            },
          },
        },
      }),
    ];
  },
});
