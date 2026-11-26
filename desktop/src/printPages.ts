import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { create } from 'zustand';
import { fileUrl } from './host';
import { NOTE_CSS, PAGE_MARGIN, PRINT_CSS, noteHtml } from './noteExport';

/**
 * Settings › Typography › Page breaks: faint lines over the note where its pages end when it is
 * printed or exported as a PDF. The note is laid out out of sight as the print lays it out (the
 * same HTML and styles, at the paper's width), cut into pages as WebKit cuts them, and each cut is
 * drawn at the same words in the editor.
 *
 * The rules here were measured on the Mac, against PDFs printed by the same web view the app
 * prints with, so the setting shows only there (`PAGES_SHOWN`).
 */

export type Paper = 'a4' | 'letter';
/** Paper sizes in points, as the print dialog has them. */
export const PAPERS: Record<Paper, { label: string; w: number; h: number }> = {
  a4: { label: 'A4', w: 595, h: 842 },
  letter: { label: 'US Letter', w: 612, h: 792 },
};

/** Where the page breaks can be shown: the Mac (see above). */
export const PAGES_SHOWN = /Mac/.test(navigator.platform);

const ON_KEY = 'vbnotes.pageBreaks';
const PAPER_KEY = 'vbnotes.paper';
const saved = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
// Letter where it is the everyday paper, A4 everywhere else.
const localPaper = (): Paper => (/-(US|CA|MX|PH|CL|CO)$/i.test(navigator.language) ? 'letter' : 'a4');

export const usePageBreaks = create<{ on: boolean; paper: Paper; set: (patch: { on?: boolean; paper?: Paper }) => void }>((set) => ({
  on: saved(ON_KEY) === '1',
  paper: saved(PAPER_KEY) === 'letter' ? 'letter' : saved(PAPER_KEY) === 'a4' ? 'a4' : localPaper(),
  set: (patch) => {
    if (patch.on !== undefined) save(ON_KEY, patch.on ? '1' : '0');
    if (patch.paper) save(PAPER_KEY, patch.paper);
    set(patch);
  },
}));

const PT_PER_MM = 72 / 25.4;
/**
 * The room for the note on one page, in the px the print lays it out in. WebKit lays a page out
 * 1.25 times as wide as its points (measured: 400 px printed 320 pt wide), breaks lines at a whole
 * number of px, and gives the page that width's share of the paper's height, a whole number too
 * (measured: 630 by 924 px on A4, 651 by 861 on Letter). A note with something wider than that,
 * a table of many columns, is laid out as wide as it needs, up to twice the points, and printed
 * smaller: `wide` is that width.
 */
export function pageBox(paper: Paper, wide = 0) {
  const { w, h } = PAPERS[paper];
  const points = w - 2 * PAGE_MARGIN.side * PT_PER_MM;
  const whole = Math.floor(Math.min(Math.max(points * 1.25, wide), points * 2));
  return { w: whole, h: Math.floor(whole * ((h - 2 * PAGE_MARGIN.top * PT_PER_MM) / points)) };
}

/**
 * One thing a page can't cut through: a line of text, a picture, a code block. `inset` is how far
 * under the top of its box (a code block, a table cell) the box's first line sits, `under` how far
 * the box goes on under its last line. A whole table is one piece with its rows in `table`.
 */
type Piece = { top: number; bottom: number; part: number; at: Text | Element; block: Element; y: number; h: number; inset: number; under: number; rowStart?: boolean; table?: Row[][] };
/** A table cell's lines, where each starts under the cell's top, and the cell's height. */
type Cell = { lines: Piece[]; height: number };
type Row = Cell[];

/** A page ends before letter number `skip` of the part (0: before the part); `row`: before a table row. */
export type Break = { part: number; skip: number; row: boolean };

// WebKit keeps a code block or a picture whole, but cuts a table row between its lines.
const SOLID = 'pre, img, svg, hr, input, .diagram';
const letters = (s: string) => s.replace(/\s+/g, '').length;

