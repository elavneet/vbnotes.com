import type { SyntaxRole } from '@/editor/highlight';

export type ThemeName = 'dark' | 'light';

export interface Theme {
  id: string;
  label: string;
  /** Light or dark: the status bar, the system controls and a few tints follow it. */
  name: ThemeName;
  colors: {
    bg: string;
    surface: string;
    surface2: string;
    /** The selected segment: lifts off `surface2`. */
    raised: string;
    border: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    /** Accent for text and icons (links, active states). */
    accent: string;
    /** The highlighter fill (Volt in Ink and Paper): compose button, selected chips, checked boxes. */
    volt: string;
    /** Text and icons drawn on `volt`. */
    onVolt: string;
    danger: string;
    codeBg: string;
    scrim: string;
    /** The format keyboard: its ground, format keys, and the darker caret/system keys. */
    kbBg: string;
    kbKey: string;
    kbAlt: string;
  };
  /** Tag tints by hue slot (see `tagHue`): chip background and text. */
  tags: { bg: string; fg: string }[];
  /** Code colours by role (see `src/editor/highlight.ts`). */
  syntax: Record<SyntaxRole, string>;
}

/** Ink: a blue-black night page. Volt is a highlighter stroke, used sparingly. */
export const darkTheme: Theme = {
  id: 'ink',
  label: 'Ink',
  name: 'dark',
  colors: {
    bg: '#0C0D10',
    surface: '#16181D',
    surface2: '#1F2128',
    raised: '#353843',
    border: '#272A32',
    text: '#ECEDF0',
    textSecondary: '#A3A6B0',
    textMuted: '#6B6F7B',
    accent: '#C8F25A',
    volt: '#C8F25A',
    onVolt: '#11140A',
    danger: '#FF6B6B',
    codeBg: '#14161B',
    scrim: '#000000A6',
    kbBg: '#1A1C21',
    kbKey: '#454852',
    kbAlt: '#2A2C33',
  },
  tags: [
    { bg: '#C8F25A1F', fg: '#D5F584' },
    { bg: '#5AC8FA1F', fg: '#86D6FB' },
    { bg: '#A78BFA26', fg: '#C4B5FD' },
    { bg: '#FF8A6526', fg: '#FFAA8F' },
    { bg: '#F5B9421F', fg: '#F7CB6E' },
    { bg: '#34D3991F', fg: '#74E3BB' },
    { bg: '#F472B626', fg: '#F9A8D4' },
    { bg: '#60A5FA26', fg: '#9EC5FE' },
  ],
  syntax: {
    keyword: '#C792EA', string: '#C3E88D', number: '#F78C6C', comment: '#6B6F7B', title: '#82AAFF',
    type: '#FFCB6B', attr: '#89DDFF', meta: '#A3A6B0', added: '#74E3BB', removed: '#FF6B6B',
  },
};

/** Paper: warm off-white, ink text, an olive accent dark enough to read on paper. */
export const lightTheme: Theme = {
  id: 'paper',
  label: 'Paper',
  name: 'light',
  colors: {
    bg: '#FBFAF7',
    surface: '#F1EFEA',
    surface2: '#E7E4DD',
    raised: '#FFFFFF',
    border: '#E2DED5',
    text: '#17181C',
    textSecondary: '#4B4E57',
    textMuted: '#8A8C94',
    accent: '#4D7A0C',
    volt: '#C8F25A',
    onVolt: '#11140A',
    danger: '#D93636',
    codeBg: '#F3F1EC',
    scrim: '#17181C66',
    kbBg: '#DCD8D0',
    kbKey: '#FFFFFF',
    kbAlt: '#BFBAB0',
  },
  tags: [
    { bg: '#C8F25A66', fg: '#3D6110' },
    { bg: '#0EA5E91C', fg: '#0369A1' },
    { bg: '#8B5CF61C', fg: '#6D28D9' },
    { bg: '#F973161C', fg: '#C2410C' },
    { bg: '#F59E0B24', fg: '#A15C07' },
    { bg: '#10B9811C', fg: '#047857' },
    { bg: '#EC48991C', fg: '#BE185D' },
    { bg: '#3B82F61C', fg: '#1D4ED8' },
  ],
  syntax: {
    keyword: '#7C3AED', string: '#4D7A0C', number: '#C2410C', comment: '#8A8C94', title: '#1D4ED8',
    type: '#A15C07', attr: '#0E7490', meta: '#4B4E57', added: '#047857', removed: '#D93636',
  },
};

export const fonts = {
  // The platform's own face (SF Pro on Apple, Roboto on Android): no font to load, crisp at every size.
  regular: undefined as string | undefined,
  medium: undefined as string | undefined,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
