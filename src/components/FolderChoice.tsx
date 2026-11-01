import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { useNotes } from '@/store/notes';
import { canUseICloud, chooseDeviceFolder, iCloudFolder, pickFolder, type Vault } from '@/vault';

type Choice = 'icloud' | 'pick' | 'device';

/**
 * The first launch on an iPhone: where the notes live, asked before anything is written. iCloud
 * Drive comes first, so notes sync to the person's other devices and the Mac app without setup.
 */
export function FolderChoice() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<Choice | null>(null);
  const [cloud] = useState(canUseICloud);

  const choose = (choice: Choice) => async () => {
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
      if (vault) await useNotes.getState().startIn(vault);
    } catch (e: any) {
      Alert.alert('Could not use that folder', String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const option = (choice: Choice, icon: React.ComponentProps<typeof Ionicons>['name'], title: string, text: string, opts: { first?: boolean; off?: boolean } = {}) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: opts.off || !!busy }}
      disabled={opts.off || !!busy}
      onPress={() => void choose(choice)()}
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
          {opts.first && !opts.off ? <Text style={[styles.tag, { color: t.colors.textSecondary, borderColor: t.colors.border }]}>Recommended</Text> : null}
        </View>
        <Text style={[styles.optionSub, { color: t.colors.textSecondary }]}>{text}</Text>
      </View>
      {busy === choice ? <ActivityIndicator color={t.colors.textMuted} /> : <Ionicons name="chevron-forward" size={18} color={t.colors.textMuted} />}
    </Pressable>
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: t.colors.bg, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: t.colors.text }]}>Where should your notes live?</Text>
      <View style={[styles.rule, { backgroundColor: t.colors.volt }]} />
      <Text style={[styles.lede, { color: t.colors.textSecondary }]}>
        Every note is a plain .md file in a folder. You can change this later in Settings.
      </Text>
      <View style={styles.options}>
        {option('icloud', 'cloud-outline', 'iCloud Drive',
          cloud
            ? 'A VB Notes folder in your iCloud Drive. Notes stay in step on your iPhone and the Mac app.'
            : 'Sign in to iCloud and turn on iCloud Drive in the Settings app to use it.',
          { first: true, off: !cloud })}
        {option('pick', 'folder-open-outline', 'Choose a folder', 'One you already have, in iCloud Drive or another app in Files.')}
        {option('device', 'phone-portrait-outline', 'On this iPhone', 'Notes stay on this phone, in the Files app under On My iPhone.')}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 10, paddingHorizontal: 22 },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5, lineHeight: 35 },
  rule: { width: 44, height: 6, borderRadius: 3, marginTop: 14 },
  lede: { fontSize: 16, lineHeight: 23, marginTop: 16 },
  options: { gap: 12, marginTop: 32 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1.5 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionTitle: { fontSize: 17, fontWeight: '600' },
  tag: { fontSize: 11, fontWeight: '600', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  optionSub: { fontSize: 14, lineHeight: 19 },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.55 },
});
