import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { useTheme } from '@/theme';
import { saveFile } from '@/media/attachments';

const BARS = 32;
const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Records as soon as it opens; Done saves the clip to `attachments/` and hands back its path. */
export function VoiceRecorder({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (path: string) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 80);
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (!live) return;
      if (!perm.granted) { setDenied(true); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (live) recorder.record();
    })().catch((e) => console.warn('recording failed', e));
    return () => { live = false; };
  }, [visible, recorder]);

  // Metering is dB (about -60 quiet … 0 loud); keep a short history for the bars.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      const { isRecording, metering } = recorder.getStatus();
      if (!isRecording || metering === undefined) return;
      const v = Math.min(1, Math.max(0.04, (metering + 55) / 55));
      setLevels((l) => [...l.slice(-(BARS - 1)), v]);
    }, 80);
    return () => clearInterval(id);
  }, [visible, recorder]);

  const finish = async (keep: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      if (recorder.isRecording) await recorder.stop();
      // Leave recording mode, or playback afterwards comes out of the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (keep && recorder.uri) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone(await saveFile(recorder.uri, 'm4a'));
      }
    } catch (e) {
      console.warn('saving the recording failed', e);
    } finally {
      setSaving(false);
      setLevels([]);
      setDenied(false);
      onClose();
    }
  };

  const bars = [...Array(Math.max(0, BARS - levels.length)).fill(0.04), ...levels];
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={() => void finish(false)} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: t.colors.scrim, paddingBottom: insets.bottom + 10 }]}>
        <View style={[styles.card, { backgroundColor: t.colors.surface }]}>
          {denied ? (
            <>
              <Text style={[styles.title, { color: t.colors.text }]}>Microphone is off</Text>
              <Text style={[styles.hint, { color: t.colors.textMuted }]}>Allow VB Notes to use the microphone in Settings to record voice notes.</Text>
              <Pressable onPress={() => void Linking.openSettings()} style={[styles.wide, { backgroundColor: t.colors.volt }]}>
                <Text style={[styles.wideText, { color: t.colors.onVolt }]}>Open Settings</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.titleRow}>
                <View style={[styles.dot, { backgroundColor: state.isRecording ? t.colors.danger : t.colors.textMuted }]} />
                <Text style={[styles.time, { color: t.colors.text }]}>{fmt(state.durationMillis)}</Text>
              </View>
              <View style={styles.meter} accessibilityElementsHidden>
                {bars.map((v, i) => (
                  <View key={i} style={[styles.bar, { height: 4 + v * 44, backgroundColor: i >= BARS - levels.length ? t.colors.volt : t.colors.border }]} />
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop and add to note"
                disabled={saving}
                onPress={() => void finish(true)}
                style={({ pressed }) => [styles.stop, { backgroundColor: t.colors.volt }, pressed && styles.pressed]}
              >
                <View style={[styles.square, { backgroundColor: t.colors.onVolt }]} />
              </Pressable>
              <Text style={[styles.hint, { color: t.colors.textMuted }]}>Tap to stop and add it to the note</Text>
            </>
          )}
        </View>
        <Pressable onPress={() => void finish(false)} accessibilityRole="button" style={({ pressed }) => [styles.cancel, { backgroundColor: pressed ? t.colors.surface2 : t.colors.surface }]}>
          <Ionicons name="close" size={18} color={t.colors.textSecondary} />
          <Text style={[styles.cancelText, { color: t.colors.text }]}>{denied ? 'Close' : 'Discard'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 10, gap: 8 },
  card: { width: '100%', maxWidth: 480, borderRadius: 24, alignItems: 'center', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  time: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700' },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 52 },
  bar: { width: 4, borderRadius: 2 },
  stop: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  square: { width: 24, height: 24, borderRadius: 6 },
  hint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  wide: { alignSelf: 'stretch', height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  wideText: { fontSize: 17, fontWeight: '700' },
  cancel: { width: '100%', maxWidth: 480, borderRadius: 20, minHeight: 56, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 17, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.95 }], opacity: 0.9 },
});
