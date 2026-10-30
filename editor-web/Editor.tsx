import React from 'react';
import { EditorContent, TenTapStartKit, useTenTap } from '@10play/tentap-editor';
import { MarkdownBridge } from '../src/editor/markdownBridge';
import { MediaBridge } from '../src/editor/mediaBridge';
import { EditBridge } from '../src/editor/editBridge';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Table, TableCell, TableHeader, TableRow, renderTableToMarkdown } from '@tiptap/extension-table';
import { TagPills } from './tagPills';
import { RichCodeBlock } from './codeBlocks';
import { MediaViews } from './media';
import { LinkTaps, withPlainLinks } from './links';
import { CodePaste } from './codePaste';
import { WordTaps } from './wordTaps';
import { MergeFormats } from './mergeFormats';
import { MarkdownPush } from './markdownPush';

// The stock renderer wraps tables in extra newlines, which come back as an empty paragraph on the
// next open; a note would gain a blank line around each table with every save.
export const PlainTable = Table.extend({ renderMarkdown: (node, h) => renderTableToMarkdown(node, h).trim() });

export const Editor = () => {
  const editor = useTenTap({
    bridges: [...withPlainLinks(TenTapStartKit), MarkdownBridge, MediaBridge, EditBridge],
    // Toolbar state does not need every keystroke; fewer messages keep typing smooth.
    stateUpdateDebounceMs: 60,
    tiptapOptions: {
      // The note's markdown arrives in the boot config, so the first paint already shows it.
      contentType: 'markdown',
      // Nothing in this component reads editor state; re-rendering React per keystroke was wasted work.
      shouldRerenderOnTransaction: false,
      // TenTapStartKit has no code block, rule or table; without them the markdown parser drops
      // ``` blocks, --- and | tables |, and the next save would delete them from the file.
      extensions: [MarkdownPush, TagPills, LinkTaps, CodePaste, WordTaps, MergeFormats, MediaViews, RichCodeBlock, HorizontalRule, PlainTable, TableRow, TableHeader, TableCell],
      editorProps: { attributes: { spellcheck: 'true', autocapitalize: 'sentences' } },
    },
  });
  return <EditorContent editor={editor} className={(window as any).dynamicHeight ? 'dynamic-height' : undefined} />;
};
