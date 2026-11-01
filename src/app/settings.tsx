import React, { useEffect, useState } from 'react';
import { Alert, BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CODE_FONTS, TEXT_FONTS, THEMES, codeFont, textFont, themeFor, useTheme, type ThemeName, type Typography } from '@/theme';
import { useSettings, type ThemePref } from '@/store/settings';
import { useNotes } from '@/store/notes';
import { semanticIndex } from '@/search';
import { SEARCH_MODELS, searchModel, type SearchModel } from '@/search/models';
import { downloadSizeMB } from '@/search/nativeEmbedder';
import { IconButton } from '@/components/IconButton';
import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { Segmented } from '@/components/Segmented';
import { LocalVault, SafVault, canUseICloud, chooseDeviceFolder, iCloudFolder, pickFolder } from '@/vault';
import { openRouterUsage, providerModels, useAi, useSpend } from '@/ai/chat';
import { formatCost, showsSpend, spentThisMonth, type KeyUsage } from '@/ai/spend';
import { PROVIDERS, chatModels, destinationOf, preferredModel, providerOf } from '@/ai/providers';
import { CONSENT_TEXT, CONSENT_TITLE } from '@/ai/prompt';
import { ModelPicker } from '@/components/ModelPicker';

type Page = 'main' | 'appearance' | 'typography' | 'folder' | 'hidden' | 'search' | 'ai';

