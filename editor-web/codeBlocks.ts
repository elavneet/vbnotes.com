import { CodeBlock } from '@tiptap/extension-code-block';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type NodeView } from '@tiptap/pm/view';
import { highlightCode } from '../src/editor/highlight';

/** Colours code by language (see `src/editor/highlight.ts`); blocks without a known language stay plain. */
function colour(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const runs = highlightCode(node.textContent, node.attrs.language);
    let at = pos + 1;
    for (const r of runs ?? []) {
      if (r.role) decos.push(Decoration.inline(at, at + r.text.length, { class: `vb-syn-${r.role}` }));
      at += r.text.length;
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

// Diagrams: a ```mermaid block shows its drawing, and its code only while the caret is inside it
// (Edit puts it there). Mermaid is fetched once from jsDelivr (pinned, checked against its hash),
// then lives in the WebView's cache; 11.4.1 cut long subgraph titles short. Offline, or with code
// that doesn't parse, the block stays plain code.
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js';
const MERMAID_SRI = 'sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2';
type Mermaid = { initialize: (o: object) => void; render: (id: string, code: string) => Promise<{ svg: string }> };
let mermaidLoad: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  const w = window as unknown as { mermaid?: Mermaid };
  if (w.mermaid) return Promise.resolve(w.mermaid);
  mermaidLoad ??= new Promise<Mermaid>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MERMAID_URL;
    s.integrity = MERMAID_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      if (!w.mermaid) return reject(new Error('mermaid did not load'));
      const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
      w.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: dark ? 'dark' : 'default',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      });
      resolve(w.mermaid);
    };
    s.onerror = () => {
      mermaidLoad = null; // offline now; the next diagram tries again
      reject(new Error('mermaid did not load'));
    };
    document.head.appendChild(s);
  });
  return mermaidLoad;
}

/** Pinch to zoom a drawing (up to 5x), double-tap for 2.5x and back; zoomed, the box scrolls both ways. */
function zoomable(box: HTMLElement, art: HTMLElement) {
  let scale = 1;
  let startDist = 0;
  let startScale = 1;
  let lastTap = 0;
  const apply = () => {
    const svg = art.querySelector('svg');
    if (!svg) return;
    if (scale <= 1.01) {
      scale = 1;
      svg.style.width = '';
      svg.style.maxWidth = '';
      box.classList.remove('zoomed');
      return;
    }
    const natural = svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width;
    svg.style.maxWidth = 'none';
    svg.style.width = `${Math.round(Math.min(natural, box.clientWidth - 24) * scale)}px`;
    box.classList.add('zoomed');
  };
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  box.addEventListener('redrawn', () => { scale = 1; apply(); });
  box.addEventListener('touchstart', (e) => {
    if ((e.target as Element).closest?.('button')) return;
    if (e.touches.length === 2) {
      startDist = dist(e.touches);
      startScale = scale;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap < 300) { scale = scale > 1 ? 1 : 2.5; apply(); e.preventDefault(); }
      lastTap = now;
    }
  }, { passive: false });
  box.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !startDist) return;
    scale = Math.min(5, Math.max(1, (startScale * dist(e.touches)) / startDist));
    apply();
    e.preventDefault();
  }, { passive: false });
  box.addEventListener('touchend', () => { startDist = 0; });
}

let diagramSeq = 0;

class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private fig: HTMLElement;
  private art: HTMLElement;
  private node: PMNode;
  private drawn: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(node: PMNode, private getPos: () => number | undefined, private editor: Editor) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'vb-cb';
    const pre = document.createElement('pre');
    this.contentDOM = document.createElement('code');
    pre.appendChild(this.contentDOM);
    this.fig = document.createElement('div');
    this.fig.className = 'vb-diagram';
    this.fig.contentEditable = 'false';
    this.art = document.createElement('div');
    this.art.className = 'vb-art';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'vb-edit';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      const pos = this.getPos();
      if (this.editor.isEditable && typeof pos === 'number') {
        this.editor.chain().focus().setTextSelection(pos + this.node.nodeSize - 1).run();
      }
    });
    this.fig.append(this.art, edit);
    this.dom.append(pre, this.fig);
    zoomable(this.fig, this.art);
    this.update(node, []);
  }

  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const lang = node.attrs.language as string | null;
    this.contentDOM.className = lang ? `language-${lang}` : '';
    this.dom.classList.toggle('vb-cb-active', decorations.some((d) => (d as unknown as { spec: { cursorInside?: boolean } }).spec?.cursorInside));
    if (lang === 'mermaid') this.draw(node.textContent); else this.clear();
    return true;
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.drawn = null;
    this.art.innerHTML = '';
    this.dom.classList.remove('vb-has-diagram');
  }

  private draw(code: string) {
    if (code === this.drawn) return;
    if (this.timer) clearTimeout(this.timer);
    // Typing inside the block redraws after a short pause, not on every key.
    this.timer = setTimeout(() => {
      this.timer = null;
      loadMermaid()
        .then((m) => m.render(`vb-diagram-${++diagramSeq}`, code))
        .then(({ svg }) => {
          if (this.node.textContent !== code) return; // changed again while drawing
          this.drawn = code;
          this.art.innerHTML = svg;
          this.fig.dispatchEvent(new Event('redrawn'));
          this.dom.classList.add('vb-has-diagram');
        })
        .catch(() => {
          if (this.node.textContent !== code) return;
          this.drawn = code;
          this.art.innerHTML = '';
          this.dom.classList.remove('vb-has-diagram');
        });
    }, this.drawn === null ? 0 : 400);
  }

  stopEvent(e: Event) {
    return this.fig.contains(e.target as Node);
  }

  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }) {
    return m.type !== 'selection' && !this.contentDOM.contains(m.target);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
  }
}

const colourKey = new PluginKey<DecorationSet>('vbCodeColour');

/** Code blocks with syntax colours, and ```mermaid blocks drawn as diagrams. */
export const RichCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => new CodeBlockView(node, getPos as () => number | undefined, editor);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: colourKey,
        state: {
          init: (_, { doc }) => colour(doc),
          apply: (tr, old) => (tr.docChanged ? colour(tr.doc) : old),
        },
        props: { decorations: (state) => colourKey.getState(state) },
      }),
      // Marks the code block holding the caret, so a diagram's code shows while it is edited.
      new Plugin({
        key: new PluginKey('vbCaretInCode'),
        props: {
          decorations(state) {
            if (!editor.isEditable) return null;
            const { $from } = state.selection;
            for (let d = $from.depth; d > 0; d--) {
              const n = $from.node(d);
              if (n.type.name !== 'codeBlock') continue;
              const start = $from.before(d);
              return DecorationSet.create(state.doc, [Decoration.node(start, start + n.nodeSize, {}, { cursorInside: true })]);
            }
            return null;
          },
        },
      }),
    ];
  },
});
