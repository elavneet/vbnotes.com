import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { useNotes } from '@/store/notes';
import { kvDel, kvGetSync, kvSet } from '@/utils/kv';
import { canUseICloud, chooseDeviceFolder, iCloudFolder, pickFolder, type Vault } from '@/vault';
import { appReady } from '@/utils/splash';

type Choice = 'icloud' | 'pick' | 'device';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Android's two ways to sync, each a sync app that keeps a folder on the phone in step. */
const GUIDES = {
  cloud: {
    title: 'Google Drive, Dropbox or OneDrive',
    steps: [
      'Install FolderSync from Google Play. Autosync and Dropsync work too.',
      'In it, add your cloud account, then pair a new folder on this phone, such as Documents/VB Notes, with a folder in your drive. Choose two-way sync.',
      'Come back here and pick that folder on this phone.',
    ],
    app: { label: 'Get FolderSync', url: 'https://play.google.com/store/search?q=FolderSync&c=apps' },
    guide: 'https://vbnotes.com/docs/android-sync#google-drive-dropbox-or-onedrive',
  },
  syncthing: {
    title: 'Straight to your computer',
    steps: [
      'Install Syncthing-Fork on this phone and Syncthing on your computer. Both are free.',
      'Add each device to the other, then share a folder, such as Documents/VB Notes on this phone.',
      'Come back here and pick that folder. On your computer, open the same folder in the desktop app.',
    ],
    app: { label: 'Get Syncthing-Fork', url: 'https://play.google.com/store/search?q=Syncthing-Fork&c=apps' },
    guide: 'https://vbnotes.com/docs/android-sync#straight-to-your-computer',
  },
} as const;
type Guide = keyof typeof GUIDES;

// The guide open when the person left to install a sync app, so coming back lands on the same step.
const GUIDE_KEY = 'folderChoice.guide.v1';

/**
 * The first launch: where the notes live, asked before anything is written. On an iPhone iCloud
 * Drive comes first, so notes sync to the person's other devices and the Mac app without setup.
 * Android has no folder sync of its own, and Drive, Dropbox and OneDrive don't offer their folders
 * to the picker, so it walks through a sync app (FolderSync, Syncthing) that keeps a phone folder in step.
 */