export default function SettingsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const vault = useNotes((s) => s.vault);
  const vaultProblem = useNotes((s) => s.vaultProblem);
  const noteCount = useNotes((s) => s.counts.notes + s.counts.archive + s.counts.trash);
  const [switching, setSwitching] = useState(false);
  // A short list on top; each part of Settings opens on its own page.
  const [page, setPage] = useState<Page>('main');
  useEffect(() => {
    if (page === 'main') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPage('main'); return true; });
    return () => sub.remove();
  }, [page]);
  const hiddenTags = useNotes((s) => s.hiddenTags);
  const aiOn = useAi((s) => s.enabled);
  const aiProvider = useAi((s) => s.provider);
  const [, bump] = useState(0);
  useEffect(() => semanticIndex.subscribe(() => bump((n) => n + 1)), []);


  const emb = semanticIndex.embedderInfo;
  const status = semanticIndex.status;
  const model = searchModel(settings.searchModel);
  const [modelMenu, setModelMenu] = useState(false);
  const [fontMenu, setFontMenu] = useState<'text' | 'head' | 'code' | null>(null);
  const ty = settings.typography;
  const fontActions = (key: 'text' | 'head' | 'code'): SheetAction[] =>
    Object.entries(key === 'code' ? CODE_FONTS : TEXT_FONTS).map(([id, f]) => ({
      label: f.label,
      font: 'rn' in f ? f.rn : undefined,
      selected: ty[key] === id,
      onPress: () => settings.setTypography({ [key]: id } as Partial<Typography>),
    }));
  const [sizes, setSizes] = useState<Partial<Record<string, number>>>({});
  // Real download sizes, asked once the list opens.
  useEffect(() => {
    if (!modelMenu) return;
    for (const m of SEARCH_MODELS) {
      if (sizes[m.id] === undefined) void downloadSizeMB(m).then((mb) => setSizes((s) => ({ ...s, [m.id]: mb })));
    }
  }, [modelMenu, sizes]);
  const switchTo = async (next: LocalVault, remember: () => Promise<void>, copy: boolean) => {
    setSwitching(true);
    try {
      // A folder picked on Android takes files the Android way (`SafVault`).
      if (copy && vault instanceof LocalVault) {
        if (next instanceof SafVault) next.copyFrom(vault.root); else vault.copyInto(next.root);
      }
      await remember();
      await useNotes.getState().setVault(next);
    } catch (e: any) {
      Alert.alert('Could not switch folders', String(e?.message ?? e));
    } finally {
      setSwitching(false);
    }
  };
  const chooseFolder = async () => {
    let picked: Awaited<ReturnType<typeof pickFolder>>;
    try {
      picked = await pickFolder();
    } catch (e: any) {
      Alert.alert('Could not use that folder', String(e?.message ?? e));
      return;
    }
    if (picked) offerFolder(picked);
  };
  // iCloud Drive's own VB Notes folder, which the Mac app finds too.
  const chooseICloud = async () => {
    const picked = await iCloudFolder().catch(() => null);
    if (picked) offerFolder(picked);
    else Alert.alert('iCloud Drive is not available', 'Sign in to iCloud and turn on iCloud Drive in the Settings app.');
  };
  const offerFolder = ({ vault: next, remember }: { vault: LocalVault; remember: () => Promise<void> }) => {
    if (vault instanceof LocalVault && next.root.uri === vault.root.uri) return;
    Alert.alert(
      `Keep notes in ${next.label}?`,
      noteCount
        ? `Copy your ${noteCount} notes there, or open the folder as it is. The notes here stay where they are.`
        : 'New notes will be saved there.',
      [
        { text: 'Cancel', style: 'cancel' },
        ...(noteCount
          ? [
              { text: 'Open as it is', onPress: () => void switchTo(next, remember, false) },
              { text: `Copy ${noteCount} notes`, onPress: () => void switchTo(next, remember, true) },
            ]
          : [{ text: 'Use it', onPress: () => void switchTo(next, remember, false) }]),
      ],
    );
  };
  const backToDevice = () => {
    const toDevice = async (copy: boolean) => {
      setSwitching(true);
      try {
        const next = await chooseDeviceFolder();
        if (copy && vault instanceof LocalVault && next instanceof LocalVault) vault.copyInto(next.root);
        await useNotes.getState().setVault(next);
      } catch (e: any) {
        Alert.alert('Could not switch folders', String(e?.message ?? e));
      } finally {
        setSwitching(false);
      }
    };
    Alert.alert(
      'Use the folder on this device?',
      noteCount
        ? `Copy your ${noteCount} notes from ${vault?.label ?? 'that folder'} here, or use this device's folder as it is. The notes there stay where they are.`
        : `The notes in ${vault?.label ?? 'that folder'} stay there.`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(noteCount
          ? [
              { text: 'Use it as it is', onPress: () => void toDevice(false) },
              { text: `Copy ${noteCount} notes`, onPress: () => void toDevice(true) },
            ]
          : [{ text: 'Use this device', onPress: () => void toDevice(false) }]),
      ],
    );
  };

  const sizeOf = (m: SearchModel) => sizes[m.id] ?? m.approxMB;
  const progress = emb?.progress ?? 0;
  // Loading a downloaded model takes a few seconds more; that is not part of the download.
  const downloading = (status === 'loading' && progress < 100) || (status === 'error' && !!emb?.paused);
  const modelStatus =
    status === 'loading' ? (progress < 100 ? `Downloading ${progress}% of ${sizeOf(model)} MB` : 'Starting')
    : status === 'error' ? (emb?.paused ? `Paused at ${progress}%` : `Error: ${emb?.error}`)
    : status === 'unavailable' ? (emb?.reason ?? 'Unavailable')
    : status === 'ready' ? 'Ready'
    : 'Waiting';
  const pickModel = (m: SearchModel) => {
    if (m.id === model.id) return;
    Alert.alert(
      `Switch to ${m.name}?`,
      `This downloads the model and reads all your notes again. Until it is done, search matches words only. Keep VB Notes open while it downloads.\n\nDownload size: ${sizeOf(m)} MB`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'OK', onPress: () => settings.setSearchModel(m.id) },
      ],
    );
  };

  const smart = settings.searchMode === 'smart';
  const searchStatus =
    !smart ? 'Off'
    : status === 'ready' ? (semanticIndex.pending ? `Reading ${semanticIndex.pending} notes…` : `Ready · ${semanticIndex.indexed} notes`)
    : modelStatus;
  const searchFooter =
    !smart ? 'Meaning search is off. Turn it on in search.'
    : downloading ? 'Keep VB Notes open until the download finishes. If you leave, it carries on from there when you come back.'
    : `Runs on this phone; your notes never leave it. One download of about ${sizeOf(model)} MB.`;

  const titles: Record<Page, string> = { main: 'Settings', appearance: 'Appearance', typography: 'Typography', folder: 'Notes folder', hidden: 'Hide from Notes', search: 'Local search', ai: 'AI chat' };
  const modeLabel = settings.theme === 'system' ? 'System' : settings.theme === 'dark' ? 'Dark' : 'Light';
  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg, paddingTop: Platform.OS === 'ios' ? 0 : insets.top }]}>
      <View style={styles.top}>
        {page !== 'main' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Settings" onPress={() => setPage('main')} hitSlop={10} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={22} color={t.colors.accent} />
            <Text style={[styles.doneText, { color: t.colors.accent, fontWeight: '400' }]}>Settings</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.title, { color: t.colors.text }]}>{titles[page]}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
          <Text style={[styles.doneText, { color: t.colors.accent }]}>Done</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
      <ScrollView key={page} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {page === 'main' ? (
          <>
            <Section>
              <PickRow label="Appearance" value={modeLabel} hint="Light and dark themes" onPress={() => setPage('appearance')} />
              <PickRow label="Typography" value={`${textFont(ty.text).label}, ${ty.size} pt`} hint="Fonts and spacing" onPress={() => setPage('typography')} />
            </Section>
            <Section>
              <PickRow label="Notes folder" value={switching ? 'Switching…' : vault?.label ?? '…'} hint="Where your notes are kept" onPress={() => setPage('folder')} />
              <PickRow label="Hide from Notes" value={hiddenTags.length ? hiddenTags.map((h) => `#${h}`).join(', ') : 'None'} hint="Tags kept out of the Notes list" onPress={() => setPage('hidden')} />
            </Section>
            <Section>
              <PickRow label="Local search" value={smart ? (status === 'ready' && !semanticIndex.pending ? 'By meaning' : searchStatus) : 'Exact words'} hint="Search by meaning" onPress={() => setPage('search')} />
              <PickRow label="AI chat" value={aiOn ? providerOf(aiProvider).name : 'Off'} hint="Chat with AI about your notes" onPress={() => setPage('ai')} />
            </Section>
            <Section title="About">
              <Row label="Version" value={Constants.expoConfig?.version ?? '–'} />
            </Section>
          </>
        ) : null}

        {page === 'appearance' ? (
          <Section title="Mode" footer="System follows the phone: the light theme in light mode, the dark theme in dark mode.">
            <View style={styles.cell}>
              <Segmented<ThemePref> value={settings.theme} onChange={settings.setTheme} options={[['system', 'System'], ['dark', 'Dark'], ['light', 'Light']]} />
            </View>
            <ThemeRow name="light" />
            <ThemeRow name="dark" />
          </Section>
        ) : null}

        {page === 'typography' ? (
          <Section title="Fonts and spacing">
            <PickRow label="Text" value={textFont(ty.text).label} hint="Choose the font for text" onPress={() => setFontMenu('text')} />
            <PickRow label="Headings" value={textFont(ty.head).label} hint="Choose the font for headings" onPress={() => setFontMenu('head')} />
            <PickRow label="Code" value={codeFont(ty.code).label} hint="Choose the font for code" onPress={() => setFontMenu('code')} />
            <StepRow label="Text size" value={ty.size} min={13} max={24} step={1} onChange={(size) => settings.setTypography({ size })} />
            <StepRow label="Line height" value={ty.line} min={1.3} max={2} step={0.05} digits={2} onChange={(line) => settings.setTypography({ line })} />
            <StepRow label="Paragraph spacing" value={ty.para} min={0} max={1.5} step={0.25} digits={2} onChange={(para) => settings.setTypography({ para })} />
          </Section>
        ) : null}

        {page === 'folder' ? (
          <Section
            title="Location"
            footer={vaultProblem ?? (Platform.OS === 'ios'
              ? 'Notes in iCloud Drive are on all your devices and in the Mac app. They stay plain .md files.'
              : 'Pick a folder a sync app keeps up to date. Notes stay plain .md files.')}
            footerColor={vaultProblem ? t.colors.danger : undefined}
          >
            <PickRow label="Folder" value={switching ? 'Switching…' : vault?.label ?? '…'} hint="Choose the folder for your notes" disabled={switching} onPress={() => void chooseFolder()} />
            {vault?.kind !== 'icloud' && canUseICloud() ? <Action label="Use iCloud Drive" onPress={() => void chooseICloud()} disabled={switching} /> : null}
            {vault && vault.kind !== 'local' ? <Action label="Use the folder on this device" onPress={backToDevice} disabled={switching} /> : null}
          </Section>
        ) : null}

        {page === 'hidden' ? <HiddenTags /> : null}

        {page === 'search' ? (
          <Section title="Search by meaning" footer={searchFooter} footerColor={smart && downloading ? t.colors.text : undefined}>
            <PickRow label="Model" value={model.name} hint="Choose the search model" onPress={() => setModelMenu(true)} />
            <Row label="Status" value={searchStatus} />
          </Section>
        ) : null}

        {page === 'ai' ? <AiSection /> : null}
      </ScrollView>
      </KeyboardAvoidingView>
      <ActionSheet
        visible={!!fontMenu}
        onClose={() => setFontMenu(null)}
        title={fontMenu === 'head' ? 'Headings font' : fontMenu === 'code' ? 'Code font' : 'Text font'}
        actions={fontMenu ? fontActions(fontMenu) : []}
      />
      <ActionSheet
        visible={modelMenu}
        onClose={() => setModelMenu(false)}
        title="Search model"
        actions={SEARCH_MODELS.map((m) => ({
          label: m.name,
          detail: `${m.detail} ${sizeOf(m)} MB.`,
          selected: m.id === model.id,
          onPress: () => pickModel(m),
        }))}
      />
    </View>
  );
}

