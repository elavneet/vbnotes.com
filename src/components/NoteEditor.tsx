import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  CustomKeyboard, EditorKeyboardAvoidingView, PlaceholderBridge, RichText, TenTapStartKit, useEditorBridge, useKeyboard, type EditorBridge,
} from '@10play/tentap-editor';
import { useSettings } from '@/store/settings';
import { useNotes } from '@/store/notes';
import { useUi } from '@/store/ui';
import { fonts, typographyKey, useTheme, type Theme, type Typography } from '@/theme';
import { editorHtml } from '@/editor/editorHtml';
import { editorCss } from '@/editor/editorCss';
import { MarkdownBridge, markdownListeners } from '@/editor/markdownBridge';
import { MediaAction, MediaBridge, mediaHost } from '@/editor/mediaBridge';
import { LinkOpenBridge, linkHost } from '@/editor/linkBridge';
import { EditBridge } from '@/editor/editBridge';
import { WikiBridge, wikiHost } from '@/editor/wikiBridge';
import { openableUrl } from '@/utils/links';
import { probe, release, seek, toggle } from '@/media/player';
import { EditorToolbar } from './EditorToolbar';
import { FormatActions, FormatKeyboard } from './FormatKeyboard';
import { NotePreview } from './NotePreview';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { VoiceRecorder } from './VoiceRecorder';
import { pickAudioFile, pickPhotos, takePhoto } from '@/media/attachments';

const WEBVIEW_ORIGINS = ['about:*', 'file://*'];
const KEYBOARDS = [FormatKeyboard];

/** Quiet time after the last keystroke before the file is written. */
const SAVE_DEBOUNCE_MS = 1000;

type Props = {
  path: string;
  autofocus?: boolean;
  /** A note just made with the pencil: caret goes to the empty title. */
  isNew?: boolean;
  onPathChange?: (next: string) => void;
  toolbarPlacement?: 'bottom' | 'top';
  /** Set to the live editor while it is open (the info sheet reads and steers it). */
  editorRef?: React.MutableRefObject<EditorBridge | null>;
};

/**
 * The markdown WYSIWYG editor for one note. The text is known before the
 * WebView is created, so it ships inside the page with the theme CSS and the
 * first frame already shows the styled note (no empty-editor flash).
 */
export function NoteEditor(props: Props) {
  const t = useTheme();
  const [text, setText] = useState<{ path: string; md: string | null } | null>(() => {
    const md = useNotes.getState().getText(props.path);
    return md === undefined ? null : { path: props.path, md };
  });
  useEffect(() => {
    if (text?.path === props.path) return;
    let cancelled = false;
    useNotes.getState().loadText(props.path)
      .then((md) => { if (!cancelled) setText({ path: props.path, md }); })
      .catch(() => { if (!cancelled) setText({ path: props.path, md: null }); });
    return () => { cancelled = true; };
  }, [props.path, text?.path]);

  if (!text || text.path !== props.path) return <View style={[styles.root, { backgroundColor: t.colors.bg }]} />;
  if (text.md === null) {
    return (
      <View style={[styles.root, styles.missing, { backgroundColor: t.colors.bg }]}>
        <Text style={[styles.missingText, { color: t.colors.textMuted, fontFamily: fonts.regular }]}>
          This note was moved, renamed or deleted.
        </Text>
      </View>
    );
  }
  return <LoadedEditor key={text.path} {...props} initial={text.md} />;
}

/** Editor HTML with the theme baked in, cached per theme and type settings (the bundle is ~800 KB). */
const pageCache = new Map<string, string>();
const pageKey = (t: Theme, ty: Typography) => `${t.id}:${typographyKey(ty)}`;
function themedPage(t: Theme, ty: Typography) {
  const key = pageKey(t, ty);
  let html = pageCache.get(key);
  if (!html) {
    const style = `<style data-tag="vbnotes-theme">${editorCss(t, ty)}</style>`;
    html = editorHtml.replace('</head>', `${style}</head>`);
    pageCache.clear();
    pageCache.set(key, html);
  }
  return html;
}

const MEDIA_LINK = /!\[[^\]]*\]\(([^)\s]+)/g;

