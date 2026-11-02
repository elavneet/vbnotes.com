import { Table, renderTableToMarkdown } from '@tiptap/extension-table';

// The stock renderer wraps tables in extra newlines, which come back as an empty paragraph on the
// next open; a note would gain a blank line around each table with every save.
export const PlainTable = Table.extend({ renderMarkdown: (node, h) => renderTableToMarkdown(node, h).trim() });
