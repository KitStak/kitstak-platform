/** Public types of the cells module. */
import type { ColumnSettings, StoredCellValue } from '@/server/db/schema/cell-values';
import type { Label } from '@/server/db/schema/column-types';
import type {
  ColumnDto,
  FileDto,
  GroupDto,
  ItemDto,
  TeamDto,
  UserSummaryDto,
} from '@/server/services/contracts/dto';

export type CellDensity = 'compact' | 'default' | 'comfortable';

export type CellNavDirection = 'next' | 'prev' | 'up' | 'down';

/** Board context a cell may use (terminology, sibling columns for progress, group colors). */
export interface CellBoard {
  readonly id: string;
  readonly itemTerminology?: string;
  readonly columns?: readonly ColumnDto[];
  readonly groups?: readonly GroupDto[];
  readonly canEdit?: boolean;
}

/** Value written by a cell (`null` clears it). Name cells commit a string. */
export type CellCommitValue = StoredCellValue | null;

export interface CellProps {
  readonly column: ColumnDto;
  readonly item: ItemDto;
  readonly board?: CellBoard;
  readonly users: readonly UserSummaryDto[];
  /**
   * Persist a new value. Callers do the optimistic write and return a promise that REJECTS on
   * failure (after rolling back). If the host shows no error itself, set `reportsErrors={false}`
   * (default) and the cell toasts a generic error; hosts that toast pass `reportsErrors`.
   */
  readonly onCommit: (value: CellCommitValue) => void | Promise<unknown>;
  /** The host already toasts commit failures (suppresses the cell's default error toast). */
  readonly reportsErrors?: boolean;
  readonly readOnly?: boolean;
  readonly density?: CellDensity;
  /** Grid navigation after Tab / Enter commits. Falls back to DOM-order cell focus. */
  readonly onNavigate?: (direction: CellNavDirection) => void;
  /** Roving tabindex from the grid (defaults to 0). */
  readonly tabIndex?: number;
  readonly className?: string;
  /** Controlled editing state (optional). */
  readonly editing?: boolean;
  readonly onEditingChange?: (editing: boolean) => void;
  /** Gallery / tests only: render the hover affordances without a pointer. */
  readonly forceHover?: boolean;
  readonly 'aria-colindex'?: number;
}

export interface LabelChange {
  readonly labels: readonly Label[];
  /** Deleted label id → replacement label id (null = clear those cells). */
  readonly reassign: ReadonlyMap<string, string | null>;
}

export interface GeoPlace {
  readonly id: string;
  /** Primary line, e.g. "350 5th Ave". */
  readonly name: string;
  /** Full address stored in the cell. */
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
}

export interface ConnectCandidate {
  readonly id: string;
  readonly name: string;
  readonly boardId: string | null;
  readonly boardName: string | null;
  readonly groupTitle: string | null;
}

/**
 * Data + side effects cells need beyond `onCommit`. Provide once per board with
 * `<CellServicesProvider value={useBoardCellServices(boardId)}>` (or mocks in galleries/tests).
 * Every member is optional; cells hide the affordance when a capability is missing.
 */
export interface CellServices {
  readonly teams?: readonly TeamDto[];
  /** Files of the board, used to resolve `fileIds` to names/types. */
  readonly files?: readonly FileDto[];
  readonly filesLoading?: boolean;
  readonly uploadFile?: (item: ItemDto, column: ColumnDto, file: File) => Promise<FileDto>;
  readonly fileUrl?: (fileId: string, download?: boolean) => string;
  /** Item search across connected boards (connect_boards picker). */
  readonly searchItems?: (query: string, boardIds: readonly string[], signal?: AbortSignal) => Promise<readonly ConnectCandidate[]>;
  /** Cache scope (org + board) for queries the cells run themselves. */
  readonly scopeKey?: string;
  /** Names for linked item ids. Ids absent once loading finished are unavailable / forbidden. */
  readonly linkedItems?: ReadonlyMap<string, ConnectCandidate>;
  readonly linkedItemsLoading?: boolean;
  /** Record names picked in the connect picker so chips render before the board refetches. */
  readonly rememberLinkedItems?: (candidates: readonly ConnectCandidate[]) => void;
  /** Board-wide label usage (labelId → item count), for delete-label warnings. */
  readonly labelUsage?: (column: ColumnDto) => Promise<Readonly<Record<string, number>>>;
  /** Run a button column's action. */
  readonly runButton?: (column: ColumnDto, item: ItemDto) => Promise<string | void>;
  /** Persist label edits (status/dropdown), including reassigning cells of deleted labels. */
  readonly saveLabels?: (column: ColumnDto, change: LabelChange) => Promise<void>;
  /** Persist other column settings (e.g. footer summary function). */
  readonly saveColumnSettings?: (column: ColumnDto, settings: ColumnSettings) => Promise<void>;
  /** All items of the board (label usage counts for delete warnings). */
  readonly boardItems?: readonly ItemDto[];
  /** Place search for location cells (debounced by the editor). */
  readonly geocode?: (query: string, signal?: AbortSignal) => Promise<readonly GeoPlace[]>;
  /** Org-wide tag suggestions. */
  readonly tagSuggestions?: readonly string[];
  /** Fixed "now" (tests / galleries). */
  readonly now?: () => Date;
}