function piecesOf(box: HTMLElement, pageH: number): Piece[] {
  const origin = box.getBoundingClientRect().top;
  const range = document.createRange();
  const blocks = new Map<Element, { line: number; top: number; el: Element }>();
  /** The line height text in `el` gets, and the top of the block it is in. */
  const blockOf = (el: Element) => {
    let found = blocks.get(el);
    if (found) return found;
    // The tallest line height from the text up to its block (code in a code block has none of its own).
    let line = 0;
    let block: Element = el;
    for (let e: Element | null = el; e && e !== box; e = e.parentElement) {
      const style = getComputedStyle(e);
      line = Math.max(line, parseFloat(style.lineHeight) || 0);
      block = e;
      if (!style.display.startsWith('inline')) break;
    }
    blocks.set(el, found = { line, top: block.getBoundingClientRect().top - origin, el: block });
    return found;
  };
  let pieces: Piece[] = [];
  // The box whose first line is still to come, and its top.
  let boxTop: number | null = null;
  const add = (piece: Piece) => {
    if (boxTop !== null) piece.inset = Math.max(0, piece.top - boxTop);
    boxTop = null;
    pieces.push(piece);
  };
  const walk = (el: Element, part: number) => {
    for (const child of el.childNodes) {
      if (child instanceof Text) {
        if (!child.data.trim()) continue;
        range.selectNodeContents(child);
        const block = blockOf(el);
        for (const r of range.getClientRects()) {
          if (!r.height || !r.width) continue;
          // A line takes its line height, not just the height of its letters. Lines sit whole px
          // under their block's top; where the letters are drawn is only known to half a px.
          const height = Math.max(block.line, r.height);
          const top = block.top + Math.round(r.top - origin - (height - r.height) / 2 - block.top);
          const piece: Piece = { top, bottom: top + height, part, at: child, block: block.el, y: r.top, h: r.height, inset: 0, under: 0 };
          const last = pieces[pieces.length - 1];
          // More text on the line before's level is the same line.
          if (last && last.part === part && last.block === block.el && last.at instanceof Text && Math.min(last.bottom, piece.bottom) - Math.max(last.top, piece.top) > Math.min(last.bottom - last.top, piece.bottom - piece.top) / 2) {
            last.top = Math.min(last.top, piece.top);
            last.bottom = Math.max(last.bottom, piece.bottom);
          } else add(piece);
        }
      } else if (child instanceof Element) {
        const r = child.getBoundingClientRect();
        if (child.matches(SOLID) && r.height <= pageH) {
          if (r.height) add({ top: r.top - origin, bottom: r.bottom - origin, part, at: child, block: child, y: r.top, h: r.height, inset: 0, under: 0 });
        } else if (child instanceof HTMLTableElement) {
          const outer = pieces;
          const sections = new Map<Element | null, Row[]>();
          for (const tr of child.rows) {
            const boxes = [...tr.cells].map((td) => td.getBoundingClientRect());
            const row: Row = [...tr.cells].map((td, c) => {
              pieces = [];
              walk(td, part);
              for (const line of pieces) line.inset = line.top - (boxes[c].top - origin);
              return { lines: pieces, height: boxes[c].height };
            });
            // On screen every cell is as tall as its row; in print each is as tall as its own lines
            // need, with the room under the last line that the row's tallest cell has.
            const ends = row.map((cell, c) => (cell.lines.length ? boxes[c].bottom - origin - cell.lines[cell.lines.length - 1].bottom : Infinity));
            const room = Math.min(...ends);
            if (Number.isFinite(room)) row.forEach((cell, c) => { cell.height = Number.isFinite(ends[c]) ? boxes[c].height - (ends[c] - room) : 0; });
            const first = row.find((cell) => cell.lines.length)?.lines[0];
            if (first) first.rowStart = true;
            sections.set(tr.parentElement, [...(sections.get(tr.parentElement) ?? []), row]);
          }
          pieces = outer;
          boxTop = null;
          // The table's outer border is the 1 px line it shares with its cells. On screen half of it
          // goes above the rows and half under them; print puts all of it above (measured).
          const cellBox = (tr: HTMLTableRowElement | undefined) => tr?.cells[0]?.getBoundingClientRect();
          const border = Math.max(0, (cellBox(child.rows[0])?.top ?? r.top) - r.top) + Math.max(0, r.bottom - (cellBox(child.rows[child.rows.length - 1])?.bottom ?? r.bottom));
          pieces.push({ top: r.top - origin + border, bottom: r.bottom - origin, part, at: child, block: child, y: r.top, h: r.height, inset: border, under: 0, table: [...sections.values()] });
        } else {
          const boxed = child.matches('pre');
          const before = pieces.length;
          if (boxed) boxTop = r.top - origin;
          walk(child, part);
          if (boxed) {
            boxTop = null;
            if (pieces.length > before) pieces[pieces.length - 1].under = Math.max(0, r.bottom - origin - pieces[pieces.length - 1].bottom);
          }
        }
      }
    }
  };
  [...box.children].forEach((part, i) => walk(part, i));
  return pieces;
}

