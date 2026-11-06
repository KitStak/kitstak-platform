/** Board template definitions (pure data). */
import type { ColumnType, Label, LabelColor } from '@/server/db/schema/cell-values';
import type { BoardKind, ViewType } from '../contracts/dto';

export interface TemplateColumn {
  readonly key: string;
  readonly title: string;
  readonly type: ColumnType;
  readonly settings?: Record<string, unknown>;
  readonly width?: number;
  readonly hidden?: boolean;
  readonly scope?: 'item' | 'subitem';
  readonly description?: string;
  /** For connect_boards: template id of the board to connect to (resolved when created as a set). */
  readonly connectTemplate?: string;
  /** For connect_boards: key of the reciprocal column on the connected board. */
  readonly reciprocalKey?: string;
  /** For mirror: the connected board template and the column to mirror from it. */
  readonly mirrorOf?: { readonly templateId: string; readonly columnKey: string };
}

export interface TemplateGroup {
  readonly key: string;
  readonly title: string;
  readonly color: LabelColor;
  readonly collapsedDefault?: boolean;
}

export interface TemplateView {
  readonly type: ViewType;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly isDefault?: boolean;
}

export interface TemplateSampleItem {
  readonly name: string;
  readonly group: string;
  readonly values?: Record<string, unknown>;
}

export interface BoardTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: BoardKind;
  readonly icon: string;
  readonly category: 'crm' | 'work' | 'blank';
  readonly itemTerminology: string;
  readonly subitemTerminology?: string;
  readonly primaryStatusColumnKey?: string;
  readonly columns: readonly TemplateColumn[];
  readonly groups: readonly TemplateGroup[];
  readonly views: readonly TemplateView[];
  readonly sampleItems?: readonly TemplateSampleItem[];
}

type LabelEntry = readonly [id: string, name: string, color: LabelColor, isDone?: boolean];

/** Dropdown label settings. */
export function labels(entries: readonly LabelEntry[]): { labels: Label[] } {
  return {
    labels: entries.map(([id, name, color, isDone], position) => ({
      id,
      name,
      color,
      position,
      ...(isDone ? { isDone: true } : {}),
    })),
  };
}

/** Status label settings: the given labels plus the gray "empty" default label. */
export function statusLabels(entries: readonly LabelEntry[]): { labels: Label[] } {
  const base = labels(entries).labels;
  return {
    labels: [...base, { id: 'default', name: '', color: 'gray', position: base.length, isDefault: true }],
  };
}