export function FolderChoice() {
  const t = useTheme();
  useEffect(appReady, []);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<Choice | null>(null);
  const [cloud] = useState(canUseICloud);
  const [guide, setGuideState] = useState<Guide | null>(() => kvGetSync<Guide>(GUIDE_KEY));
  const setGuide = (g: Guide | null) => {
    setGuideState(g);
    void (g ? kvSet(GUIDE_KEY, g) : kvDel(GUIDE_KEY));
  };

  const choose = async (choice: Choice) => {
    if (busy) return;
    setBusy(choice);
    try {
      let vault: Vault | null = null;
      if (choice === 'device') vault = await chooseDeviceFolder();
      else {
        const picked = choice === 'icloud' ? await iCloudFolder() : await pickFolder();
        if (!picked && choice === 'icloud') {
          Alert.alert('iCloud Drive is not available', 'Sign in to iCloud and turn on iCloud Drive in the Settings app, or choose another place for now.');
        }
        if (picked) { await picked.remember(); vault = picked.vault; }
      }
      if (vault) {
        void kvDel(GUIDE_KEY);
        await useNotes.getState().startIn(vault);
      }
    } catch (e: any) {
      Alert.alert('Could not use that folder', String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const option = (onPress: () => void, icon: IconName, title: string, text: string, opts: { first?: boolean; off?: boolean; tag?: string; busy?: boolean } = {}) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: opts.off || !!busy }}
      disabled={opts.off || !!busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: t.colors.surface, borderColor: opts.first && !opts.off ? t.colors.volt : t.colors.border },
        pressed && styles.pressed,
        opts.off && styles.off,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: opts.first && !opts.off ? t.colors.volt : t.colors.surface2 }]}>
        <Ionicons name={icon} size={20} color={opts.first && !opts.off ? t.colors.onVolt : t.colors.text} />
      </View>
      <View style={styles.optionText}>
        <View style={styles.titleRow}>
          <Text style={[styles.optionTitle, { color: t.colors.text }]}>{title}</Text>
          {opts.tag && !opts.off ? <Text style={[styles.tag, { color: t.colors.textSecondary, borderColor: t.colors.border }]}>{opts.tag}</Text> : null}
        </View>
        <Text style={[styles.optionSub, { color: t.colors.textSecondary }]}>{text}</Text>
      </View>
      {opts.busy ? <ActivityIndicator color={t.colors.textMuted} /> : <Ionicons name="chevron-forward" size={18} color={t.colors.textMuted} />}
    </Pressable>
  );

  const root = [StyleSheet.absoluteFill, styles.root, { backgroundColor: t.colors.bg }];
  const pad = { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 };

  if (guide) {
    const g = GUIDES[guide];
    return (
      <ScrollView style={root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
        <Pressable accessibilityRole="button" onPress={() => setGuide(null)} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={20} color={t.colors.textSecondary} />
          <Text style={[styles.backText, { color: t.colors.textSecondary }]}>Other options</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: t.colors.text, marginTop: 28 }]}>{g.title}</Text>
        <View style={[styles.rule, { backgroundColor: t.colors.volt }]} />
        <View style={styles.steps}>
          {g.steps.map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={[styles.num, { backgroundColor: i === g.steps.length - 1 ? t.colors.volt : t.colors.surface2 }]}>
                <Text style={[styles.numText, { color: i === g.steps.length - 1 ? t.colors.onVolt : t.colors.text }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.stepText, { color: t.colors.text }]}>{step}</Text>
            </View>
          ))}
        </View>
        <View style={styles.links}>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(g.app.url)} style={({ pressed }) => [styles.secondary, { borderColor: t.colors.border, backgroundColor: t.colors.surface }, pressed && styles.pressed]}>
            <Ionicons name="logo-google-playstore" size={16} color={t.colors.text} />
            <Text style={[styles.secondaryText, { color: t.colors.text }]}>{g.app.label}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(g.guide)} style={({ pressed }) => [styles.secondary, { borderColor: t.colors.border, backgroundColor: t.colors.surface }, pressed && styles.pressed]}>
            <Ionicons name="images-outline" size={16} color={t.colors.text} />
            <Text style={[styles.secondaryText, { color: t.colors.text }]}>Guide with pictures</Text>
          </Pressable>
        </View>
        <Text style={[styles.note, { color: t.colors.textMuted }]}>Set it up and come back: VB Notes opens on this page until you have picked a folder.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={!!busy}
          onPress={() => void choose('pick')}
          style={({ pressed }) => [styles.primary, { backgroundColor: t.colors.volt }, pressed && styles.pressed]}
        >
          {busy === 'pick' ? <ActivityIndicator color={t.colors.onVolt} /> : <Text style={[styles.primaryText, { color: t.colors.onVolt }]}>Pick the synced folder</Text>}
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <View style={[root, pad]}>
      <Text accessibilityRole="header" style={[styles.title, { color: t.colors.text }]}>Where should your notes live?</Text>
      <View style={[styles.rule, { backgroundColor: t.colors.volt }]} />
      <Text style={[styles.lede, { color: t.colors.textSecondary }]}>
        Every note is a plain .md file in a folder. You can change this later in Settings.
      </Text>
      {Platform.OS === 'ios' ? (
        <View style={styles.options}>
          {option(() => void choose('icloud'), 'cloud-outline', 'iCloud Drive',
            cloud
              ? 'A VB Notes folder in your iCloud Drive. Notes stay in step on your iPhone and the Mac app.'
              : 'Sign in to iCloud and turn on iCloud Drive in the Settings app to use it.',
            { first: true, off: !cloud, tag: 'Recommended', busy: busy === 'icloud' })}
          {option(() => void choose('pick'), 'folder-open-outline', 'Choose a folder', 'One you already have, in iCloud Drive or another app in Files.', { busy: busy === 'pick' })}
          {option(() => void choose('device'), 'phone-portrait-outline', 'On this iPhone', 'Notes stay on this phone, in the Files app under On My iPhone.', { busy: busy === 'device' })}
        </View>
      ) : (
        <>
          <View style={styles.options}>
            {option(() => setGuide('cloud'), 'cloud-outline', 'Google Drive, Dropbox or OneDrive', 'Through a sync app such as FolderSync. Three steps, shown on the next page.', { first: true })}
            {option(() => setGuide('syncthing'), 'swap-horizontal-outline', 'Straight to your computer', 'Free with Syncthing, over your own Wi-Fi. No cloud in between.')}
            {option(() => void choose('device'), 'phone-portrait-outline', 'Only on this phone', 'Notes stay inside the app. You can set up sync later in Settings.', { busy: busy === 'device' })}
          </View>
          <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => void choose('pick')} hitSlop={8} style={styles.already}>
            <Text style={[styles.alreadyText, { color: t.colors.textSecondary }]}>Already have a synced folder? <Text style={{ color: t.colors.accent, fontWeight: '600' }}>Pick it</Text></Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 10, paddingHorizontal: 22 },
  content: { paddingHorizontal: 0 },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5, lineHeight: 35 },
  rule: { width: 44, height: 6, borderRadius: 3, marginTop: 14 },
  lede: { fontSize: 16, lineHeight: 23, marginTop: 16 },
  options: { gap: 12, marginTop: 32 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1.5 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionTitle: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  tag: { fontSize: 11, fontWeight: '600', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  optionSub: { fontSize: 14, lineHeight: 19 },
  already: { marginTop: 22, alignSelf: 'center' },
  alreadyText: { fontSize: 15 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginLeft: -6 },
  backText: { fontSize: 16 },
  steps: { gap: 18, marginTop: 28 },
  step: { flexDirection: 'row', gap: 14 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  numText: { fontSize: 14, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 16, lineHeight: 23 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28 },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  secondaryText: { fontSize: 15, fontWeight: '500' },
  note: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  primary: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  primaryText: { fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.55 },
});
