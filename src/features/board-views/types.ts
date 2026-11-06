import type { ViewDto } from '@/server/services/contracts/dto';

/** Props shared by every board view component. */
export interface BoardViewProps {
  readonly boardId: string;
  readonly view: ViewDto;
  /** Open the item panel (card click, event click, bar click, drill-down row…). */
  readonly onOpenItem?: (itemId: string) => void;
  /** Open the view's settings popover on mount (newly added views, BV-004). */
  readonly initialSettingsOpen?: boolean;
  readonly className?: string;
}
