'use client';
/**
 * The period picker every profit screen shares: a preset (this week, last month, ...), two day
 * pickers when the range is custom, and what to compare with. It only reports changes; the page
 * keeps the period in the URL.
 */
import { CalendarRange } from 'lucide-react';
import { IsoDatePicker } from '@/components/ui/iso-date-picker';
import { Select } from '@/components/ui/select';
import { cn } from '@/components/ui/cn';
import { COMPARE_MODES, COMPARE_MODE_LABELS, RANGE_PRESETS, RANGE_PRESET_LABELS, rangeLabel, type CompareMode, type RangePreset } from '@/lib/reports';
import type { Period } from './period';

export interface PeriodChange {
  readonly preset?: RangePreset;
  readonly from?: string;
  readonly to?: string;
  readonly compare?: CompareMode;
}

export function PeriodPicker({ period, onChange, showCompare = true, className }: { readonly period: Period; readonly onChange: (change: PeriodChange) => void; readonly showCompare?: boolean; readonly className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="period-picker">
      <div className="w-[150px]">
        <Select
          aria-label="Period"
          size="md"
          value={period.preset}
          onValueChange={(value) => onChange(value === 'custom' ? { preset: 'custom', from: period.from, to: period.to } : { preset: value as RangePreset })}
          options={RANGE_PRESETS.map((preset) => ({ value: preset, label: RANGE_PRESET_LABELS[preset], icon: preset === period.preset ? <CalendarRange aria-hidden className="size-3.5 text-icon" /> : undefined }))}
        />
      </div>
      {period.preset === 'custom' ? (
        <div className="flex items-center gap-1.5">
          <IsoDatePicker aria-label="First day" value={period.from} onChange={(value) => (value ? onChange({ preset: 'custom', from: value, to: value > period.to ? value : period.to }) : undefined)} clearable={false} className="w-[136px]" />
          <span className="text-sm text-fg-muted">to</span>
          <IsoDatePicker aria-label="Last day" value={period.to} onChange={(value) => (value ? onChange({ preset: 'custom', from: value < period.from ? value : period.from, to: value }) : undefined)} clearable={false} className="w-[136px]" />
        </div>
      ) : (
        <span className="text-sm whitespace-nowrap text-fg-muted" data-testid="period-label">
          {rangeLabel(period)}
        </span>
      )}
      {showCompare ? (
        <div className="w-[236px]">
          <Select
            aria-label="Compare with"
            size="md"
            value={period.compare}
            onValueChange={(value) => onChange({ compare: value as CompareMode })}
            options={COMPARE_MODES.map((mode) => ({ value: mode, label: mode === 'none' ? COMPARE_MODE_LABELS[mode] : `Compare: ${COMPARE_MODE_LABELS[mode].toLowerCase()}` }))}
          />
        </div>
      ) : null}
    </div>
  );
}
