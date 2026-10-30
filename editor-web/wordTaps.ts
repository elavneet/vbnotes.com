import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const WORD = /[\p{L}\p{N}\p{M}_]/u;
/** 0 for space (or nothing), 1 for word characters, 2 for punctuation and symbols. */
const kind = (ch: string | undefined) => (!ch || /\s/.test(ch) ? 0 : WORD.test(ch) ? 1 : 2);

/** The character under the finger and the run of its kind around it, as UITextView picks it. */
function tapAt(view: EditorView, x: number, y: number) {
  const hit = view.posAtCoords({ left: x, top: y });
  const $pos = hit && view.state.doc.resolve(hit.pos);
  if (!hit || !$pos?.parent.isTextblock) return null;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '￼');
  const at = $pos.parentOffset;
  // The nearest caret spot is between two characters; the finger is on one side of it.
  let i = x >= view.coordsAtPos(hit.pos).left ? at : at - 1;
  if (!kind(text[i])) i = i === at ? at - 1 : at;
  const k = kind(text[i]);
  if (!k) return { pos: hit.pos, char: hit.pos, run: null };
  let from = i;
  let to = i + 1;
  while (from > 0 && kind(text[from - 1]) === k) from--;
  while (to < text.length && kind(text[to]) === k) to++;
  const start = $pos.start();
  return { pos: hit.pos, char: start + i, run: { from: start + from, to: start + to } };
}

/**
 * Double tap selects what is under the finger. WebKit, given punctuation or a line start
 * (`//`, `-`), walks back to the previous word instead, even across lines. Its own pick is
 * kept when it covers the tapped character within one line; otherwise the run of that
 * character's kind is selected (or just the caret, on blank space).
 */
export const WordTaps = Extension.create({
  name: 'vbWordTaps',
  addProseMirrorPlugins() {
    let start: { x: number; y: number } | null = null;
    let last = { at: 0, x: 0, y: 0 };
    let tap: { x: number; y: number; until: number } | null = null;
    const check = (view: EditorView) => {
      if (!tap || Date.now() > tap.until) { tap = null; return; }
      const { selection: sel, doc } = view.state;
      if (sel.empty) return;
      const t = tapAt(view, tap.x, tap.y);
      if (!t) return;
      if (sel.$from.sameParent(sel.$to) && sel.from <= t.char && sel.to > t.char) return;
      const next = t.run ? TextSelection.create(doc, t.run.from, t.run.to) : TextSelection.create(doc, t.pos);
      if (!next.eq(sel)) view.dispatch(view.state.tr.setSelection(next));
    };
    return [
      new Plugin({
        key: new PluginKey('vbWordTaps'),
        // WebKit's selection can land before or after the touch ends; look at every change for a moment.
        view: () => ({ update: check }),
        props: {
          handleDOMEvents: {
            touchstart: (_view, e) => {
              const t = e.touches[0];
              start = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
              return false;
            },
            touchend: (view, e) => {
              const t = e.changedTouches[0];
              const s = start;
              start = null;
              if (!t || !s || Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) return false;
              const now = Date.now();
              const double = now - last.at < 400 && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 30;
              last = double ? { at: 0, x: 0, y: 0 } : { at: now, x: t.clientX, y: t.clientY };
              if (double) {
                tap = { x: t.clientX, y: t.clientY, until: now + 600 };
                setTimeout(() => check(view), 60);
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
