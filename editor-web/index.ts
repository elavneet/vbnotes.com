import { TenTapStartKit, startTenTap } from './tentap';
import { MarkdownBridge } from '../src/editor/markdownBridge';
import { MediaAction, MediaBridge } from '../src/editor/mediaBridge';
import { EditBridge } from '../src/editor/editBridge';
import { WikiBridge } from '../src/editor/wikiBridge';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { PlainTable } from './plainTable';
import { TagPills } from './tagPills';
import { RichCodeBlock } from './codeBlocks';
import { MediaViews, askApp, mediaFetch } from './media';
import { LinkTaps, withPlainLinks } from './links';
import { CodePaste } from './codePaste';
import { WordTaps } from './wordTaps';
import { MergeFormats } from './mergeFormats';
import { MarkdownPush } from './markdownPush';
import { WikiLinks } from './wikiLinks';
import { LineNumbers } from './lineNumbers';
import { HeadingMarks } from './headingMarks';
import { AppPastedMedia } from './mediaPaste';

declare global {
  interface Window { contentInjected: boolean | undefined }
}

// A picture still in iCloud: the app asks for it and waits up to two minutes (`fetchMissing`).
mediaFetch.from = (src) => askApp(MediaAction.Fetch, { src }, 125_000);

// Android injects the boot config after load; wait for it before making the editor.
const interval = setInterval(() => {
  if (!window.contentInjected) return;
  clearInterval(interval);
  // The editor scrolls inside this box (index.html).
  const holder = document.createElement('div');
  document.getElementById('root')!.appendChild(holder);
  startTenTap(holder, {
    bridges: [...withPlainLinks(TenTapStartKit), MarkdownBridge, MediaBridge, EditBridge, WikiBridge],
    // Toolbar state does not need every keystroke; fewer messages keep typing smooth.
    stateUpdateDebounceMs: 60,
    tiptapOptions: {
      // The note's markdown arrives in the boot config, so the first paint already shows it.
      contentType: 'markdown',
      // TenTapStartKit has no code block, rule or table; without them the markdown parser drops
      // ``` blocks, --- and | tables |, and the next save would delete them from the file.
      extensions: [MarkdownPush, TagPills, WikiLinks, LinkTaps, AppPastedMedia, CodePaste, WordTaps, MergeFormats, MediaViews, RichCodeBlock, HorizontalRule, PlainTable, TableRow, TableHeader, TableCell, LineNumbers, HeadingMarks],
      editorProps: { attributes: { spellcheck: 'true', autocapitalize: 'sentences' } },
    },
  });
}, 1);
