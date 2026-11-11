import { Extension, InputRule, type AnyExtension, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CALLOUT_HEAD, calloutOf, type CalloutType } from '../src/editor/noteSyntax';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callouts: {
      /**
       * The quote (or the lines) the selection is in becomes a callout of
       * this type; the same type again takes the callout away, lines and all.
       */
      toggleCallout: (type?: CalloutType) => ReturnType;
      /** Leaves a plain quote. */
      unsetCallout: () => ReturnType;
    };
  }
}

// The quote's other lines: each starts with `>`.
const LINE = /^ {0,3}>[^\n]*(?:\n|$)/;

type Lexer = { blockTokens: (src: string) => unknown[] };

/**
 * The quote node reading and writing callouts: `> [!TIP] Title` then the quote's lines. The type
 * and title are attributes; the rest is an ordinary quote, so everything a quote holds still works.
 */
export function calloutQuote(extension: AnyExtension) {
  return extension.extend({
    addAttributes(this: { parent?: () => Record<string, unknown> }) {
      return {
        ...this.parent?.(),
        callout: {
          default: null,
          parseHTML: (el: HTMLElement) => calloutOf(el.getAttribute('data-callout'))?.type ?? null,
          renderHTML: (attrs: { callout?: unknown }) => {
            const c = calloutOf(attrs.callout);
            return c ? { 'data-callout': c.type, class: 'vb-callout' } : {};
          },
        },
        title: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-title') || null,
          renderHTML: (attrs: { title?: unknown }) => (attrs.title ? { 'data-title': String(attrs.title) } : {}),
        },
      };
    },
    markdownTokenizer: {
      name: 'callout',
      level: 'block',
      start: (src: string) => src.search(/^ {0,3}>[ \t]?\[!/m),
      tokenize: (src: string, _tokens: unknown, lexer: Lexer) => {
        const head = CALLOUT_HEAD.exec(src);
        if (!head) return undefined;
        let raw = head[0];
        let rest = src.slice(raw.length);
        if (rest.startsWith('\n')) { raw += '\n'; rest = rest.slice(1); }
        const lines: string[] = [];
        for (let m = LINE.exec(rest); m; m = LINE.exec(rest)) {
          lines.push(m[0].replace(/^ {0,3}>[ \t]?/, ''));
          raw += m[0];
          rest = rest.slice(m[0].length);
        }
        return {
          type: 'blockquote', raw, callout: head[1].toLowerCase(), title: head[2].trim() || null,
          tokens: lexer.blockTokens(lines.join('')),
        };
      },
    },
    parseMarkdown: (token: any, h: any) => {
      const parse = h.parseBlockChildren ?? h.parseChildren;
      const content = parse(token.tokens || []);
      if (!token.callout) return h.createNode('blockquote', undefined, content);
      return h.createNode('blockquote', { callout: token.callout, title: token.title }, content.length ? content : [{ type: 'paragraph' }]);
    },
    renderMarkdown(this: { parent?: (...a: unknown[]) => string }, node: any, h: any, ctx: unknown) {
      const body = this.parent?.(node, h, ctx) ?? '';
      const c = calloutOf(node.attrs?.callout);
      if (!c) return body;
      const head = `> [!${c.type.toUpperCase()}]${node.attrs?.title ? ` ${node.attrs.title}` : ''}`;
      return body.trim() && body.trim() !== '>' ? `${head}\n${body}` : head;
    },
  } as never);
}

/** The innermost quote the selection is in. */
function quoteAt(state: EditorState) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'blockquote') return { pos: $from.before(d), node };
  }
  return null;
}

/** Takes a quote away, leaving its blocks where it was. */
function unwrap(tr: CommandProps['tr'], pos: number, node: PMNode) {
  const range = tr.doc.resolve(pos + 1).blockRange(tr.doc.resolve(pos + node.nodeSize - 1));
  const target = range && liftTarget(range);
  if (range && target !== null && target !== undefined) tr.lift(range, target);
}

const SVG = 'http://www.w3.org/2000/svg';

function head(type: string, title: string | null) {
  const c = calloutOf(type)!;
  const el = document.createElement('div');
  el.className = 'vb-callout-head';
  el.contentEditable = 'false';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', c.icon);
  svg.appendChild(path);
  const label = document.createElement('span');
  label.textContent = title || c.label;
  el.append(svg, label);
  return el;
}

function heads(doc: PMNode) {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return !node.isTextblock;
    const { callout, title } = node.attrs as { callout: string | null; title: string | null };
    if (calloutOf(callout)) {
      out.push(Decoration.widget(pos + 1, () => head(callout!, title), {
        side: -1, key: `callout-${callout}-${title ?? ''}`, ignoreSelection: true, stopEvent: () => true,
      }));
    }
    return true;
  });
  return DecorationSet.create(doc, out);
}

const key = new PluginKey<DecorationSet>('vbCallouts');

/**
 * Callouts: the quote tinted in its type's colour with the icon and the type's
 * name (or the title) on top. Typing `[!NOTE] ` (or TIP, IMPORTANT, WARNING, CAUTION) at the start
 * of a quote makes it one; Backspace at its start leaves a plain quote.
 */
export const Callouts = Extension.create({
  name: 'vbCallouts',
  priority: 1000,
  addCommands() {
    return {
      toggleCallout: (type: CalloutType = 'note') => ({ state, tr, dispatch, commands }: CommandProps) => {
        const quote = quoteAt(state);
        if (!quote) return commands.wrapIn('blockquote', { callout: type });
        if (!dispatch) return true;
        if (quote.node.attrs.callout === type) unwrap(tr, quote.pos, quote.node);
        else tr.setNodeMarkup(quote.pos, undefined, { ...quote.node.attrs, callout: type });
        return true;
      },
      unsetCallout: () => ({ state, tr, dispatch }: CommandProps) => {
        const quote = quoteAt(state);
        if (!quote?.node.attrs.callout) return false;
        if (dispatch) tr.setNodeMarkup(quote.pos, undefined, { ...quote.node.attrs, callout: null, title: null });
        return true;
      },
    } as never;
  },
  addKeyboardShortcuts() {
    return {
      // At the very start of a callout's first line: the callout goes, the quote stays.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset > 0 || $from.depth < 2) return false;
        const quote = $from.node($from.depth - 1);
        if (quote.type.name !== 'blockquote' || !quote.attrs.callout || $from.index($from.depth - 1) > 0) return false;
        return editor.commands.unsetCallout();
      },
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\[!(note|tip|important|warning|caution)\]\s$/i,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          const depth = $from.depth - 1;
          if (depth < 1 || $from.node(depth).type.name !== 'blockquote' || $from.index(depth) > 0) return null;
          const quote = $from.node(depth);
          state.tr.delete(range.from, range.to).setNodeMarkup($from.before(depth), undefined, { ...quote.attrs, callout: match[1].toLowerCase() });
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, { doc }) => heads(doc),
          apply: (tr, old) => (tr.docChanged ? heads(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});