const pageOf = (top: number, pageH: number) => Math.floor((top + 0.01) / pageH);
const cuts = (top: number, height: number, pageH: number) => height <= pageH && top + height > (pageOf(top, pageH) + 1) * pageH + 0.01;

/**
 * A table as WebKit prints it, its rows starting at `top` under a top border `border` high: where
 * every line ends up, and how much taller the table gets. A cell moves a line the page's end
 * would cut to the next page, and its row grows by the most any of its cells did.
 *
 * WebKit lays a new table out more than once (`RenderTable::layout`): first with every section and
 * row at the table's top, then, the sections having moved under each other, with the rows where
 * the time before put them. Each time a row is sized where it then sits and again in its real
 * place, and keeps the taller of the two (`RenderTableSection::layoutRows`). So a row can print
 * taller than its lines need; measured against printed PDFs, this is what happens.
 */
function tableLines(sections: Row[][], top: number, pageH: number, border: number) {
  const fit = (cell: Cell, at: number) => {
    let moved = 0;
    const tops = cell.lines.map((line) => {
      let y = at + line.inset + moved;
      if (cuts(y, line.bottom - line.top, pageH)) {
        const next = (pageOf(y, pageH) + 1) * pageH;
        moved += next - y;
        y = next;
      }
      return y;
    });
    return { tops, height: cell.height + moved };
  };
  const tallest = (row: Row, at: number) => Math.max(0, ...row.map((cell) => fit(cell, at).height));
  const plain = sections.reduce((sum, rows) => sum + rows.reduce((h, row) => h + Math.max(0, ...row.map((cell) => cell.height)), 0), 0);
  let tops = sections.map(() => top - border);
  const places = sections.map((rows) => rows.map(() => 0));
  let lines: { piece: Piece; top: number }[] = [];
  let height = 0;
  for (let round = 0; round <= sections.length; round++) {
    lines = [];
    const heights = sections.map((rows, s) => {
      const first = rows.map((row, r) => tallest(row, tops[s] + places[s][r]));
      let at = 0;
      rows.forEach((row, r) => {
        const cells = row.map((cell) => fit(cell, tops[s] + at));
        cells.forEach((cell, c) => cell.tops.forEach((y, i) => lines.push({ piece: row[c].lines[i], top: y })));
        places[s][r] = at;
        at += Math.max(first[r], ...cells.map((cell) => cell.height));
      });
      return at;
    });
    // The sections go under each other; where one moved, the table is laid out again.
    let y = top;
    const next = heights.map((h) => { const t = y; y += h; return t; });
    const same = next.every((t, s) => Math.abs(t - tops[s]) < 0.01);
    tops = next;
    height = y - top;
    if (same) break;
  }
  return { lines, grew: height - plain };
}

