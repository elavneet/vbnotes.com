/**
 * tentap's web side, built from its sources rather than its prebuilt bundle, and without React.
 *
 * The prebuilt bundle (`@10play/tentap-editor/web`) carried its own copy of TipTap and
 * ProseMirror next to the one our extensions use, and React only to host the editor. Taken from
 * the sources, everything shares one TipTap; `startTenTap` does what tentap's `useTenTap` hook
 * does, with plain calls. The editor page is about half the size, and a note opens that much faster.
 * Vite points `@10play/tentap-editor` here for this page (`vite.config.ts`).
 */
import { Editor, type EditorEvents, type EditorOptions } from '@tiptap/core';
import type BridgeExtension from 'tentap-src/bridges/base';
import { CoreEditorActionType } from 'tentap-src/bridges/core';
import { blueBackgroundPlugin } from 'tentap-src/bridges/HighlightSelection';
import { PROTOCOL_TYPES } from 'tentap-src/shared/protocol';
import type { EditorMessage } from 'tentap-src/types/Messaging';
import { keepSelectionThroughCollapse } from 'tentap-src/web/collapsedFocus';
import { DynamicHeight, createDynamicHeightExtension } from 'tentap-src/web/dynamicHeight';
import { resolveBridgeExtensions, selectActiveBridges, selectHandlerBridges } from 'tentap-src/web/extensions';
import { getFocusTracker } from 'tentap-src/web/focus';
import { keepStoredMarksOffRecomposition } from 'tentap-src/web/imeRecomposition';
import { revealSelectionOnImageLoad, revealSelectionOnViewportShrink } from 'tentap-src/web/revealSelection';
import { boot, sendMessage as postToNative } from 'tentap-src/web/runtime';
import { holdScrollOnKeyboardClose } from 'tentap-src/web/scrollHold';
import { createStatePublisher } from 'tentap-src/web/statePublisher';
import { DYNAMIC_HEIGHT_CSS, DYNAMIC_HEIGHT_STYLE_TAG, applyStyleSheet } from 'tentap-src/web/styles';

export { default as BridgeExtension } from 'tentap-src/bridges/base';
export { TenTapStartKit } from 'tentap-src/bridges/StarterKit';

/** Posts a message to the app. */
export const sendMessage = (message: EditorMessage): void => postToNative(message);

export interface StartTenTapArgs {
  /** Bridges the page supports; those with a TipTap extension load only when the app uses them. */
  bridges: BridgeExtension[];
  /** TipTap's options; `extensions` come after the bridges', and the handlers run after tentap's. */
  tiptapOptions?: Partial<EditorOptions>;
  /** Debounce of the state updates sent to the app. */
  stateUpdateDebounceMs?: number;
}

/**
 * tentap's `useTenTap` without React: makes the editor inside `element` from the boot config,
 * says `editor-ready` with the full state once it exists, and takes the app's messages,
 * including any sent before it existed.
 */
export function startTenTap(element: HTMLElement, { bridges, tiptapOptions = {}, stateUpdateDebounceMs }: StartTenTapArgs): Editor {
  const runtime = boot();
  const config = runtime.requireConfig();
  const active = selectActiveBridges(bridges, config);
  const handlers = selectHandlerBridges(bridges, active);
  const dynamicHeight = new DynamicHeight({
    onHeight: (height) => runtime.post({ type: PROTOCOL_TYPES.DocumentHeight, payload: height }),
    onCaret: (rect) => runtime.post({ type: PROTOCOL_TYPES.CaretRect, payload: rect }),
  });
  const publisher = createStatePublisher(runtime.post, () => handlers, stateUpdateDebounceMs);
  let announced = false;

  const editor = new Editor({
    element,
    content: config.initialContent ?? '',
    editable: config.editable,
    ...(config.parseOptions ? { parseOptions: config.parseOptions } : {}),
    ...tiptapOptions,
    extensions: [
      ...(config.disableColorHighlight ? [] : [blueBackgroundPlugin]),
      ...resolveBridgeExtensions(active, config),
      createDynamicHeightExtension(dynamicHeight),
      ...(tiptapOptions.extensions ?? []),
    ],
    onUpdate: (props: EditorEvents['update']) => {
      if (announced) {
        publisher.schedule(props.editor);
        runtime.post({ type: CoreEditorActionType.ContentUpdate });
      }
      tiptapOptions.onUpdate?.(props);
    },
    onSelectionUpdate: (props: EditorEvents['selectionUpdate']) => {
      publisher.schedule(props.editor);
      tiptapOptions.onSelectionUpdate?.(props);
    },
    onTransaction: (props: EditorEvents['transaction']) => {
      publisher.schedule(props.editor);
      tiptapOptions.onTransaction?.(props);
    },
  });

  let stopObserving: (() => void) | undefined;
  const setDynamicHeight = (on: boolean) => {
    element.classList.toggle('dynamic-height', on);
    stopObserving?.();
    stopObserving = undefined;
    if (!on) return;
    applyStyleSheet(DYNAMIC_HEIGHT_STYLE_TAG, DYNAMIC_HEIGHT_CSS);
    stopObserving = dynamicHeight.observe(editor.view);
  };
  setDynamicHeight(config.dynamicHeight);

  runtime.subscribe((message) => {
    if (editor.isDestroyed) return;
    if (message.type === PROTOCOL_TYPES.ContainerHeight) {
      if (typeof message.payload === 'number') dynamicHeight.setContainerHeight(message.payload);
      return;
    }
    if (message.type === PROTOCOL_TYPES.SetDynamicHeight) {
      setDynamicHeight(message.payload === true);
      return;
    }
    handlers.forEach((bridge) => bridge.onBridgeMessage?.(editor, message, runtime.post));
  });

  const announce = () => {
    if (editor.isDestroyed || announced) return;
    announced = true;
    runtime.applyInputMode(editor.view.dom);
    runtime.announceReady();
    publisher.publishNow(editor);
  };
  if (editor.isInitialized) announce();
  else editor.on('create', announce);

  // `isFocused` changes without a transaction when the page loses or regains focus.
  let focused = getFocusTracker().isFocused;
  const onFocusChange = () => {
    if (getFocusTracker().isFocused === focused) return;
    focused = getFocusTracker().isFocused;
    publisher.schedule(editor);
  };
  document.addEventListener('focus', onFocusChange, true);
  document.addEventListener('blur', onFocusChange, true);
  revealSelectionOnImageLoad(editor.view);
  revealSelectionOnViewportShrink(editor.view);
  holdScrollOnKeyboardClose(editor.view);
  keepSelectionThroughCollapse(editor.view);
  keepStoredMarksOffRecomposition(editor.view);
  return editor;
}