/**
 * Chat with AI (off until switched on): the provider, its API key (kept in the Keychain or the
 * Android keystore, never in the notes folder) and the model, picked from the provider's own list.
 */
function AiSection() {
  const t = useTheme();
  const ai = useAi();
  const [providerMenu, setProviderMenu] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState('');
  const p = providerOf(ai.provider);
  const canList = ai.enabled && (ai.hasKey || !p.needsKey) && !!(ai.baseUrl || p.base);
  const load = async () => {
    setLoading(true);
    setProblem(null);
    try {
      const ids = chatModels(await providerModels());
      setModels(ids);
      const now = useAi.getState();
      if (ids.length && (!now.model || !ids.includes(now.model))) now.save({ model: preferredModel(now.provider, ids) });
    } catch (e) {
      setModels(null);
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  // The list again whenever what it depends on changes.
  useEffect(() => {
    if (!canList) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [canList, ai.provider, ai.hasKey, ai.baseUrl]);
  const list = canList ? models : null;
  const saveKey = async (k: string) => { setKey(''); await ai.setKey(k); };
  // Explicit permission before any note can go to an AI provider (App Review 5.1.2).
  const askToTurnOn = () =>
    Alert.alert(CONSENT_TITLE, CONSENT_TEXT, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Turn on', onPress: () => ai.save({ enabled: true }) },
    ]);
  const footer = !ai.enabled
    ? 'Off: nothing is ever sent. Switched on, you can ask an AI about one note or all of them, with your own account at OpenRouter, OpenAI, Anthropic, Google and others.'
    : problem ?? `Ask about a note from its ⋮ menu, or about all notes from Search. Only what you ask about is sent, to ${destinationOf(ai.provider)}, and only when you ask.`;
  return (
    <>
      <Section footer={footer} footerColor={ai.enabled && problem ? t.colors.danger : undefined}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: t.colors.text }]}>Chat with AI</Text>
          <Switch value={ai.enabled} onValueChange={(enabled) => (enabled ? askToTurnOn() : ai.save({ enabled: false }))} trackColor={{ true: t.colors.volt, false: t.colors.surface2 }} thumbColor="#fff" accessibilityLabel="Chat with AI" />
        </View>
        {ai.enabled ? <PickRow label="Provider" value={p.name} hint="Choose the AI provider" onPress={() => setProviderMenu(true)} /> : null}
        {ai.enabled && p.address !== undefined ? (
          <View style={styles.row}>
            <Text style={[styles.label, { color: t.colors.text }]}>Address</Text>
            <TextInput
              key={ai.provider}
              defaultValue={ai.baseUrl}
              placeholder="https://…/v1"
              placeholderTextColor={t.colors.textMuted}
              selectionColor={t.colors.accent}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v !== ai.baseUrl) ai.save({ baseUrl: v }); }}
              style={[styles.input, styles.right, { color: t.colors.text }]}
              accessibilityLabel="Server address"
            />
          </View>
        ) : null}
        {ai.enabled ? (
          <View style={styles.row}>
            <Text style={[styles.label, { color: t.colors.text }]}>API key</Text>
            <TextInput
              value={key}
              onChangeText={setKey}
              onSubmitEditing={() => { if (key.trim()) void saveKey(key); }}
              placeholder={ai.hasKey ? 'Saved' : 'Paste your key'}
              placeholderTextColor={t.colors.textMuted}
              selectionColor={t.colors.accent}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              style={[styles.input, styles.right, { color: t.colors.text }]}
              accessibilityLabel="API key"
            />
            {key.trim() ? (
              <Pressable accessibilityRole="button" onPress={() => void saveKey(key)} hitSlop={8}>
                <Text style={[styles.label, { color: t.colors.accent, fontWeight: '600' }]}>Save</Text>
              </Pressable>
            ) : ai.hasKey ? (
              <Pressable accessibilityRole="button" onPress={() => void saveKey('')} hitSlop={8}>
                <Text style={[styles.label, { color: t.colors.danger }]}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {ai.enabled ? (
          <PickRow
            label="Model"
            value={loading ? 'Loading…' : ai.model || (canList ? 'Choose' : p.needsKey && !ai.hasKey ? 'Add a key first' : 'Add the address first')}
            hint="Choose the model"
            disabled={!canList}
            onPress={() => (list?.length ? setModelMenu(true) : void load())}
          />
        ) : null}
        {ai.enabled && p.keyUrl ? <Action label={`Get a key from ${p.name}`} onPress={() => void Linking.openURL(p.keyUrl!)} /> : null}
      </Section>
      {ai.enabled && showsSpend(ai.provider) && ai.hasKey ? <SpendSection /> : null}
      <ActionSheet
        visible={providerMenu}
        onClose={() => setProviderMenu(false)}
        title="AI provider"
        actions={PROVIDERS.filter((x) => !x.desktopOnly).map((x) => ({
          label: x.name,
          selected: x.id === p.id,
          onPress: () => { setModels(null); ai.save({ provider: x.id, model: '', baseUrl: x.address ?? '' }); },
        }))}
      />
      <ModelPicker visible={modelMenu} models={list ?? []} value={ai.model} onPick={(model) => ai.save({ model })} onClose={() => setModelMenu(false)} />
    </>
  );
}

/** What OpenRouter answers have cost: this phone this month (exact, from each reply), and the key's own totals. */
function SpendSection() {
  const spend = useSpend((s) => s.spend);
  const [usage, setUsage] = useState<KeyUsage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    openRouterUsage().then((u) => { if (live) setUsage(u); }, (e) => { if (live) setProblem(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);
  return (
    <Section title="Spending" footer={problem ?? "OpenRouter reports what each answer costs. The key's totals include any other apps that use the same key."}>
      <Row label="In VB Notes this month" value={formatCost(spentThisMonth(spend))} />
      <Row label="Key this month" value={usage ? formatCost(usage.month) : '…'} />
      <Row label="Key in total" value={usage ? formatCost(usage.total) : '…'} />
      {usage?.left !== null && usage?.left !== undefined ? <Row label="Left on the key" value={formatCost(usage.left)} /> : null}
    </Section>
  );
}

/** Tags kept out of the main Notes list; their notes show when the tag is picked in the library. */
function HiddenTags() {
  const t = useTheme();
  const hidden = useNotes((s) => s.hiddenTags);
  const setHiddenTags = useNotes((s) => s.setHiddenTags);
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    void setHiddenTags([...hidden, draft]);
    setDraft('');
  };
  return (
    <Section
      title="Tags"
      footer="Notes with these tags stay out of Notes, at any level: melta hides #melta and #go2lister/melta. Pick the tag in the library to see them."
    >
      {hidden.map((name) => (
        <View key={name} style={[styles.row, styles.stepRow]}>
          <Text style={[styles.label, { color: t.colors.text }]}>#{name}</Text>
          <IconButton name="close-circle" size={20} color={t.colors.textMuted} label={`Show #${name} in Notes again`} onPress={() => void setHiddenTags(hidden.filter((h) => h !== name))} />
        </View>
      ))}
      <View style={styles.row}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder="Add a tag, like melta"
          placeholderTextColor={t.colors.textMuted}
          selectionColor={t.colors.accent}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Tag to hide from Notes"
          style={[styles.input, { color: t.colors.text }]}
        />
        {draft.trim() ? (
          <Pressable accessibilityRole="button" onPress={add} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={[styles.label, { color: t.colors.accent, fontWeight: '600' }]}>Hide</Text>
          </Pressable>
        ) : null}
      </View>
    </Section>
  );
}

/** An inset group of rows with hairlines between them, and an optional note under it. */
function Section({ title, footer, footerColor, children }: { title?: string; footer?: string; footerColor?: string; children: React.ReactNode }) {
  const t = useTheme();
  const rows = React.Children.toArray(children);
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.sectionTitle, { color: t.colors.textMuted }]}>{title}</Text> : null}
      <View style={[styles.card, { backgroundColor: t.colors.surface }]}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={[styles.sep, { backgroundColor: t.colors.border }]} /> : null}
            {row}
          </React.Fragment>
        ))}
      </View>
      {footer ? <Text style={[styles.footer, { color: footerColor ?? t.colors.textMuted }]}>{footer}</Text> : null}
    </View>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: t.colors.text }]}>{label}</Text>
      <Text numberOfLines={2} selectable style={[styles.value, { color: t.colors.textSecondary }]}>{value}</Text>
    </View>
  );
}
/** One kind's themes as swatches to scroll through; the chosen one is ringed. */
const SWATCH = 76;
const SWATCH_GAP = 10;
function ThemeRow({ name }: { name: ThemeName }) {
  const t = useTheme();
  const settings = useSettings();
  const chosen = themeFor(name, name === 'light' ? settings.lightTheme : settings.darkTheme).id;
  const themes = THEMES.filter((th) => th.name === name);
  const at = Math.max(0, themes.findIndex((th) => th.id === chosen) - 1);
  const pick = (id: string) => {
    settings.setThemeFor(name, id);
    // A fixed mode of the other kind would hide the choice.
    if (settings.theme !== 'system' && settings.theme !== name) settings.setTheme(name);
  };
  return (
    <View style={styles.themes}>
      <Text style={[styles.label, styles.themesLabel, { color: t.colors.text }]}>{name === 'light' ? 'Light theme' : 'Dark theme'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentOffset={{ x: at * (SWATCH + SWATCH_GAP), y: 0 }} contentContainerStyle={styles.swatches}>
        {themes.map((th) => {
          const on = th.id === chosen;
          return (
            <Pressable key={th.id} accessibilityRole="button" accessibilityLabel={th.label} accessibilityState={{ selected: on }} onPress={() => pick(th.id)} style={({ pressed }) => [styles.swatchItem, pressed && styles.pressed]}>
              <View style={[styles.swatch, { backgroundColor: th.colors.bg, borderColor: on ? (t.name === 'dark' ? t.colors.volt : t.colors.accent) : th.colors.border, borderWidth: on ? 2 : 1 }]}>
                <Text style={[styles.swatchText, { color: th.colors.text }]}>Aa</Text>
                <View style={styles.dots}>
                  <View style={[styles.dot, { backgroundColor: th.colors.accent }]} />
                  <View style={[styles.dot, { backgroundColor: th.colors.volt }]} />
                </View>
              </View>
              <Text numberOfLines={2} style={[styles.swatchName, { color: on ? t.colors.text : t.colors.textSecondary, fontWeight: on ? '600' : '400' }]}>{th.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
/** A setting changed in steps: minus, the value, plus. */
function StepRow({ label, value, min, max, step, digits = 0, onChange }: {
  label: string; value: number; min: number; max: number; step: number; digits?: number; onChange: (v: number) => void;
}) {
  const t = useTheme();
  const go = (dir: number) => onChange(Math.min(max, Math.max(min, Math.round((value + dir * step) * 100) / 100)));
  return (
    <View style={[styles.row, styles.stepRow]}>
      <Text style={[styles.label, { color: t.colors.text }]}>{label}</Text>
      <View style={styles.stepper}>
        <IconButton name="remove" size={20} label={`Less ${label.toLowerCase()}`} disabled={value <= min} onPress={() => go(-1)} />
        <Text style={[styles.value, styles.size, { color: t.colors.textSecondary }]}>{value.toFixed(digits)}</Text>
        <IconButton name="add" size={20} label={`More ${label.toLowerCase()}`} disabled={value >= max} onPress={() => go(1)} />
      </View>
    </View>
  );
}
/** A row that opens a choice: the current value and a chevron. */
function PickRow({ label, value, hint, onPress, disabled }: { label: string; value: string; hint: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.surface2 }, disabled && styles.pressed]}
    >
      <Text style={[styles.label, { color: t.colors.text }]}>{label}</Text>
      <View style={styles.pick}>
        <Text numberOfLines={1} style={[styles.value, { color: t.colors.textSecondary }]}>{value}</Text>
        <Ionicons name="chevron-forward" size={16} color={t.colors.textMuted} />
      </View>
    </Pressable>
  );
}
function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.surface2 }, disabled && styles.pressed]}
    >
      <Text style={[styles.label, { color: t.colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { height: 56, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  done: { position: 'absolute', right: 16, height: 44, justifyContent: 'center' },
  back: { position: 'absolute', left: 8, height: 44, flexDirection: 'row', alignItems: 'center' },
  doneText: { fontSize: 17, fontWeight: '600' },
  section: { paddingHorizontal: 16, paddingTop: 22 },
  sectionTitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginLeft: 16, marginBottom: 7 },
  card: { borderRadius: 14, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  cell: { paddingHorizontal: 12, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  stepRow: { paddingVertical: 2, paddingRight: 6 },
  label: { fontSize: 16 },
  input: { flex: 1, fontSize: 16, paddingVertical: 4 },
  right: { textAlign: 'right' },
  value: { fontSize: 16, flexShrink: 1, textAlign: 'right' },
  footer: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingTop: 8 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  size: { minWidth: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
  themes: { paddingTop: 12, paddingBottom: 14, gap: 10 },
  themesLabel: { paddingHorizontal: 16 },
  swatches: { paddingHorizontal: 16, gap: SWATCH_GAP },
  swatchItem: { width: SWATCH, gap: 6 },
  swatch: { height: 58, borderRadius: 12, padding: 8, justifyContent: 'space-between' },
  swatchText: { fontSize: 19, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  swatchName: { fontSize: 12, lineHeight: 15, textAlign: 'center' },
  pressed: { opacity: 0.5 },
});
