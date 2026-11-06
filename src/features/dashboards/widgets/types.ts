import type { InsightDto, WidgetSettings } from '@/server/services/contracts/dashboard-insights';

export interface WidgetRenderProps {
  readonly insight: InsightDto;
  readonly settings: WidgetSettings;
  /** Dashboard filters are active (empty states say "no match" instead of "no data"). */
  readonly filtered: boolean;
  readonly orgSlug: string;
  readonly title: string;
  /** Opens the widget settings panel (empty-state call to action). */
  readonly onConfigure?: () => void;
  /** Persist a config patch (inline editing of text widgets). */
  readonly onUpdateConfig?: (patch: Record<string, unknown>) => void;
  readonly editable: boolean;
  /** Rendered in the full-screen dialog (more rows, links out). */
  readonly expanded?: boolean;
}
