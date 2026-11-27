/**
 * `@kitstak/ui/dashboard`: the one dashboard layout and the pieces every app home is built from.
 * The contract and the reasons live in docs/design/UI-CLEANUP.md.
 */

export { DashboardFrame, DashboardHeader, DashColumns, type DashboardApp, type DashboardFrameProps, type DashboardHeaderProps } from './frame';
export { DashboardLinkProvider, DashLink, type DashAction, type DashLinkComponent, type DashLinkProps } from './link';
export { Pill, Tag, Count, Legend, type CountProps, PILL_TONES, type PillProps, type PillTone, type LegendItem, type LegendProps } from './pill';
export { StatRow, StatTile, Delta, Meter, statColumns, type StatTileProps, type DeltaProps, type DeltaTone, type DeltaDirection, type MeterProps, type MeterTone, type MeterSize } from './stat';
export { DashSection, ActionList, ActionRow, EmptyNote, type DashSectionProps, type ActionRowProps, type EmptyNoteProps, type DashButtonAction, type ValueTone } from './section';
