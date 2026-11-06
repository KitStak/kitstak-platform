/**
 * Metadata for every board view type: icon, label and one-line description. The board
 * toolbar's "Add view" menu and the Views Center read this list.
 */
import {
  CalendarDays,
  ChartColumnBig,
  ChartGantt,
  ClipboardList,
  Images,
  LayoutDashboard,
  SquareKanban,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { ViewType } from '@/server/services/contracts/dto';

export interface ViewTypeMeta {
  readonly type: ViewType;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  /** Default name for a newly added view. */
  readonly defaultName: string;
  /** The settings popover opens automatically after the view is added (BV-004). */
  readonly opensSettings: boolean;
  /** Implemented by this module (table / dashboard are rendered elsewhere). */
  readonly rendered: boolean;
  readonly category: 'core' | 'planning' | 'reporting' | 'collect';
}

export const VIEW_TYPES: readonly ViewTypeMeta[] = [
  {
    type: 'table',
    label: 'Table',
    description: 'The main grid: every column, group and summary.',
    icon: Table2,
    defaultName: 'Table',
    opensSettings: false,
    rendered: false,
    category: 'core',
  },
  {
    type: 'kanban',
    label: 'Kanban',
    description: 'Cards in lanes by stage or status. Drag to move them along.',
    icon: SquareKanban,
    defaultName: 'Kanban',
    opensSettings: true,
    rendered: true,
    category: 'core',
  },
  {
    type: 'calendar',
    label: 'Calendar',
    description: 'Plot items on a month, week or day calendar by any date.',
    icon: CalendarDays,
    defaultName: 'Calendar',
    opensSettings: true,
    rendered: true,
    category: 'planning',
  },
  {
    type: 'timeline',
    label: 'Timeline',
    description: 'A Gantt-style plan of bars you can drag, resize and zoom.',
    icon: ChartGantt,
    defaultName: 'Timeline',
    opensSettings: false,
    rendered: true,
    category: 'planning',
  },
  {
    type: 'chart',
    label: 'Chart',
    description: 'Bar, line, pie and stacked charts of any column, live.',
    icon: ChartColumnBig,
    defaultName: 'Chart',
    opensSettings: true,
    rendered: true,
    category: 'reporting',
  },
  {
    type: 'form',
    label: 'Form',
    description: 'A shareable form that creates an item for every response.',
    icon: ClipboardList,
    defaultName: 'Form',
    opensSettings: false,
    rendered: true,
    category: 'collect',
  },
  {
    type: 'files',
    label: 'File gallery',
    description: 'Every file on the board in one browsable gallery.',
    icon: Images,
    defaultName: 'Files',
    opensSettings: false,
    rendered: true,
    category: 'collect',
  },
  {
    type: 'dashboard',
    label: 'Dashboard',
    description: 'Widgets summarizing this board, embedded as a view.',
    icon: LayoutDashboard,
    defaultName: 'Dashboard',
    opensSettings: false,
    rendered: false,
    category: 'reporting',
  },
];

export const VIEW_TYPE_BY_TYPE: ReadonlyMap<ViewType, ViewTypeMeta> = new Map(VIEW_TYPES.map((meta) => [meta.type, meta]));

export function viewTypeMeta(type: ViewType): ViewTypeMeta | undefined {
  return VIEW_TYPE_BY_TYPE.get(type);
}
