import React, { useState, type RefObject } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode,
  DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout';
import { router } from 'expo-router';
import { useTheme } from '@/theme';
import { UNTAGGED, useNotes, type Section, type TagNode } from '@/store/notes';
import { useUi } from '@/store/ui';
import { formatTag, tagHue } from '@/utils/tags';
import { TAG_ICONS, tagIconOf } from '@/utils/tagIcons';
import { IconButton, type IconName } from './IconButton';
import { useAi } from '@/ai/chat';

/** Everything you can browse: all notes, your tags (nested ones fold), then Archive and Trash. */
function LibraryList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const counts = useNotes((s) => s.counts);
  const tags = useNotes((s) => s.tags);
  // The hold-for-icon tip goes once any tag has an icon picked by hand.
  const iconsPicked = useNotes((s) => Object.keys(s.tagIcons).length > 0);
  const { section, tag, setSection, setTag } = useUi();
  const [iconFor, setIconFor] = useState<string | null>(null);
  const aiOn = useAi((s) => s.enabled);

  const go = (s: Section) => { setSection(s); onNavigate?.(); };
  const goTag = (name: string) => { setTag(name); onNavigate?.(); };

  return (
    <View style={styles.list}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <IconButton name="settings-outline" filled color={t.colors.text} label="Settings" onPress={() => { onNavigate?.(); router.push('/settings'); }} />
        {aiOn ? <IconButton name="sparkles-outline" filled color={t.colors.text} label="Chat with AI about all notes" onPress={() => { onNavigate?.(); router.push('/chat'); }} /> : null}
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <Row icon="documents-outline" label="Notes" count={counts.notes} active={section === 'notes' && !tag} onPress={() => go('notes')} />
        {/* Untagged only filters something when some notes have tags. */}
        {counts.untagged && counts.untagged < counts.notes ? <Row icon="pricetag-outline" label="Untagged" count={counts.untagged} active={tag === UNTAGGED} onPress={() => goTag(UNTAGGED)} /> : null}
        <Row icon="archive-outline" label="Archive" count={counts.archive} active={section === 'archive'} onPress={() => go('archive')} />
        <Row icon="trash-outline" label="Trash" count={counts.trash} active={section === 'trash'} onPress={() => go('trash')} />
        <View style={styles.gap} />
        {tags.map((n) => <TagRow key={n.path} node={n} depth={0} active={tag} onPress={goTag} onLongPress={setIconFor} />)}
        {tags.length ? (
          iconsPicked ? null : <Text style={[styles.hint, { color: t.colors.textMuted }]}>Hold a tag to change its icon.</Text>
        ) : (
          <Text style={[styles.hint, { color: t.colors.textMuted }]}>Type a #tag anywhere in a note and it shows up here. Use #work/meetings to nest.</Text>
        )}
      </ScrollView>
      <TagIconSheet tag={iconFor} onClose={() => setIconFor(null)} />
    </View>
  );
}

