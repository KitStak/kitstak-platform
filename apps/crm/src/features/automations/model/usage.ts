/** Usage meter math (pure). */
export interface UsageSummary {
  readonly used: number;
  readonly allowance: number;
  readonly percent: number;
  /** `data` until the warning line, then warning, then danger at the allowance. */
  readonly tone: 'data' | 'warning' | 'danger';
  /** Linear projection of runs at month end. */
  readonly forecast: number;
  readonly forecastOver: boolean;
}

export const WARNING_RATIO = 0.8;

export function summarizeUsage(input: {
  used: number;
  allowance: number;
  dayOfMonth: number;
  daysInMonth: number;
}): UsageSummary {
  const allowance = Math.max(1, input.allowance);
  const ratio = input.used / allowance;
  const day = Math.min(Math.max(1, input.dayOfMonth), input.daysInMonth);
  const forecast = Math.round((input.used / day) * input.daysInMonth);
  return {
    used: input.used,
    allowance,
    percent: Math.min(100, ratio * 100),
    tone: ratio >= 1 ? 'danger' : ratio >= WARNING_RATIO ? 'warning' : 'data',
    forecast,
    forecastOver: forecast > allowance,
  };
}

/** "<1%" for a sliver of usage so the label never contradicts a visible bar. */
export function formatPercent(percent: number): string {
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}
