import React from 'react';
import { Linking, Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useTheme } from '@/theme';
import { openableUrl } from '@/utils/links';

/**
 * An AI reply as markdown, with only what replies use: paragraphs, headings, lists, code blocks,
 * quotes, and **bold**, *italic*, `code` and [links] inside lines. A few lines of RN instead of a
 * markdown package. Pictures are never shown (a picture could track who opened it).
 */
export function ChatMarkdown({ text }: { text: string }) {
  const t = useTheme();
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  const body: TextStyle = { color: t.colors.text, fontSize: 16, lineHeight: 23 };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i].trim()); i++) code.push(lines[i]);
      i++;
      blocks.push(
        <View key={blocks.length} style={[styles.code, { backgroundColor: t.colors.surface }]}>
          <Text selectable style={[styles.codeText, { color: t.colors.text }]}>{code.join('\n')}</Text>
        </View>,
      );
      continue;
    }
    const item = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const items: { mark: string; text: string }[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push({ mark: /\d/.test(m[1]) ? m[1].replace(')', '.') : '•', text: m[2] });
        i++;
      }
      blocks.push(
        <View key={blocks.length} style={styles.list}>
          {items.map((it, k) => (
            <View key={k} style={styles.item}>
              <Text style={[body, styles.mark, { color: t.colors.textSecondary }]}>{it.mark}</Text>
              <Text selectable style={[body, styles.itemText]}>{inline(it.text, t.colors.accent)}</Text>
            </View>
          ))}
        </View>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<Text key={blocks.length} selectable style={[body, styles.heading]}>{inline(heading[2], t.colors.accent)}</Text>);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(
        <View key={blocks.length} style={[styles.quote, { borderLeftColor: t.colors.border }]}>
          <Text selectable style={[body, { color: t.colors.textSecondary }]}>{inline(quote.join(' '), t.colors.accent)}</Text>
        </View>,
      );
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\s*([-*•]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<Text key={blocks.length} selectable style={body}>{inline(para.join('\n'), t.colors.accent)}</Text>);
  }
  return <View style={styles.root}>{blocks}</View>;
}

/** **bold**, *italic*, `code` and [text](link) inside a line; a bare image is dropped. */
function inline(text: string, linkColor: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(!?\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(`[^`]+`)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    const k = out.length;
    if (m[1]) {
      const link = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(s)!;
      const url = openableUrl(link[3]);
      if (!link[1]) {
        out.push(url
          ? <Text key={k} style={{ color: linkColor, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(url)}>{link[2]}</Text>
          : link[2]);
      }
    } else if (m[2] || m[3]) out.push(<Text key={k} style={styles.bold}>{s.slice(2, -2)}</Text>);
    else if (m[4]) out.push(<Text key={k} style={styles.inlineCode}>{s.slice(1, -1)}</Text>);
    else out.push(<Text key={k} style={styles.italic}>{s.slice(1, -1)}</Text>);
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  root: { gap: 8 },
  heading: { fontWeight: '700', fontSize: 17 },
  list: { gap: 3 },
  item: { flexDirection: 'row', gap: 6 },
  mark: { minWidth: 16 },
  itemText: { flex: 1 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  code: { borderRadius: 10, padding: 10 },
  codeText: { fontFamily: MONO, fontSize: 13, lineHeight: 18 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  inlineCode: { fontFamily: MONO, fontSize: 14 },
});
