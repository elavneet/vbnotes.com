import { Extension, getMarkRange, type CommandProps, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import type {} from '@tiptap/extension-list';
import type {} from '@tiptap/extension-table';
import type {} from '@tiptap/extension-highlight';
import type {} from '@tiptap/extension-heading';
import type {} from '@tiptap/extension-blockquote';
import type {} from '@tiptap/extension-code';
import type {} from '@tiptap/extension-code-block';
import type {} from '@tiptap/extension-horizontal-rule';
import type {} from '@tiptap/extension-strike';
import { highlightColor } from '../src/editor/noteSyntax';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const WORD = /[\p{L}\p{N}\p{M}_]/u;
const LISTS = ['bulletList', 'orderedList', 'taskList'];
const ITEMS = ['listItem', 'taskItem'];

/** Pairs: typed over a selection, the opening one wraps it. */
const PAIRS: Record<string, string> = {
  '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '“': '”', '‘': '’',
  '（': '）', '【': '】', '〖': '〗', '「': '」', '『': '』', '〈': '〉', '《': '》', '〔': '〕',
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    editingCommands: {
      /** Moves the line (or list item) the selection is on above the one before it, or below the one after. */
      moveBlock: (dir: -1 | 1) => ReturnType;
      /** Ticks or unticks each todo the selection touches. */
      toggleTodos: () => ReturnType;
    };
  }
}

/** The word the caret sits strictly inside of, as document positions. */
function wordAt(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.spec.code) return null;
  const chars: string[] = [];
  $from.parent.forEach((child, offset) => {
    if (child.isText) for (let i = 0; i < child.text!.length; i++) chars[offset + i] = child.text![i];
    else chars[offset] = '￼';
  });
  const at = $from.parentOffset;
  let start = at;
  let end = at;
  while (start > 0 && WORD.test(chars[start - 1] ?? '')) start--;
  while (end < chars.length && WORD.test(chars[end] ?? '')) end++;
  return start < at && at < end ? { from: $from.start() + start, to: $from.start() + end } : null;
}

/**
 * A style key with nothing selected: inside a
 * styled run it takes the style off the whole run, inside a word it styles the word, and anywhere
 * else the next letters typed take it. With a selection it toggles the style on the selection.
 */
export const toggleWordMark = (name: string, attrs?: Record<string, unknown>) => ({ state, tr, dispatch, commands }: CommandProps) => {
  const type = state.schema.marks[name];
  if (!type) return false;
  const { empty, $from } = state.selection;
  if (!empty || $from.parent.type.spec.code) return commands.toggleMark(name, attrs);
  const pos = $from.pos;
  const run = getMarkRange($from, type);
  if (run && run.from < pos && pos < run.to) {
    // A highlight in another colour takes the new colour instead.
    const mark = $from.marks().find((m) => m.type === type);
    const other = !!attrs && !!mark && !mark.eq(type.create(attrs));
    if (dispatch) {
      tr.removeMark(run.from, run.to, type).removeStoredMark(type);
      if (other) tr.addMark(run.from, run.to, type.create(attrs));
    }
    return true;
  }
  const word = wordAt(state);
  if (word) {
    if (dispatch) tr.addMark(word.from, word.to, type.create(attrs));
    return true;
  }
  return commands.toggleMark(name, attrs);
};

/** The list item the caret is in, with its list. */
function listItemAt(state: EditorState) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if (ITEMS.includes($from.node(d).type.name)) return $from.node(d).type.name;
  return null;
}

/** ⌥⌘↑/↓: list items move among their list, other lines among theirs. */
const moveBlock = (dir: -1 | 1) => ({ state, tr, dispatch }: CommandProps) => {
  const { $from, $to, from, to } = state.selection;
  const range = $from.blockRange($to, (n) => LISTS.includes(n.type.name)) ?? $from.blockRange($to);
  if (!range) return false;
  const { parent, startIndex, endIndex, start, end } = range;
  if (dir < 0 ? startIndex === 0 : endIndex >= parent.childCount) return false;
  if (!dispatch) return true;
  const content = state.doc.slice(start, end).content;
  const other = parent.child(dir < 0 ? startIndex - 1 : endIndex).nodeSize;
  const shift = dir * other;
  tr.delete(start, end).insert(start + shift, content);
  tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift)).scrollIntoView();
  return true;
};

/** ⌘.: each todo whose line the selection touches flips; other lines stay. */
const toggleTodos = () => ({ state, tr, dispatch }: CommandProps) => {
  const { from, to } = state.selection;
  const items: [number, PMNode][] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'taskItem' || !node.firstChild) return;
    // Its own line, not a sub item under it.
    const lineFrom = pos + 1;
    const lineTo = lineFrom + node.firstChild.nodeSize;
    if (lineFrom <= to && from <= lineTo) items.push([pos, node]);
  });
  if (!items.length) return false;
  if (dispatch) items.forEach(([pos, node]) => tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
  return true;
};

const two = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const isoTime = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const fmt = (o: Intl.DateTimeFormatOptions) => (d: Date) => new Intl.DateTimeFormat(undefined, o).format(d);

/** The current date keys; with ⌥ the ISO 8601 form. */
const DATES: Record<string, (d: Date) => string> = {
  'Shift-Mod-8': fmt({ dateStyle: 'long' }),
  'Shift-Alt-Mod-8': isoDate,
  'Shift-Mod-9': fmt({ dateStyle: 'short' }),
  'Shift-Alt-Mod-9': isoDate,
  'Shift-Mod-7': fmt({ dateStyle: 'long', timeStyle: 'short' }),
  'Shift-Alt-Mod-7': (d) => `${isoDate(d)}T${isoTime(d)}`,
  'Shift-Mod-0': fmt({ timeStyle: 'short' }),
  'Shift-Alt-Mod-0': isoTime,
};

