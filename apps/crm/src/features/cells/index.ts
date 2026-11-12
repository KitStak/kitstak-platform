/**
 * Cells module: every column type's renderer + editor, group-footer summaries, column type
 * icons and the label picker / editor. See src/features/cells/README in the gallery
 * (/dev/cells) for every state.
 *
 *   <CellServicesProvider value={useBoardCellServices(boardId, items)}>
 *     <Cell column={column} item={item} board={board} users={users} onCommit={(v) => ...} />
 *     <CellSummary column={column} items={groupItems} board={board} users={users} />
 *   </CellServicesProvider>
 */
export { Cell } from './cell';
export { CellEditorPreview } from './editor-preview';
export { CellSummary, type CellSummaryProps } from './cell-summary';
export { ColumnTypeIcon, columnTypeLabel, type ColumnTypeIconProps } from './column-type-icon';
export { LabelPicker, type LabelPickerProps } from './label-picker';
export { EditLabelsDialog, LabelEditor, type EditLabelsDialogProps, type LabelEditorProps } from './label-editor';
export { LabelChip } from './renderers/labels';
export { CellServicesProvider, useBoardCellServices, useCellServices, useLabelUsage } from './services';
export { useMediaQuery } from './parts/use-media';
export { RENDERERS as CELL_RENDERERS } from './renderers';
export { isCellEmpty, rawCellValue, computeProgress } from './lib/values';
export { labelsFromSettings, countLabelUsage } from './lib/labels';
export { focusSiblingCell } from './lib/navigation';
export type {
  CellBoard,
  CellCommitValue,
  CellDensity,
  CellNavDirection,
  CellProps,
  CellServices,
  ConnectCandidate,
  GeoPlace,
  LabelChange,
} from './types';
