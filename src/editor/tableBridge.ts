import { BridgeExtension } from '@10play/tentap-editor';

/**
 * A table's menu on the phone. The page (`editor-web/tableDots.ts`) draws a ⋮ in the caret's cell
 * and says where the caret is when it is tapped; the app shows the menu and sends back what was
 * picked. Runs in both worlds: the page sets `tablePage.run`, the app sets `tableHost`.
 */
export enum TableAction {
  Menu = 'table-menu',
  Run = 'table-run',
  Copied = 'table-copied',
}

/** The caret's row and column in its table, the table's size, and the column's alignment. */
export type TablePlace = { row: number; col: number; rows: number; cols: number; align: 'left' | 'center' | 'right' | null };

export type TableOp =
  | 'addRow' | 'addColumn' | 'rowUp' | 'rowDown' | 'columnLeft' | 'columnRight' | 'deleteRow' | 'deleteColumn'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'copyMd' | 'copyHtml' | 'copyText';

type TableMessage =
  | { type: TableAction.Menu; payload: TablePlace }
  | { type: TableAction.Run; payload: { op: TableOp } }
  | { type: TableAction.Copied; payload: { text: string } };

type TableInstance = { table: (op: TableOp) => void };

declare module '@10play/tentap-editor' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface EditorBridge extends TableInstance {}
}

/** The app side: set by NoteEditor, so this file stays free of React Native imports. */
export const tableHost: { menu?: (place: TablePlace) => void; copied?: (text: string) => void } = {};
/** The page side: does what was picked; a copy gives back the text for the clipboard. */
export const tablePage: { run?: (editor: unknown, op: TableOp) => string | void } = {};

export const TableBridge = new BridgeExtension<object, TableInstance, TableMessage>({
  forceName: 'vbTable',
  onBridgeMessage: (editor, message, sendMessageBack) => {
    if (message.type !== TableAction.Run) return false;
    const text = tablePage.run?.(editor, message.payload.op);
    if (typeof text === 'string') sendMessageBack({ type: TableAction.Copied, payload: { text } });
    return true;
  },
  onEditorMessage: (message) => {
    if (message.type === TableAction.Menu) tableHost.menu?.(message.payload);
    else if (message.type === TableAction.Copied) tableHost.copied?.(message.payload.text);
    else return false;
    return true;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    table: (op) => sendBridgeMessage({ type: TableAction.Run, payload: { op } }),
  }),
});
