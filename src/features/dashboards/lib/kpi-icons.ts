/** Optional per-widget header glyph for Numbers widgets (a KPI row reads faster with distinct icons). */
import { createElement, type ReactElement } from 'react';
import {
  Activity,
  BadgeDollarSign,
  BriefcaseBusiness,
  Coins,
  Gauge,
  Hash,
  Target,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';

export const KPI_ICONS = {
  hash: { label: 'Number', icon: Hash },
  pipeline: { label: 'Pipeline', icon: BriefcaseBusiness },
  target: { label: 'Target', icon: Target },
  trophy: { label: 'Trophy', icon: Trophy },
  coins: { label: 'Coins', icon: Coins },
  revenue: { label: 'Revenue', icon: BadgeDollarSign },
  trend: { label: 'Trend', icon: TrendingUp },
  people: { label: 'People', icon: Users },
  activity: { label: 'Activity', icon: Activity },
  speed: { label: 'Gauge', icon: Gauge },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

export type KpiIconKey = keyof typeof KPI_ICONS;

export function kpiIconKey(value: unknown): KpiIconKey | null {
  return typeof value === 'string' && Object.hasOwn(KPI_ICONS, value) ? (value as KpiIconKey) : null;
}

/** Renders a KPI glyph by key (the icon set is static, so no component is created per render). */
export function KpiGlyph({ name }: { readonly name: KpiIconKey }): ReactElement {
  return createElement(KPI_ICONS[name].icon, { 'aria-hidden': true });
}

export const KPI_ICON_OPTIONS = Object.entries(KPI_ICONS).map(([value, entry]) => ({ value, label: entry.label }));