/**
 * The first piece of every page after the first: what a page's end would cut through moves whole
 * to the next page, and all after it moves down with it.
 */
function pageStarts(pieces: Piece[], pageH: number): Piece[] {
  const starts: Piece[] = [];
  let shift = 0;
  let page = 0;
  // Where the last box ended: a page's end between it and the next box falls in the gap between them.
  let edge = 0;
  for (const piece of pieces) {
    let top = piece.top + shift;
    const height = piece.bottom - piece.top;
    let on = pageOf(top, pageH);
    if (!piece.table && cuts(top, height, pageH)) {
      on += 1;
      // A box's first line takes the box's top to the top of the page.
      shift += on * pageH - top + piece.inset;
    } else if (on > page && edge <= on * pageH + 0.01 && top - piece.inset > on * pageH) {
      // The page's end fell in the gap between two blocks: the next one starts at the top of the page.
      shift -= top - piece.inset - on * pageH;
    }
    top = piece.top + shift;
    if (piece.table) {
      const table = tableLines(piece.table, top, pageH, piece.inset);
      for (const line of table.lines) {
        if (pageOf(line.top, pageH) > page) { starts.push(line.piece); page = pageOf(line.top, pageH); }
      }
      shift += table.grew;
      edge = piece.bottom + shift;
      continue;
    }
    if (on > page) { starts.push(piece); page = on; }
    edge = top + height + piece.under;
  }
  return starts;
}

/** Where in its text node a line starts: the first letter drawn on that line. */
function lineStart(node: Text, piece: Piece) {
  const range = document.createRange();
  let lo = 0;
  let hi = node.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    range.setStart(node, 0);
    range.setEnd(node, mid + 1);
    if (range.getBoundingClientRect().bottom > piece.y + piece.h / 2) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The page breaks of the note laid out in `box`, one child of it per part of the note. */
export function breaksIn(box: HTMLElement, pageH: number): Break[] {
  const range = document.createRange();
  return pageStarts(piecesOf(box, pageH), pageH).map((piece) => {
    range.setStart(box.children[piece.part], 0);
    if (piece.at instanceof Text) range.setEnd(piece.at, lineStart(piece.at, piece));
    else range.setEndBefore(piece.at);
    return { part: piece.part, skip: letters(range.toString()), row: !!piece.rowStart };
  });
}

/** A part of the note: one block, or the lists that follow each other (the export reads them as one list). */
type Part = { pos: number; nodes: PMNode[] };

function partsOf(doc: PMNode): Part[] {
  const parts: Part[] = [];
  let list = false;
  doc.forEach((node, pos) => {
    const isList = node.type.name.endsWith('List');
    if (isList && list) parts[parts.length - 1].nodes.push(node);
    else parts.push({ pos, nodes: [node] });
    list = isList;
  });
  return parts;
}

const mdOf = new WeakMap<PMNode, string>();
const htmlOf = new Map<string, Promise<string>>();

/** A part of the note as the export draws it. Kept per block: typing changes one block at a time. */
function partHtml(editor: Editor, part: Part) {
  const write = (nodes: PMNode[]) => editor.markdown?.serialize({ type: 'doc', content: nodes.map((n) => n.toJSON()) }) ?? '';
  let md = part.nodes.length > 1 ? write(part.nodes) : mdOf.get(part.nodes[0]);
  if (md === undefined) mdOf.set(part.nodes[0], md = write(part.nodes));
  let html = htmlOf.get(md);
  if (!html) {
    if (htmlOf.size > 4000) htmlOf.clear();
    htmlOf.set(md, html = noteHtml(md, fileUrl).catch(() => ''));
  }
  return html;
}

/**
 * WebKit prints with lines a whole number of px high (16 px text at 1.6 gets 25 px lines, not the
 * 25.6 px it gets on screen; measured in a printed PDF). The sheet's lines are cut down the same way.
 */
const WHOLE_LINES = `
.vb-sheet, .vb-sheet * { line-height: round(down, 1.6em, 1px); }
.vb-sheet h1, .vb-sheet h1 * { line-height: round(down, 1.2em, 1px); }
.vb-sheet h2, .vb-sheet h2 * { line-height: round(down, 1.25em, 1px); }`;

let sheet: HTMLElement | null = null;

/** The out-of-sight sheet the note is laid out on, as wide as the paper's text. */
function sheetOf(width: number) {
  if (!sheet) {
    const style = document.createElement('style');
    style.textContent = `${NOTE_CSS}\n${PRINT_CSS('.vb-sheet')}\n.vb-sheet { position: fixed; left: -100000px; top: 0; margin: 0; visibility: hidden; pointer-events: none; }\n@media print { .vb-sheet { display: none; } }${WHOLE_LINES}`;
    document.head.appendChild(style);
    sheet = document.createElement('article');
    sheet.className = 'vb-export vb-sheet';
    sheet.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sheet);
  }
  sheet.style.width = `${width}px`;
  return sheet;
}

