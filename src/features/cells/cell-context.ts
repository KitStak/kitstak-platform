/**
 * Internal contract between the generic <Cell> shell and the per-type renderers.
 */
import type { ComponentType, RefObject } from 'react';
import type { ColumnType } from '@/server/db/schema/cell-values';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { CellBoard, CellCommitValue, CellDensity, CellNavDirection, CellServices } from './types';

export interface CellRenderContext {
  readonly column: ColumnDto;
  readonly item: ItemDto;
  readonly board: CellBoard | undefined;
  readonly users: readonly UserSummaryDto[];
  readonly usersById: ReadonlyMap<string, UserSummaryDto>;
  readonly services: CellServices;
  readonly value: unknown;
  readonly empty: boolean;
  readonly readOnly: boolean;
  readonly density: CellDensity;
  readonly editing: boolean;
  /** Characters typed on the focused cell that started the edit (Excel-style). */
  readonly seed: string | null;
  readonly forceHover: boolean;
  /** Static preview (gallery): editors must not grab focus. */
  readonly preview?: boolean;
  readonly now: Date;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly startEdit: (seed?: string) => void;
  /** Leave edit mode; focus returns to the cell (or moves when a direction is given). */
  readonly endEdit: (navigate?: CellNavDirection) => void;
  readonly commit: (value: CellCommitValue) => void;
  /**
   * Popover editors holding an uncommitted draft register a flush so Tab can commit it before
   * moving on. Return false to keep the editor open (invalid draft). Pass null to unregister.
   */
  readonly registerFlush?: (flush: (() => boolean) | null) => void;
  /**
   * Editors with nested modes or unsaved work (the label editor) register a guard that runs on
   * Esc / outside click before the picker closes. Return true when it handled the dismissal
   * (e.g. showed a "Discard changes?" confirm or left edit mode); the picker then stays open.
   */
  readonly registerDismissGuard?: (guard: ((reason: 'escape' | 'outside') => boolean) | null) => void;
}

/**
 * popover   — click / Enter opens an anchored picker
 * inline    — the cell itself becomes an input
 * toggle    — click / Enter / Space flips the value (checkbox)
 * direct    — the display is the control (rating stars, button)
 * readonly  — computed, never editable
 */
export type CellEditMode = 'popover' | 'inline' | 'toggle' | 'direct' | 'readonly';

export interface CellBehavior {
  readonly mode: CellEditMode;
  /** Printable keys on the focused cell start editing with that character. */
  readonly typeToEdit?: boolean;
  /** Delete / Backspace clears the value. */
  readonly clearable?: boolean;
  /** Picker width in px (popover mode). */
  readonly width?: number;
  readonly popup?: 'listbox' | 'dialog';
  readonly align?: 'start' | 'center';
}

export interface CellRenderer {
  readonly behavior: CellBehavior;
  readonly Display: ComponentType<{ readonly ctx: CellRenderContext }>;
  readonly Editor?: ComponentType<{ readonly ctx: CellRenderContext }>;
}

export type RendererMap = Readonly<Record<ColumnType, CellRenderer>>;
