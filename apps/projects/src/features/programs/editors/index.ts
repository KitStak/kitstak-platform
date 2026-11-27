/**
 * Program editors shared by the wizard (L4a) and the program tabs (L4c): docs/programs/SPEC.md
 * 10.2 L3. Client components plus their pure models (tested in `*.test.ts`).
 */
export * from './variant-model';
export * from './price-model';
export * from './schedule-model';
export { VariantGenerator, type VariantGeneratorProps } from './variant-generator';
export { PasteList, readPasted, renameAxis, type PasteListProps, type PasteSeparator } from './paste-list';
export { RateRulesEditor, rateHint, type RateRulesEditorProps } from './rate-rules-editor';
export { PriceLinesEditor, type PriceLinesEditorProps, type PriceLinesVariant } from './price-lines-editor';
export { OneTimeChargesEditor, type OneTimeChargesEditorProps } from './one-time-charges-editor';
export { ScheduleEditor, type ScheduleEditorProps, type ScheduleVariant } from './schedule-editor';
export { VaryByDayRow, type VaryByDayRowProps } from './vary-by-day-row';
