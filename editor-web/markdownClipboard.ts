import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode, type ResolvedPos, type Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { fromTerminal } from './terminalText';

/** The selection as markdown: inside one item, quote or cell just what is selected, and part of one line without its heading marks or code fence. */
function markdownOf(editor: Editor, slice: Slice) {
  const top = editor.schema.topNodeType;
  let content = slice.content;
  let open = Math.min(slice.openStart, slice.openEnd);
  for (let c = content, o = open; o > 0 && c.childCount === 1 && !c.firstChild!.isTextblock;) {
    c = c.firstChild!.content;
    o--;
    if (top.validContent(c)) { content = c; open = o; }
  }
  const line = content.childCount === 1 && content.firstChild!.isTextblock && open > 0 ? content.firstChild! : null;
  if (line?.type.spec.code) return line.textContent;
  // Nodes made from the editor's own schema: the desktop page holds a second copy of prosemirror-model.
  const doc = top.create(null, line ? editor.schema.nodes.paragraph.create(null, line.content) : content);
  return editor.markdown?.serialize(doc.toJSON()) ?? '';
}

/**
 * A table pasted into a table goes in cell by cell from the caret's cell (prosemirror-tables adds
 * the rows and columns it needs). Copied whole, it brings its heading row along: when that row says
 * what the table's own heading says over the same columns, it is left out, so the rows are added
 * under the heading there is. Gives the pasted table without that row, or null.
 */
function withoutSameHeading(doc: PMNode, $context: ResolvedPos) {
  const pasted = doc.childCount === 1 && doc.firstChild!.type.name === 'table' ? doc.firstChild! : null;
  if (!pasted || pasted.childCount < 2) return null;
  for (let d = $context.depth; d > 1; d--) {
    if ($context.node(d - 1).type.name !== 'tableRow' || $context.node(d - 2).type.name !== 'table') continue;
    const heading = $context.node(d - 2).firstChild!;
    const from = $context.index(d - 1);
    const first = pasted.firstChild!;
    const text = (n: PMNode) => n.textContent.trim().toLowerCase();
    for (let i = 0; i < first.childCount; i++) {
      if (from + i >= heading.childCount || text(first.child(i)) !== text(heading.child(from + i))) return null;
    }
    const rows: PMNode[] = [];
    pasted.forEach((row, _, i) => { if (i > 0) rows.push(row); });
    return pasted.copy(Fragment.from(rows));
  }
  return null;
}

function copy(editor: Editor, view: EditorView, e: ClipboardEvent, cut: boolean) {
  const { selection } = view.state;
  if (selection.empty || !e.clipboardData) return false;
  e.preventDefault();
  e.clipboardData.clearData();
  e.clipboardData.setData('text/plain', markdownOf(editor, selection.content()));
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  return true;
}

/**
 * Copy and paste as markdown, as Bear does. A copy puts the selection's markdown on the clipboard
 * as plain text only: with ProseMirror's HTML beside it, Bear and other Mac apps took the HTML, and
 * each list item came in as a typed "•" before its text. Plain text pasted here is read as
 * markdown, so `- item` lines and `## headings` arrive formatted; text copied out of a terminal is
 * made markdown again first (`fromTerminal`). Paste and Match Style (⇧) and a paste into code keep
 * the text as it is.
 */
export const MarkdownClipboard = Extension.create({
  name: 'vbMarkdownClipboard',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('vbMarkdownClipboard'),
        props: {
          handleDOMEvents: {
            copy: (view, e) => copy(editor, view, e, false),
            cut: (view, e) => copy(editor, view, e, true),
          },
          clipboardTextParser: (text, $context, plain) => {
            if (plain || $context.parent.type.spec.code || !editor.markdown) return null as unknown as Slice;
            const doc = editor.schema.nodeFromJSON(editor.markdown.parse(fromTerminal(text.replace(/\r\n?/g, '\n'))));
            const rows = withoutSameHeading(doc, $context);
            if (rows) return doc.copy(Fragment.from(rows)).slice(0, rows.nodeSize);
            return doc.slice(0, doc.content.size);
          },
        },
      }),
    ];
  },
});