/** The pictures and sounds a note links to, as paths in the notes folder. */
function mediaPaths(md: string): string[] {
  const out: string[] = [];
  for (const [, src] of md.matchAll(MEDIA_LINK)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
    let path = src;
    try { path = decodeURIComponent(src); } catch {}
    out.push(path.replace(/^\.?\//, ''));
  }
  return out;
}

/** Re-renders only when readiness or focus flips, not on every keystroke's state update. */
function useEditorFlags(editor: EditorBridge) {
  const pick = (s: any) => ({ isReady: !!s?.isReady, isFocused: !!s?.isFocused });
  const [flags, setFlags] = useState(() => pick(editor.getEditorState()));
  useEffect(() => {
    const sync = (s: any) => setFlags((prev) => {
      const next = pick(s);
      return prev.isReady === next.isReady && prev.isFocused === next.isFocused ? prev : next;
    });
    sync(editor.getEditorState());
    return editor._subscribeToEditorStateUpdate(sync);
  }, [editor]);
  return flags;
}

/** The note a `[[link]]` names (in Notes or Archive), or a new one titled so. */
async function openLinked(title: string, wide: boolean) {
  const { db, createNote } = useNotes.getState();
  const found = db?.titles(title, 5).find((n) => n.title.toLowerCase() === title.toLowerCase());
  const path = found?.path ?? await createNote(`# ${title}\n\n`);
  if (wide) useUi.getState().select(path);
  else router.push({ pathname: '/note/[id]', params: { id: encodeURIComponent(path), ...(found ? {} : { new: '1' }) } });
}

function LoadedEditor({ path, initial, autofocus, isNew, onPathChange, toolbarPlacement = 'bottom', editorRef }: Props & { initial: string }) {
  const t = useTheme();
  const ty = useSettings((s) => s.typography);
  const saveNote = useNotes((s) => s.saveNote);
  const syncTitle = useNotes((s) => s.syncTitle);
  const { isKeyboardUp } = useKeyboard();

  const bridges = useMemo(() => [...TenTapStartKit, PlaceholderBridge.configureExtension({ placeholder: 'Start writing…' }), MarkdownBridge, MediaBridge, LinkOpenBridge, EditBridge, WikiBridge], []);
  // Fixed for the life of this editor; later theme changes go through injectCSS. A folder picked on
  // Android first puts the note's pictures where the page can load them (`prepareMedia`).
  const [page] = useState(() => {
    useNotes.getState().vault?.prepareMedia?.(mediaPaths(initial));
    return { html: themedPage(t, ty), key: pageKey(t, ty) };
  });
  // The newest markdown the page sent (see `markdownListeners`), saved 1 s after typing stops.
  const latest = useRef({ path, dirty: false, md: initial });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditorBridge({
    customSource: page.html,
    // Links like `attachments/x.jpg` resolve against the vault folder.
    webviewBaseURL: useNotes.getState().vault?.baseUrl,
    initialContent: initial,
    bridgeExtensions: bridges,
    autofocus: false,
    avoidIosKeyboard: true,
    dynamicHeight: false,
    // Tentap's own selection tint rewraps the selected text on every change, which breaks
    // dragging the selection handles; the native selection (Volt `::selection`) is enough.
    disableColorHighlight: true,
    theme: { webview: { backgroundColor: t.colors.bg } } as any,
  });
  const { isReady, isFocused } = useEditorFlags(editor);
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => { editorRef.current = null; };
  }, [editor, editorRef]);

  // Writes the markdown already in hand: asking the page here failed when it was being torn down.
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const state = latest.current;
    if (!state.dirty) return;
    state.dirty = false;
    try {
      await saveNote(state.path, state.md);
    } catch (e) {
      state.dirty = true;
      console.warn('save failed', e);
    }
  }, [saveNote]);
  useEffect(() => {
    markdownListeners.set(editor, (md) => {
      latest.current.md = md;
      latest.current.dirty = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    });
    return () => { markdownListeners.delete(editor); };
  }, [editor, flush]);

  // Fade in once the editor exists; the content is already rendered by then.
  const [opacity] = useState(() => new Animated.Value(0));
  // Native drawing of the note shown while the WebView boots, so the slide-in is never empty.
  const [previewOn, setPreviewOn] = useState(true);
  useEffect(() => {
    if (!isReady) return;
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true })
      .start(() => setPreviewOn(false));
    if (!autofocus) return;
    // A note made from the finder has its title and ends in an empty line: the caret goes there.
    const titled = isNew && /^#\s+\S/.test(initial);
    const id = setTimeout(() => {
      editor.focus(isNew && !titled ? 'start' : 'end');
      // Every new note starts with a title line.
      if (isNew && !initial.trim()) setTimeout(() => editor.toggleHeading(1), 60);
    }, 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // Theme or type changed while open.
  useEffect(() => {
    if (isReady && pageKey(t, ty) !== page.key) editor.injectCSS(editorCss(t, ty), 'vbnotes-theme');
  }, [t, ty, isReady, editor, page.key]);

  // Audio rows in the page play through the app; leaving the note stops the sound.
  useEffect(() => {
    const base = useNotes.getState().vault?.baseUrl ?? '';
    const url = (src: string) => (/^[a-z][a-z0-9+.-]*:/i.test(src) ? src : base + src.replace(/^\.?\//, ''));
    mediaHost.handle = (m, report) => {
      const { src } = m.payload;
      if (m.type === MediaAction.Toggle) toggle(src, url(src), report);
      else if (m.type === MediaAction.Seek) seek(src, url(src), m.payload.fraction, report);
      else probe(src, url(src), report);
    };
    return () => { mediaHost.handle = undefined; release(); };
  }, []);

  // Links tapped in the page open in the browser (or mail, phone…).
  useEffect(() => {
    linkHost.open = (href) => {
      const url = openableUrl(href);
      if (url) Linking.openURL(url).catch((e) => console.warn('opening link failed', e));
    };
    return () => { linkHost.open = undefined; };
  }, []);

  // `[[` lists notes by title; a `[[link]]` opens its note, or makes one with that title, as in Bear.
  useEffect(() => {
    wikiHost.find = (q) => (useNotes.getState().db?.titles(q, 8) ?? []).map((n) => ({ title: n.title, path: n.path }));
    wikiHost.open = (title) => void openLinked(title, toolbarPlacement === 'top');
    return () => { wikiHost.find = undefined; wikiHost.open = undefined; };
  }, [toolbarPlacement]);

  // Going to the background: write now, the app may not come back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') void flush(); });
    return () => sub.remove();
  }, [flush]);

  // Leaving the note: save what is pending, then rename the file after the title.
  useEffect(() => {
    const state = latest.current;
    return () => {
      const p = state.path;
      const finish = () => void syncTitle(p).then((next) => { if (next !== p) onPathChange?.(next); });
      void flush().then(finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The format keyboard in place of the system one, or undefined.
  const [keyboard, setKeyboard] = useState<string>();
  const toolbarVisible = isFocused || isKeyboardUp || !!keyboard;
  // Height of the toolbar and keyboard at the bottom. The text ends above them, so dragging a
  // selection handle there scrolls the note instead of selecting text hidden underneath.
  const [covered, setCovered] = useState(0);
  const toggleFormat = () => {
    // Focusing the editor is what brings the system keyboard back.
    if (keyboard) editor.focus();
    setKeyboard(keyboard ? undefined : FormatKeyboard.id);
  };
  const [attach, setAttach] = useState(false);
  const [recording, setRecording] = useState(false);
  const formatActions = useMemo(() => ({ attach: () => setAttach(true), record: () => setRecording(true) }), []);
  const insert = (paths: (string | null)[]) => { for (const p of paths) if (p) editor.setImage(p); };
  // The pickers are native screens; give the sheet time to leave first or iOS refuses to show them.
  const after = (run: () => Promise<(string | null)[]>) => () => setTimeout(() => {
    run().then(insert).catch((e) => console.warn('adding media failed', e));
  }, 350);
  const attachActions: SheetAction[] = [
    { label: 'Photo library', icon: 'images-outline', onPress: after(pickPhotos) },
    { label: 'Take photo', icon: 'camera-outline', onPress: after(async () => [await takePhoto()]) },
    { label: 'Record audio', icon: 'mic-outline', onPress: () => setTimeout(() => setRecording(true), 350) },
    { label: 'Audio file', icon: 'musical-notes-outline', onPress: after(async () => [await pickAudioFile()]) },
  ];

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      {toolbarPlacement === 'top' ? <EditorToolbar editor={editor} compact formatOpen={!!keyboard} onFormat={toggleFormat} onAttach={() => setAttach(true)} /> : null}
      <View style={[styles.root, { marginBottom: covered }]}>
        {previewOn ? <NotePreview md={initial} t={t} ty={ty} /> : null}
        <Animated.View style={[styles.root, { opacity }]}>
          {/* The page's base URL is the vault folder: keep that load inside the WebView (web links still open outside). */}
          <RichText
            editor={editor}
            style={{ backgroundColor: t.colors.bg }}
            originWhitelist={WEBVIEW_ORIGINS}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowingReadAccessToURL={useNotes.getState().vault?.baseUrl}
          />
        </Animated.View>
      </View>
      <EditorKeyboardAvoidingView style={styles.kav} pointerEvents="box-none" onLayout={(e) => setCovered(Math.round(e.nativeEvent.layout.height))}>
        {toolbarPlacement === 'bottom' && toolbarVisible ? (
          <EditorToolbar editor={editor} keyboardUp={isKeyboardUp} formatOpen={!!keyboard} onFormat={toggleFormat} onAttach={() => setAttach(true)} />
        ) : null}
        <FormatActions.Provider value={formatActions}>
          {/* As in Bear, tapping or selecting text keeps the format keyboard; ABC brings the letters back. */}
          <CustomKeyboard
            editor={editor}
            keyboards={KEYBOARDS}
            activeKeyboardID={keyboard}
            setActiveKeyboardID={setKeyboard}
            closeOnEditorPress={false}
            rootBackground={t.colors.kbBg}
          />
        </FormatActions.Provider>
      </EditorKeyboardAvoidingView>
      <ActionSheet visible={attach} onClose={() => setAttach(false)} actions={attachActions} title="Add to note" />
      <VoiceRecorder visible={recording} onClose={() => setRecording(false)} onDone={(p) => insert([p])} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  missing: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  missingText: { fontSize: 16, textAlign: 'center' },
  kav: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