const insert = (editor: Editor, text: string) => editor.commands.command(({ tr }) => { tr.insertText(text).scrollIntoView(); return true; });

/**
 * The editing keys, ahead of the stock ones, since Tiptap gives ⇧⌘7/8/9 to lists, which here
 * insert dates.
 */
export const EditingKeys = Extension.create({
  name: 'vbEditingKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const e = this.editor;
    const item = () => listItemAt(e.state);
    const run = (f: () => unknown) => () => { f(); return true; };
    const keys: Record<string, () => boolean> = {
      // Format menu. ⌘B, ⌘I and ⌘U are the stock keys (running the commands below).
      'Shift-Mod-u': run(() => e.commands.toggleStrike()),
      'Shift-Mod-m': run(() => e.commands.toggleHighlight()),
      'Alt-Mod-c': run(() => e.commands.toggleCode()),
      'Mod-l': run(() => e.commands.toggleBulletList()),
      'Shift-Mod-l': run(() => e.commands.toggleOrderedList()),
      'Mod-t': run(() => e.commands.toggleTaskList()),
      'Shift-Mod-t': run(() => e.commands.toggleBlockquote()),
      'Alt-Mod-s': run(() => e.commands.setHorizontalRule()),
      'Alt-Mod-t': run(() => e.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })),
      'Alt-Mod-ArrowUp': () => e.commands.moveBlock(-1),
      'Alt-Mod-ArrowDown': () => e.commands.moveBlock(1),
      // Shift Right / Shift Left: a list item one level in or out.
      'Alt-Mod-ArrowRight': () => { const i = item(); return i ? (e.commands.sinkListItem(i), true) : false; },
      'Alt-Mod-ArrowLeft': () => { const i = item(); return i ? (e.commands.liftListItem(i), true) : false; },
      'Mod-.': run(() => e.commands.toggleTodos()),
      // Wiki link: the selection becomes [[selection]], or the caret goes between [[ and ]].
      'Mod-d': () => {
        const { empty, from, to, $from, $to } = e.state.selection;
        if (!$from.sameParent($to) || $from.parent.type.spec.code) return false;
        const text = empty ? '' : e.state.doc.textBetween(from, to);
        return e.chain().insertContentAt({ from, to }, `[[${text}]]`).setTextSelection(from + 2 + text.length).run();
      },
    };
    for (const level of [1, 2, 3, 4, 5, 6] as const) keys[`Mod-${level}`] = run(() => e.commands.toggleHeading({ level }));
    for (const [key, text] of Object.entries(DATES)) keys[key] = () => insert(e, text(new Date()));
    // ⌃⌘ is a Mac pair; elsewhere Mod is Ctrl, and Ctrl-arrows move by word.
    if (MAC) {
      Object.assign(keys, {
        'Ctrl-Mod-c': run(() => e.commands.toggleCodeBlock()),
        'Ctrl-Mod-ArrowDown': () => e.commands.addRowAfter(),
        'Ctrl-Mod-ArrowUp': () => e.commands.addRowBefore(),
        'Ctrl-Mod-ArrowRight': () => e.commands.addColumnAfter(),
        'Ctrl-Mod-ArrowLeft': () => e.commands.addColumnBefore(),
        'Ctrl-Mod-Backspace': () => e.commands.deleteRow(),
        'Shift-Ctrl-Mod-Backspace': () => e.commands.deleteColumn(),
      });
    }
    return keys;
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('vbWrapSelection'),
        props: {
          // An opening bracket or quote typed over a selection wraps it; a backtick makes it code.
          handleTextInput: (view, from, to, text) => {
            if (from === to || (text !== '`' && !PAIRS[text])) return false;
            const { $from, $to } = view.state.selection;
            if (!$from.sameParent($to) || $from.parent.type.spec.code || view.state.selection.from !== from || view.state.selection.to !== to) return false;
            if (text === '`') return editor.commands.toggleCode();
            const tr = view.state.tr.insertText(PAIRS[text], to).insertText(text, from);
            tr.setSelection(TextSelection.create(tr.doc, from + text.length, to + text.length));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * The style commands and the keys that come last. The commands replace the stock ones (this
 * extension runs after them), so the phone's format keyboard and the desktop's style bar act the
 * same way. Tab that nothing else took (a list item that cannot go deeper, plain text) stays in
 * the note instead of moving the focus out of it.
 */
export const EditingStyles = Extension.create({
  name: 'vbEditingStyles',
  priority: 1,
  addCommands() {
    return {
      toggleBold: () => toggleWordMark('bold'),
      toggleItalic: () => toggleWordMark('italic'),
      toggleUnderline: () => toggleWordMark('underline'),
      toggleStrike: () => toggleWordMark('strike'),
      // A colour by name (`green`…); none, or anything else, is the default highlighter.
      toggleHighlight: (attrs?: { color?: unknown }) => toggleWordMark('highlight', attrs ? { color: highlightColor(attrs.color) } : undefined),
      moveBlock,
      toggleTodos,
    } as never;
  },
  addKeyboardShortcuts() {
    const e = this.editor;
    return {
      Tab: () => {
        const { $from, empty } = e.state.selection;
        // Code takes a tab; plain text takes one inside a line (at its start it would make the line code).
        if ($from.parent.type.spec.code || (empty && $from.parentOffset > 0 && !listItemAt(e.state))) insert(e, '\t');
        return true;
      },
      'Shift-Tab': () => true,
    };
  },
});
