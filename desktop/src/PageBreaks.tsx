import React, { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { PAGES_SHOWN, type Break, breakLines, noteBreaks, usePageBreaks } from './printPages';

type Line = { top: number; page: number };

/**
 * Settings › Typography › Page breaks: a faint line across the note wherever a page ends when the
 * note is printed or exported as a PDF, with the number of the page that starts there. The pages
 * are worked out again shortly after the note changes (`printPages.ts`).
 */
export function PageBreaks({ editor, scroll }: { editor: Editor | null; scroll: React.RefObject<HTMLDivElement | null> }) {
  const on = usePageBreaks((s) => s.on) && PAGES_SHOWN;
  const paper = usePageBreaks((s) => s.paper);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    const box = scroll.current;
    if (!on || !editor || !box) { setLines([]); return; }
    let breaks: Break[] = [];
    let live = true;
    let run = 0;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The lines follow the note's own layout: a wider window or a folded heading moves them.
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let next: Line[];
        try { next = breakLines(editor, breaks, box); } catch { return; }
        setLines((was) => (was.length === next.length && was.every((l, i) => l.top === next[i].top) ? was : next));
      });
    };
    const measure = () => {
      const mine = ++run;
      void noteBreaks(editor, paper).then((found) => {
        if (!live || mine !== run) return;
        breaks = found;
        place();
      }, () => {});
    };
    const changed = () => {
      place();
      clearTimeout(timer);
      timer = setTimeout(measure, 400);
    };
    measure();
    editor.on('update', changed);
    const sizes = new ResizeObserver(place);
    // The editor's page is there a moment after the editor is.
    const watch = (tries: number) => {
      if (!live) return;
      try { sizes.observe(editor.view.dom); } catch { if (tries) timer = setTimeout(() => watch(tries - 1), 100); }
    };
    watch(50);
    return () => {
      live = false;
      editor.off('update', changed);
      sizes.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [on, paper, editor, scroll]);

  return <>{lines.map((l) => <div key={l.page} className="page-break" style={{ top: l.top }} data-page={l.page} />)}</>;
}