/** The note's page breaks for this paper. Only the parts that changed since the last time are drawn again. */
export async function noteBreaks(editor: Editor, paper: Paper): Promise<Break[]> {
  const htmls = await Promise.all(partsOf(editor.state.doc).map((part) => partHtml(editor, part)));
  let page = pageBox(paper);
  const box = sheetOf(page.w);
  while (box.children.length > htmls.length) box.lastElementChild!.remove();
  htmls.forEach((html, i) => {
    let part = box.children[i] as (HTMLElement & { vbHtml?: string }) | undefined;
    if (!part) part = box.appendChild(document.createElement('div'));
    if (part.vbHtml !== html) { part.innerHTML = html; part.vbHtml = html; }
  });
  await Promise.all([...box.querySelectorAll('img')].map((img) => (img.complete ? null : img.decode().catch(() => {}))));
  if (box.scrollWidth > page.w) {
    page = pageBox(paper, box.scrollWidth);
    box.style.width = `${page.w}px`;
  }
  return breaksIn(box, page.h);
}

/** How far down the editor's scrolling box each break is drawn, with the number of the page it starts. */
export function breakLines(editor: Editor, breaks: Break[], scroll: HTMLElement): { top: number; page: number }[] {
  const { view, state } = editor;
  const parts = partsOf(state.doc);
  const base = scroll.getBoundingClientRect().top - scroll.scrollTop;
  const lines: { top: number; page: number }[] = [];
  breaks.forEach((b, n) => {
    const part = parts[b.part];
    if (!part) return;
    // The block the break is in, and the place of its letter number `skip` in the note.
    let pos = part.pos;
    let left = b.skip;
    let at = -1;
    for (const node of part.nodes) {
      const start = pos;
      node.descendants((child, rel) => {
        if (at >= 0) return false;
        const text = child.isText ? child.text ?? '' : '';
        for (let i = 0; i < text.length && at < 0; i++) {
          if (/\s/.test(text[i])) continue;
          if (left-- === 0) at = start + 1 + rel + i;
        }
        return at < 0;
      });
      if (at >= 0) break;
      pos += node.nodeSize;
    }
    if (at < 0) pos = part.pos;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return;
    const box = dom.getBoundingClientRect();
    // A folded heading hides the blocks under it.
    if (!box.height) return;
    let y: number;
    if (b.skip && at >= 0) {
      const inside = view.domAtPos(at).node;
      const row = b.row ? (inside instanceof Element ? inside : inside.parentElement)?.closest('tr') : null;
      y = row && dom.contains(row) ? row.getBoundingClientRect().top : view.coordsAtPos(at).top - 1;
    } else {
      // Between two blocks: in the middle of the gap.
      const before = dom.previousElementSibling?.getBoundingClientRect();
      y = before && before.height ? (before.bottom + box.top) / 2 : box.top;
    }
    lines.push({ top: Math.round(y - base), page: n + 2 });
  });
  return lines;
}
