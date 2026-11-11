import React from 'react';

/** The few line icons the desktop screens use (24px grid, drawn with the current colour). */
const PATHS = {
  notes: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h7M9 17h5',
  untagged: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9zM8 8h.01M4 20 20 4',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9zM8 8h.01',
  archive: 'M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pin: 'M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8',
  bookmark: 'M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  send: 'M12 19V5M6 11l6-6 6 6',
  sidebar: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 5v14',
  restore: 'M4 10h11a5 5 0 0 1 0 10h-3M4 10l4-4M4 10l4 4',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  sparkle: 'M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z',
  cloud: 'M7 18a5 5 0 0 1-.9-9.9A6 6 0 0 1 17.6 9 4.5 4.5 0 0 1 17 18z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  computer: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 21h6M12 17v4',
  // The note's ⓘ panel and ⋮ menu (InfoPanel.tsx, NoteMenu.tsx)
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01',
  stats: 'M4 20h16M6.5 16v-3M10.5 16V8M14.5 16v-5M18.5 16V5',
  outline: 'M9 6h11M13 12h7M13 18h7M4.5 6h.01M8.5 12h.01M8.5 18h.01',
  backlinks: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v5',
  editorOnly: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  threePanes: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 5v14M13 5v14',
  export: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M12 17v-6M9.5 13.5L12 11l2.5 2.5',
  copy: 'M9 8h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1',
  print: 'M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l5 5L20 7',
  words: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 9h8M8 12.5h5',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01',
  // The style bar (StyleBar.tsx)
  heading: 'M6 4v16M18 4v16M6 12h12',
  todo: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8 12l3 3 5-6',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  listOrdered: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5c.4-.6 1-1 1.7-1 .8 0 1.3.5 1.3 1.2 0 1.3-3 2.3-3 4.3h3',
  quote: 'M5 5v14M10 7h9M10 12h9M10 17h6',
  rule: 'M3 12h18M3 9v6M21 9v6',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7.5a4 4 0 0 1 0 8H7z',
  italic: 'M10 4h8M6 20h8M15 4L9 20',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
  strike: 'M4 12h16M16.5 7.5C16 5.5 14.2 4 12 4 9.5 4 7.5 5.6 7.5 7.8c0 1.5.9 2.6 2.4 3.2M8 17c.6 1.8 2.3 3 4.4 3 2.6 0 4.6-1.6 4.6-3.8 0-.9-.3-1.6-.8-2.2',
  highlight: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L11.8 5.2M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  table: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M3 15h18M12 4v16',
  image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM21 15l-5-5L6 20M8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  down: 'M7 10l5 5 5-5',
  fold: 'M4 6h16M4 12h16M4 18h16M9 3l3 3 3-3M9 21l3-3 3 3',
  unfold: 'M4 12h16M9 4l3 3 3-3M9 20l3-3 3 3',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  codeBlock: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 9l-3 3 3 3M14 9l3 3-3 3',
  hide: 'M3 3l18 18M10.6 5.1C11 5 11.5 5 12 5c5 0 9 4.5 10 7-.5 1.2-1.3 2.4-2.4 3.5M6.6 6.6C4.4 8 2.8 10 2 12c1 2.5 5 7 10 7 2 0 3.9-.6 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
} as const;

export type IconName = keyof typeof PATHS;

/**
 * `filled` paints the inside too, for a button that is on (a closed shape such as `bookmark`).
 * `d` draws a path from elsewhere (the callout icons in `src/editor/noteSyntax.ts`).
 */
export function Icon({ name, d, size = 18, className, weight = 1.8, filled, color }: { name?: IconName; d?: string; size?: number; className?: string; weight?: number; filled?: boolean; color?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={color ? { color } : undefined}>
      <path d={d ?? (name ? PATHS[name] : '')} />
    </svg>
  );
}
