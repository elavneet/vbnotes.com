import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { stripInline, toPlainText } from '@/utils/markdown';
import { IconButton, type IconName } from './IconButton';

type Heading = { level: number; text: string };

function statsOf(md: string) {
  const plain = toPlainText(md).trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  const paragraphs = md.split(/\n\s*\n/).filter((b) => b.trim()).length;
  const seconds = Math.round((words / 230) * 60);
  return {
    words,
    characters: plain.replace(/\n+/g, ' ').length,
    paragraphs,
    read: seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`,
  };
}

/** `#` headings outside code blocks, in order: the same ones the editor counts for `goToHeading`. */
function headingsOf(md: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    const m = fence ? null : /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: stripInline(m[2]) });
  }
  return out;
}

function longDate(ms: number) {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** The (i) sheet, as in Bear: counts and dates, or the note's headings to jump to. */
export function NoteInfoSheet({ visible, onClose, md, modified, created, onHeading }: {
  visible: boolean; onClose: () => void; md: string; modified?: number; created?: number | null; onHeading: (index: number) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<'stats' | 'outline'>('stats');
  const stats = useMemo(() => statsOf(md), [md]);
  const heads = useMemo(() => headingsOf(md), [md]);
  const [rise] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!visible) return;
    rise.setValue(1);
    Animated.timing(rise, { toValue: 0, duration: 240, useNativeDriver: true }).start();
  }, [visible, rise]);

  const cards: [IconName, string, string][] = [
    ['chatbox-outline', String(stats.words), 'Words'],
    ['text-outline', String(stats.characters), 'Characters'],
    ['reorder-four-outline', String(stats.paragraphs), 'Paragraphs'],
    ['time-outline', stats.read, 'Read time'],
  ];
  const dates: [string, number | null | undefined][] = [['Modified', modified], ['Created', created]];

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.scrim }]} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: t.colors.bg, borderColor: t.colors.border, maxHeight: height * 0.8, paddingBottom: insets.bottom + 76 },
          { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) }] },
        ]}
      >
        <View style={styles.top}>
          <IconButton name="close" filled color={t.colors.text} onPress={onClose} label="Close" />
          <Text style={[styles.title, { color: t.colors.text }]}>{tab === 'stats' ? 'Statistics' : 'Outline'}</Text>
          <View style={styles.side} />
        </View>
        {tab === 'stats' ? (
          <View style={styles.body}>
            <View style={styles.grid}>
              {cards.map(([icon, value, label]) => (
                <View key={label} style={[styles.card, { backgroundColor: t.colors.surface }]}>
                  <View style={styles.cardTop}>
                    <Text style={[styles.value, { color: t.colors.text }]}>{value}</Text>
                    <Ionicons name={icon} size={20} color={t.colors.textMuted} />
                  </View>
                  <Text style={[styles.label, { color: t.colors.textSecondary }]}>{label}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.list, { backgroundColor: t.colors.surface }]}>
              {dates.map(([label, ms], i) => (
                <View key={label} style={[styles.dateRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border }]}>
                  <View style={styles.dateText}>
                    <Text style={[styles.date, { color: t.colors.text }]}>{ms ? longDate(ms) : 'Not known'}</Text>
                    <Text style={[styles.label, { color: t.colors.textSecondary }]}>{label}</Text>
                  </View>
                  <Ionicons name="calendar-outline" size={20} color={t.colors.textMuted} />
                </View>
              ))}
            </View>
          </View>
        ) : (
          <ScrollView style={styles.outline} contentContainerStyle={styles.body}>
            {heads.length ? heads.map((h, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                onPress={() => { onClose(); onHeading(i); }}
                style={({ pressed }) => [styles.head, { paddingLeft: 14 + (h.level - 1) * 16 }, pressed && { backgroundColor: t.colors.surface }]}
              >
                <Text numberOfLines={1} style={[styles.headText, { color: h.level === 1 ? t.colors.text : t.colors.textSecondary, fontWeight: h.level <= 2 ? '600' : '400' }]}>{h.text}</Text>
              </Pressable>
            )) : <Text style={[styles.none, { color: t.colors.textMuted }]}>No headings in this note.</Text>}
          </ScrollView>
        )}
        <View style={[styles.tabs, { bottom: insets.bottom + 12, backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          {(['stats', 'outline'] as const).map((id) => {
            const on = tab === id;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityLabel={id === 'stats' ? 'Statistics' : 'Outline'}
                accessibilityState={{ selected: on }}
                onPress={() => setTab(id)}
                style={[styles.tab, on && { backgroundColor: t.colors.surface2 }]}
              >
                <Ionicons name={id === 'stats' ? 'stats-chart' : 'list'} size={20} color={on ? t.colors.accent : t.colors.textSecondary} />
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 8, right: 8, bottom: 8, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  side: { width: 44 },
  title: { fontSize: 17, fontWeight: '600' },
  body: { paddingHorizontal: 16, gap: 10, paddingBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexBasis: '47%', flexGrow: 1, borderRadius: 16, padding: 14, gap: 18 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  value: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  label: { fontSize: 15 },
  list: { borderRadius: 16, overflow: 'hidden' },
  dateRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  dateText: { flex: 1, gap: 2 },
  date: { fontSize: 17, fontWeight: '600' },
  outline: { flexGrow: 0 },
  head: { minHeight: 44, justifyContent: 'center', paddingRight: 14, borderRadius: 12 },
  headText: { fontSize: 16 },
  none: { fontSize: 15, textAlign: 'center', paddingVertical: 40 },
  tabs: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', padding: 4, gap: 4, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  tab: { width: 72, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