function Row({ icon, label, count, active, onPress, onLongPress, depth = 0, iconColor, chevron, onChevron }: {
  icon: IconName; label: string; count?: number; active?: boolean; onPress: () => void; onLongPress?: () => void; depth?: number;
  iconColor?: string; chevron?: 'open' | 'closed'; onChevron?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityHint={onLongPress ? 'Hold to change the icon' : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, { paddingLeft: 14 + depth * 20 }, (active || pressed) && { backgroundColor: t.colors.surface2 }]}
    >
      <Ionicons name={icon} size={19} color={iconColor ?? (active ? t.colors.text : t.colors.textMuted)} />
      <Text numberOfLines={1} style={[styles.label, { color: active ? t.colors.text : t.colors.textSecondary, fontWeight: active ? '600' : '500' }]}>{label}</Text>
      {count ? <Text style={[styles.count, { color: t.colors.textMuted }]}>{count}</Text> : null}
      {chevron ? (
        <>
          <View style={styles.chevron}>
            <Ionicons name={chevron === 'open' ? 'chevron-down' : 'chevron-forward'} size={15} color={t.colors.textMuted} />
          </View>
          {/* The right 30% of the row folds and unfolds; a small chevron alone was too easy to miss. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chevron === 'open' ? `Fold ${label}` : `Unfold ${label}`}
            onPress={onChevron}
            onLongPress={onLongPress}
            style={styles.foldZone}
          />
        </>
      ) : null}
    </Pressable>
  );
}

/** A tag with its nested tags folded under a chevron. */
function TagRow({ node, depth, active, onPress, onLongPress }: {
  node: TagNode; depth: number; active: string; onPress: (p: string) => void; onLongPress: (p: string) => void;
}) {
  const t = useTheme();
  const icon = useNotes((s) => tagIconOf(s.tagIcons, node.path));
  const [open, setOpen] = useState(() => active.startsWith(node.path + '/'));
  const has = node.children.length > 0;
  return (
    <>
      <Row
        icon={icon}
        iconColor={t.tags[tagHue(node.path)].fg}
        label={node.name}
        count={node.count}
        depth={depth}
        active={active === node.path}
        onPress={() => onPress(node.path)}
        onLongPress={() => onLongPress(node.path)}
        chevron={has ? (open ? 'open' : 'closed') : undefined}
        onChevron={() => setOpen((o) => !o)}
      />
      {open ? node.children.map((c) => <TagRow key={c.path} node={c} depth={depth + 1} active={active} onPress={onPress} onLongPress={onLongPress} />) : null}
    </>
  );
}

/** Native page sheet with a grid of icons for one tag. */
function TagIconSheet({ tag, onClose }: { tag: string | null; onClose: () => void }) {
  const t = useTheme();
  const picked = useNotes((s) => (tag ? s.tagIcons[tag] : undefined));
  const current = useNotes((s) => (tag ? tagIconOf(s.tagIcons, tag) : undefined));
  const hue = t.tags[tagHue(tag ?? '')];
  const pick = (icon: string | null) => { if (tag) void useNotes.getState().setTagIcon(tag, icon); onClose(); };
  // Cells fill the row exactly: as many 56pt+ squares as fit the sheet's own width.
  const [gridW, setGridW] = useState(0);
  const cols = Math.max(4, Math.floor((gridW - GRID_PAD * 2 + GAP) / (56 + GAP)));
  const cell = gridW ? (gridW - GRID_PAD * 2 - GAP * (cols - 1)) / cols : 56;
  return (
    <Modal visible={!!tag} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: t.colors.bg }]}>
        <View style={styles.sheetTop}>
          <Text numberOfLines={1} style={[styles.sheetTitle, { color: t.colors.text }]}>{tag ? formatTag(tag) : ''}</Text>
          <IconButton name="close" filled label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.grid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
          {TAG_ICONS.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected: current === name }}
              onPress={() => pick(name)}
              style={({ pressed }) => [styles.cell, { width: cell, height: cell, backgroundColor: current === name ? hue.bg : t.colors.surface }, pressed && styles.pressed]}
            >
              <Ionicons name={name} size={24} color={current === name ? hue.fg : t.colors.textSecondary} />
            </Pressable>
          ))}
        </ScrollView>
        {picked ? (
          <Pressable onPress={() => pick(null)} style={({ pressed }) => [styles.reset, { backgroundColor: t.colors.surface }, pressed && styles.pressed]}>
            <Text style={[styles.resetText, { color: t.colors.textSecondary }]}>Use the default icon</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

/** Permanent left column on wide screens. */
export function LibraryPanel() {
  const t = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: t.colors.bg, borderRightColor: t.colors.border }]}>
      <LibraryList />
    </View>
  );
}

/**
 * The library in a left drawer. Gesture and slide run on the UI thread, so it follows the finger
 * even while JS is busy. `fullSwipe` lets a rightward swipe anywhere open it (phones).
 */
export function LibraryDrawer({ drawerRef, fullSwipe, children }: {
  drawerRef: RefObject<DrawerLayoutMethods | null>; fullSwipe?: boolean; children: React.ReactNode;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const close = () => drawerRef.current?.closeDrawer();
  return (
    <ReanimatedDrawerLayout
      ref={drawerRef}
      drawerType={DrawerType.SLIDE}
      drawerWidth={Math.min(320, Math.round(width * 0.84))}
      drawerBackgroundColor={t.colors.bg}
      overlayColor={t.colors.scrim}
      drawerContainerStyle={{ borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: t.colors.border }}
      edgeWidth={fullSwipe ? width : 24}
      minSwipeDistance={12}
      keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
      renderNavigationView={() => <LibraryList onNavigate={close} />}
    >
      {children}
    </ReanimatedDrawerLayout>
  );
}

const GAP = 10;
const GRID_PAD = 18;

const styles = StyleSheet.create({
  list: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingRight: 12, marginHorizontal: 8, borderRadius: 12 },
  label: { flex: 1, fontSize: 16 },
  count: { fontSize: 14, fontVariant: ['tabular-nums'] },
  chevron: { padding: 4 },
  foldZone: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '30%' },
  hint: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 4, fontSize: 13, lineHeight: 19 },
  gap: { height: 18 },
  scroll: { paddingTop: 4 },
  panel: { width: 264, borderRightWidth: StyleSheet.hairlineWidth },
  sheet: { flex: 1 },
  sheetTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 22, paddingRight: 12, paddingTop: 14, paddingBottom: 6 },
  sheetTitle: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GRID_PAD, paddingTop: 8, paddingBottom: 24 },
  cell: { borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
  reset: { marginHorizontal: 18, marginBottom: 34, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  resetText: { fontSize: 16, fontWeight: '600' },
});
