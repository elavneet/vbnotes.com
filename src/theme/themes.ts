import type { SyntaxRole } from '@/editor/highlight';
import { darkTheme, lightTheme, type Theme, type ThemeName } from './tokens';

/**
 * The themes on offer besides Ink and Paper. Most are public palettes (Solarized, Dracula, Nord…)
 * used with their published colours; Red Graphite, Dark Graphite and High Contrast are our own.
 * Each is a few base colours; `make` derives the surfaces, keyboard keys and tag tints the way
 * Ink and Paper are built.
 */
interface Palette {
  bg: string;
  text: string;
  /** Links, the caret, active controls. */
  accent: string;
  /** The highlighter fill: checked boxes, the compose button, highlighted text. */
  volt: string;
  danger: string;
  /** Quiet text: dates, placeholders, list markers. */
  muted?: string;
  /** Eight tag colours, one per `tagHue` slot. */
  hues: string[];
  syntax: Omit<Record<SyntaxRole, string>, 'meta' | 'added' | 'removed'>;
}

const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function luminance(c: string) {
  const [r, g, b] = rgb(c).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function make(id: string, label: string, name: ThemeName, p: Palette): Theme {
  const dark = name === 'dark';
  const toward = (t: number) => mix(p.bg, p.text, t);
  const textSecondary = mix(p.text, p.bg, 0.28);
  return {
    id, label, name,
    colors: {
      bg: p.bg,
      surface: toward(0.045),
      surface2: toward(0.085),
      raised: dark ? toward(0.18) : mix(p.bg, '#FFFFFF', 0.8),
      border: toward(dark ? 0.12 : 0.1),
      text: p.text,
      textSecondary,
      textMuted: p.muted ?? mix(p.text, p.bg, 0.5),
      accent: p.accent,
      volt: p.volt,
      onVolt: luminance(p.volt) > 0.32 ? mix(p.volt, '#000000', 0.86) : '#FFFFFF',
      danger: p.danger,
      codeBg: toward(0.035),
      scrim: dark ? '#000000A6' : p.text + '66',
      kbBg: toward(dark ? 0.06 : 0.13),
      kbKey: dark ? toward(0.25) : mix(p.bg, '#FFFFFF', 0.85),
      kbAlt: toward(dark ? 0.13 : 0.26),
    },
    tags: p.hues.map((h) => ({ bg: h + (dark ? '29' : '24'), fg: dark ? h : mix(h, p.text, 0.15) })),
    syntax: { ...p.syntax, meta: textSecondary, added: p.syntax.string, removed: p.danger },
  };
}

/** Light themes first, then dark; Paper and Ink lead their groups. */
export const THEMES: Theme[] = [
  lightTheme,
  make('red-graphite', 'Red Graphite', 'light', {
    bg: '#FBFBFA', text: '#2E2F33', muted: '#8E9096', accent: '#D8433B', volt: '#E5534B', danger: '#C42B2B',
    hues: ['#D8433B', '#C2410C', '#A16207', '#4D7C0F', '#0F766E', '#1D4ED8', '#7C3AED', '#BE185D'],
    syntax: { keyword: '#B42F7A', string: '#3F7A1F', number: '#C2410C', comment: '#8E9096', title: '#1D4ED8', type: '#A16207', attr: '#0F766E' },
  }),
  make('high-contrast-light', 'High Contrast', 'light', {
    bg: '#FFFFFF', text: '#000000', muted: '#4A4A4A', accent: '#0040DD', volt: '#FFE500', danger: '#C00000',
    hues: ['#0040DD', '#006B00', '#9B0094', '#B00020', '#B04000', '#7A4D00', '#00607A', '#333333'],
    syntax: { keyword: '#9B0094', string: '#006B00', number: '#B04000', comment: '#4A4A4A', title: '#0040DD', type: '#7A4D00', attr: '#00607A' },
  }),
  make('solarized-light', 'Solarized Light', 'light', {
    bg: '#FDF6E3', text: '#586E75', muted: '#93A1A1', accent: '#268BD2', volt: '#B58900', danger: '#DC322F',
    hues: ['#B58900', '#CB4B16', '#DC322F', '#D33682', '#6C71C4', '#268BD2', '#2AA198', '#859900'],
    syntax: { keyword: '#859900', string: '#2AA198', number: '#D33682', comment: '#93A1A1', title: '#268BD2', type: '#B58900', attr: '#CB4B16' },
  }),
  make('nord-light', 'Nord Light', 'light', {
    bg: '#ECEFF4', text: '#2E3440', muted: '#7B88A1', accent: '#5E81AC', volt: '#EBCB8B', danger: '#BF616A',
    hues: ['#5E81AC', '#81A1C1', '#8FBCBB', '#A3BE8C', '#EBCB8B', '#D08770', '#BF616A', '#B48EAD'],
    syntax: { keyword: '#5E81AC', string: '#6E8F55', number: '#B48EAD', comment: '#7B88A1', title: '#3B6E8F', type: '#8F7032', attr: '#D08770' },
  }),
  make('gruvbox-light', 'Gruvbox Light', 'light', {
    bg: '#FBF1C7', text: '#3C3836', muted: '#928374', accent: '#076678', volt: '#FABD2F', danger: '#9D0006',
    hues: ['#9D0006', '#AF3A03', '#B57614', '#79740E', '#427B58', '#076678', '#8F3F71', '#7C6F64'],
    syntax: { keyword: '#9D0006', string: '#79740E', number: '#8F3F71', comment: '#928374', title: '#076678', type: '#B57614', attr: '#427B58' },
  }),
  make('catppuccin-latte', 'Catppuccin Latte', 'light', {
    bg: '#EFF1F5', text: '#4C4F69', muted: '#8C8FA1', accent: '#8839EF', volt: '#DF8E1D', danger: '#D20F39',
    hues: ['#1E66F5', '#8839EF', '#EA76CB', '#D20F39', '#FE640B', '#DF8E1D', '#40A02B', '#179299'],
    syntax: { keyword: '#8839EF', string: '#40A02B', number: '#FE640B', comment: '#8C8FA1', title: '#1E66F5', type: '#DF8E1D', attr: '#179299' },
  }),
  make('rose-pine-dawn', 'Rosé Pine Dawn', 'light', {
    bg: '#FAF4ED', text: '#575279', muted: '#9893A5', accent: '#286983', volt: '#EA9D34', danger: '#B4637A',
    hues: ['#B4637A', '#EA9D34', '#D7827E', '#286983', '#56949F', '#907AA9', '#797593', '#575279'],
    syntax: { keyword: '#286983', string: '#EA9D34', number: '#B4637A', comment: '#9893A5', title: '#D7827E', type: '#56949F', attr: '#907AA9' },
  }),
  make('tokyo-night-day', 'Tokyo Night Day', 'light', {
    bg: '#E1E2E7', text: '#3760BF', muted: '#848CB5', accent: '#2E7DE9', volt: '#E0AF68', danger: '#F52A65',
    hues: ['#2E7DE9', '#007197', '#9854F1', '#F52A65', '#B15C00', '#8C6C3E', '#587539', '#118C74'],
    syntax: { keyword: '#9854F1', string: '#587539', number: '#B15C00', comment: '#848CB5', title: '#2E7DE9', type: '#007197', attr: '#118C74' },
  }),
  make('everforest-light', 'Everforest Light', 'light', {
    bg: '#FDF6E3', text: '#5C6A72', muted: '#939F91', accent: '#35A77C', volt: '#DFA000', danger: '#F85552',
    hues: ['#8DA101', '#35A77C', '#3A94C5', '#DF69BA', '#F85552', '#F57D26', '#DFA000', '#829181'],
    syntax: { keyword: '#F85552', string: '#35A77C', number: '#DF69BA', comment: '#939F91', title: '#8DA101', type: '#DFA000', attr: '#F57D26' },
  }),
  make('ayu-light', 'Ayu Light', 'light', {
    bg: '#FCFCFC', text: '#5C6166', muted: '#8A9199', accent: '#399EE6', volt: '#FFAA33', danger: '#E65050',
    hues: ['#FFAA33', '#86B300', '#399EE6', '#A37ACC', '#F07171', '#4CBF99', '#FA8D3E', '#55B4D4'],
    syntax: { keyword: '#FA8D3E', string: '#86B300', number: '#A37ACC', comment: '#A0A6AC', title: '#F2AE49', type: '#399EE6', attr: '#4CBF99' },
  }),
  make('one-light', 'One Light', 'light', {
    bg: '#FAFAFA', text: '#383A42', muted: '#A0A1A7', accent: '#4078F2', volt: '#E5C07B', danger: '#E45649',
    hues: ['#4078F2', '#0184BC', '#A626A4', '#E45649', '#986801', '#C18401', '#50A14F', '#696C77'],
    syntax: { keyword: '#A626A4', string: '#50A14F', number: '#986801', comment: '#A0A1A7', title: '#4078F2', type: '#C18401', attr: '#0184BC' },
  }),
  make('duotone-light', 'Duotone Light', 'light', {
    bg: '#FAF8F5', text: '#2D2006', muted: '#9C9079', accent: '#065289', volt: '#AEC3E8', danger: '#B3261E',
    hues: ['#065289', '#718ECD', '#896724', '#B29762', '#3C6E9E', '#A07A2C', '#5A7BB5', '#6B5A3A'],
    syntax: { keyword: '#065289', string: '#896724', number: '#065289', comment: '#B6AD9A', title: '#896724', type: '#718ECD', attr: '#B29762' },
  }),

  darkTheme,
  make('dark-graphite', 'Dark Graphite', 'dark', {
    bg: '#232427', text: '#DCDCDE', muted: '#808287', accent: '#F06A62', volt: '#F06A62', danger: '#FF6B6B',
    hues: ['#F06A62', '#F59E0B', '#EAB308', '#84CC16', '#2DD4BF', '#60A5FA', '#A78BFA', '#F472B6'],
    syntax: { keyword: '#F472B6', string: '#A3D977', number: '#F59E0B', comment: '#808287', title: '#60A5FA', type: '#EAB308', attr: '#2DD4BF' },
  }),
  make('high-contrast-dark', 'High Contrast', 'dark', {
    bg: '#000000', text: '#FFFFFF', muted: '#B0B0B0', accent: '#5CC8FF', volt: '#FFE500', danger: '#FF6B6B',
    hues: ['#FFE500', '#5CC8FF', '#FF8AFF', '#FF6B6B', '#FFB86B', '#7CFF7C', '#7DF9FF', '#FFFFFF'],
    syntax: { keyword: '#FF8AFF', string: '#7CFF7C', number: '#FFB86B', comment: '#B0B0B0', title: '#5CC8FF', type: '#FFE500', attr: '#7DF9FF' },
  }),
  make('solarized-dark', 'Solarized Dark', 'dark', {
    bg: '#002B36', text: '#93A1A1', muted: '#657B83', accent: '#268BD2', volt: '#B58900', danger: '#DC322F',
    hues: ['#B58900', '#CB4B16', '#DC322F', '#D33682', '#6C71C4', '#268BD2', '#2AA198', '#859900'],
    syntax: { keyword: '#859900', string: '#2AA198', number: '#D33682', comment: '#657B83', title: '#268BD2', type: '#B58900', attr: '#CB4B16' },
  }),
  make('dracula', 'Dracula', 'dark', {
    bg: '#282A36', text: '#F8F8F2', muted: '#6272A4', accent: '#FF79C6', volt: '#50FA7B', danger: '#FF5555',
    hues: ['#50FA7B', '#8BE9FD', '#BD93F9', '#FF79C6', '#FFB86C', '#F1FA8C', '#FF5555', '#9AEDFE'],
    syntax: { keyword: '#FF79C6', string: '#F1FA8C', number: '#BD93F9', comment: '#6272A4', title: '#50FA7B', type: '#8BE9FD', attr: '#FFB86C' },
  }),
  make('nord', 'Nord', 'dark', {
    bg: '#2E3440', text: '#E5E9F0', muted: '#7B88A1', accent: '#88C0D0', volt: '#88C0D0', danger: '#BF616A',
    hues: ['#88C0D0', '#A3BE8C', '#EBCB8B', '#D08770', '#BF616A', '#B48EAD', '#8FBCBB', '#81A1C1'],
    syntax: { keyword: '#81A1C1', string: '#A3BE8C', number: '#B48EAD', comment: '#7B88A1', title: '#88C0D0', type: '#8FBCBB', attr: '#EBCB8B' },
  }),
  make('gruvbox-dark', 'Gruvbox Dark', 'dark', {
    bg: '#282828', text: '#EBDBB2', muted: '#928374', accent: '#8EC07C', volt: '#FABD2F', danger: '#FB4934',
    hues: ['#FB4934', '#FE8019', '#FABD2F', '#B8BB26', '#8EC07C', '#83A598', '#D3869B', '#D5C4A1'],
    syntax: { keyword: '#FB4934', string: '#B8BB26', number: '#D3869B', comment: '#928374', title: '#83A598', type: '#FABD2F', attr: '#8EC07C' },
  }),
  make('catppuccin-macchiato', 'Catppuccin Macchiato', 'dark', {
    bg: '#24273A', text: '#CAD3F5', muted: '#8087A2', accent: '#C6A0F6', volt: '#A6DA95', danger: '#ED8796',
    hues: ['#8AADF4', '#C6A0F6', '#F5BDE6', '#ED8796', '#F5A97F', '#EED49F', '#A6DA95', '#8BD5CA'],
    syntax: { keyword: '#C6A0F6', string: '#A6DA95', number: '#F5A97F', comment: '#8087A2', title: '#8AADF4', type: '#EED49F', attr: '#8BD5CA' },
  }),
  make('rose-pine', 'Rosé Pine', 'dark', {
    bg: '#191724', text: '#E0DEF4', muted: '#6E6A86', accent: '#C4A7E7', volt: '#EBBCBA', danger: '#EB6F92',
    hues: ['#EB6F92', '#F6C177', '#EBBCBA', '#9CCFD8', '#C4A7E7', '#3E8FB0', '#908CAA', '#E0DEF4'],
    syntax: { keyword: '#3E8FB0', string: '#F6C177', number: '#EB6F92', comment: '#6E6A86', title: '#EBBCBA', type: '#9CCFD8', attr: '#C4A7E7' },
  }),
  make('tokyo-night', 'Tokyo Night', 'dark', {
    bg: '#1A1B26', text: '#C0CAF5', muted: '#737AA2', accent: '#7AA2F7', volt: '#9ECE6A', danger: '#F7768E',
    hues: ['#7AA2F7', '#7DCFFF', '#BB9AF7', '#F7768E', '#FF9E64', '#E0AF68', '#9ECE6A', '#73DACA'],
    syntax: { keyword: '#BB9AF7', string: '#9ECE6A', number: '#FF9E64', comment: '#565F89', title: '#7AA2F7', type: '#2AC3DE', attr: '#73DACA' },
  }),
  make('everforest-dark', 'Everforest Dark', 'dark', {
    bg: '#2D353B', text: '#D3C6AA', muted: '#859289', accent: '#A7C080', volt: '#A7C080', danger: '#E67E80',
    hues: ['#A7C080', '#83C092', '#7FBBB3', '#D699B6', '#E67E80', '#E69875', '#DBBC7F', '#9DA9A0'],
    syntax: { keyword: '#E67E80', string: '#83C092', number: '#D699B6', comment: '#859289', title: '#A7C080', type: '#DBBC7F', attr: '#E69875' },
  }),
  make('ayu-mirage', 'Ayu Mirage', 'dark', {
    bg: '#1F2430', text: '#CCCAC2', muted: '#707A8C', accent: '#73D0FF', volt: '#FFCC66', danger: '#F28779',
    hues: ['#FFCC66', '#D5FF80', '#73D0FF', '#DFBFFF', '#F28779', '#95E6CB', '#FFA659', '#5CCFE6'],
    syntax: { keyword: '#FFA659', string: '#D5FF80', number: '#DFBFFF', comment: '#707A8C', title: '#FFD173', type: '#73D0FF', attr: '#95E6CB' },
  }),
  make('one-dark', 'One Dark', 'dark', {
    bg: '#282C34', text: '#ABB2BF', muted: '#7F848E', accent: '#61AFEF', volt: '#98C379', danger: '#E06C75',
    hues: ['#61AFEF', '#56B6C2', '#C678DD', '#E06C75', '#D19A66', '#E5C07B', '#98C379', '#ABB2BF'],
    syntax: { keyword: '#C678DD', string: '#98C379', number: '#D19A66', comment: '#7F848E', title: '#61AFEF', type: '#E5C07B', attr: '#E06C75' },
  }),
  make('gotham', 'Gotham', 'dark', {
    bg: '#0C1014', text: '#99D1CE', muted: '#599CAB', accent: '#2AA889', volt: '#EDB443', danger: '#C23127',
    hues: ['#2AA889', '#33859E', '#599CAB', '#888CA6', '#D26937', '#EDB443', '#C23127', '#99D1CE'],
    syntax: { keyword: '#D26937', string: '#2AA889', number: '#888CA6', comment: '#4E7C88', title: '#33859E', type: '#EDB443', attr: '#599CAB' },
  }),
  make('cobalt', 'Cobalt', 'dark', {
    bg: '#193549', text: '#E1EFFF', muted: '#8BA7C7', accent: '#FFC600', volt: '#FFC600', danger: '#FF628C',
    hues: ['#FFC600', '#FF9D00', '#FF628C', '#A5FF90', '#9EFFFF', '#3399FF', '#FB94FF', '#80FFBB'],
    syntax: { keyword: '#FF9D00', string: '#A5FF90', number: '#FF628C', comment: '#0088FF', title: '#FFC600', type: '#9EFFFF', attr: '#FFEE80' },
  }),
  make('duotone-dark', 'Duotone Dark', 'dark', {
    bg: '#2A2734', text: '#E3DFFF', muted: '#7C7695', accent: '#FFB870', volt: '#FFB870', danger: '#FF7A85',
    hues: ['#FFB870', '#9A86FD', '#C4B8FE', '#FFCC99', '#E09142', '#B6A5FF', '#EEEBFF', '#A38EFF'],
    syntax: { keyword: '#FFCC99', string: '#FFB870', number: '#FFCC99', comment: '#6C6783', title: '#C4B8FE', type: '#9A86FD', attr: '#E09142' },
  }),
];

/** The chosen theme of that kind, or Paper or Ink when the id is unknown. */
export function themeFor(name: ThemeName, id: string): Theme {
  return THEMES.find((t) => t.id === id && t.name === name) ?? (name === 'light' ? lightTheme : darkTheme);
}
