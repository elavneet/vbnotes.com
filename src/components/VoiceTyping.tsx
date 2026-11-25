import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import {
  AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useTheme } from '@/theme';
import { useSettings } from '@/store/settings';
import { hear, loadSpeech, releaseSpeech, tidy } from '@/voice/engine';
import { SPEECH_SIZE, TIDY_SIZE, downloadVoiceModels, sizeText, useVoiceModels } from '@/voice/models';

const BARS = 32;
const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** What the speech model hears: 16 kHz mono, 16-bit, in a WAV file. */
const WAV: RecordingOptions = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  ios: { outputFormat: IOSOutputFormat.LINEARPCM, audioQuality: AudioQuality.HIGH, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  web: {},
};

type Props = { visible: boolean; onClose: () => void; onSaid: (said: string) => void };

/**
 * Voice typing: listens as soon as it opens, and the Volt button types what was said into the note,
 * cleaned up (Settings › Voice typing). The first time, it offers the models' download instead.
 * Everything runs on the phone. It exists only while open, like the voice note recorder.
 */
export function VoiceTyping(props: Props) {
  return props.visible ? <Sheet {...props} /> : null;
}

function Sheet({ onClose, onSaid }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tidyOn = useSettings((s) => s.voiceTidy);
  const models = useVoiceModels();
  const need = models.speech !== 'ready' || (tidyOn && models.tidy !== 'ready');
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<() => void>(() => {});
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => { if (!busy) { cancelRef.current(); onClose(); } }} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: t.colors.scrim, paddingBottom: insets.bottom + 10 }]}>
        <View style={[styles.card, { backgroundColor: t.colors.surface }]}>
          {need ? <Offer tidyOn={tidyOn} /> : <Listen tidyOn={tidyOn} onClose={onClose} onSaid={onSaid} onBusy={setBusy} cancelRef={cancelRef} />}
        </View>
        <Pressable
          disabled={busy}
          onPress={() => { cancelRef.current(); onClose(); }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cancel, { backgroundColor: pressed ? t.colors.surface2 : t.colors.surface }, busy && styles.dim]}
        >
          <Ionicons name="close" size={18} color={t.colors.textSecondary} />
          <Text style={[styles.cancelText, { color: t.colors.text }]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Offer({ tidyOn }: { tidyOn: boolean }) {
  const t = useTheme();
  const { speech, tidy: tidyState, progress, error } = useVoiceModels();
  const downloading = speech === 'downloading' || tidyState === 'downloading';
  const size = sizeText((speech === 'ready' ? 0 : SPEECH_SIZE) + (tidyOn && tidyState !== 'ready' ? TIDY_SIZE : 0));
  return (
    <>
      <Text style={[styles.title, { color: t.colors.text }]}>Voice typing</Text>
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>
        {downloading
          ? 'Keep VB Notes open until the download is done.'
          : `Talk, and VB Notes types it into the note${tidyOn ? ', without the um and uh' : ''}. The speech models run on this ${PHONE}, so nothing you say leaves it. It is a one-time ${size} download.`}
      </Text>
      {error && !downloading ? <Text style={[styles.hint, { color: t.colors.danger }]}>{error}</Text> : null}
      {downloading ? (
        <View style={styles.progress}>
          <View style={[styles.track, { backgroundColor: t.colors.border }]}>
            <View style={[styles.fill, { backgroundColor: t.colors.volt, width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={[styles.percent, { color: t.colors.textSecondary }]}>{Math.round(progress * 100)}%</Text>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => void downloadVoiceModels(tidyOn)} style={({ pressed }) => [styles.wide, { backgroundColor: t.colors.volt }, pressed && styles.pressed]}>
          <Text style={[styles.wideText, { color: t.colors.onVolt }]}>Download {size}</Text>
        </Pressable>
      )}
    </>
  );
}

const PHONE = 'iPhone';

function Listen({ tidyOn, onClose, onSaid, onBusy, cancelRef }: {
  tidyOn: boolean; onClose: () => void; onSaid: (said: string) => void; onBusy: (busy: boolean) => void; cancelRef: React.RefObject<() => void>;
}) {
  const t = useTheme();
  const recorder = useAudioRecorder(WAV);
  const state = useAudioRecorderState(recorder, 80);
  const [denied, setDenied] = useState(false);
  const [phase, setPhase] = useState<'listening' | 'writing' | 'cleaning'>('listening');
  const [problem, setProblem] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (!live) return;
      if (!perm.granted) { setDenied(true); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!live) return;
      recorder.record();
      // Loaded while the first words are said.
      loadSpeech().catch(() => {});
    })().catch((e) => { console.warn('voice typing could not listen', e); if (live) setProblem('The microphone could not be started.'); });
    return () => { live = false; };
  }, [recorder]);

  // Metering is dB (about -60 quiet … 0 loud); keep a short history for the bars.
  useEffect(() => {
    if (phase !== 'listening') return;
    const id = setInterval(() => {
      const { isRecording, metering } = recorder.getStatus();
      if (!isRecording || metering === undefined) return;
      const v = Math.min(1, Math.max(0.04, (metering + 55) / 55));
      setLevels((l) => [...l.slice(-(BARS - 1)), v]);
    }, 80);
    return () => clearInterval(id);
  }, [phase, recorder]);

  const stopRecording = async () => {
    if (recorder.isRecording) await recorder.stop();
    // Leave recording mode, or playback afterwards comes out of the earpiece.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  };

  // Discard: the microphone goes off and the model is let go.
  useEffect(() => {
    cancelRef.current = () => {
      void stopRecording().catch(() => {}).then(() => { if (recorder.uri) try { new File(recorder.uri).delete(); } catch {} });
      void releaseSpeech();
    };
  });

  const finish = async () => {
    if (phase !== 'listening') return;
    setPhase('writing');
    onBusy(true);
    let said = '';
    try {
      await stopRecording();
      if (!recorder.uri) throw new Error('nothing was recorded');
      said = await hear(recorder.uri);
      await releaseSpeech();
      if (said && tidyOn) {
        setPhase('cleaning');
        // What was heard is typed as it is if the clean-up fails.
        said = await tidy(said).catch((e) => { console.warn('voice clean-up failed', e); return said; });
      }
    } catch (e) {
      console.warn('voice typing failed', e);
      void releaseSpeech();
      setProblem(`Couldn’t write that down: ${e instanceof Error ? e.message : String(e)}.`);
      onBusy(false);
      return;
    } finally {
      if (recorder.uri) try { new File(recorder.uri).delete(); } catch {}
    }
    onBusy(false);
    if (!said) { setProblem('Didn’t catch anything.'); return; }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
    onSaid(said);
  };

  if (denied) {
    return (
      <>
        <Text style={[styles.title, { color: t.colors.text }]}>Microphone is off</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>Allow VB Notes to use the microphone in Settings to type with your voice.</Text>
        <Pressable onPress={() => void Linking.openSettings()} style={[styles.wide, { backgroundColor: t.colors.volt }]}>
          <Text style={[styles.wideText, { color: t.colors.onVolt }]}>Open Settings</Text>
        </Pressable>
      </>
    );
  }
  if (problem) return <Text style={[styles.hint, styles.problem, { color: t.colors.text }]}>{problem}</Text>;
  if (phase !== 'listening') {
    return (
      <View style={styles.writing}>
        <ActivityIndicator color={t.colors.textSecondary} />
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>{phase === 'cleaning' ? 'Cleaning it up…' : 'Writing it down…'}</Text>
      </View>
    );
  }
  const bars = [...Array(Math.max(0, BARS - levels.length)).fill(0.04), ...levels];
  return (
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
        accessibilityLabel="Stop and type it into the note"
        onPress={() => void finish()}
        style={({ pressed }) => [styles.stop, { backgroundColor: t.colors.volt }, pressed && styles.pressed]}
      >
        <Ionicons name="checkmark" size={34} color={t.colors.onVolt} />
      </Pressable>
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>Talk, then tap to type it into the note</Text>
    </>
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
  hint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  problem: { fontSize: 16, paddingVertical: 12 },
  writing: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  progress: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, height: 52 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  percent: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
  wide: { alignSelf: 'stretch', height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  wideText: { fontSize: 17, fontWeight: '700' },
  cancel: { width: '100%', maxWidth: 480, borderRadius: 20, minHeight: 56, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 17, fontWeight: '600' },
  dim: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.95 }], opacity: 0.9 },
});
