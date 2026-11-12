/** Pure helpers for the Print Custom Report dialog (unit-tested). */
import type { EodRow } from '@/server/repositories/end-of-day';

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fromYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/** Initial parameters: the selected manifests' date span and single carrier, else today / all carriers. */
export function initialCustomParams(
  selected: readonly Pick<EodRow, 'shipDate' | 'carrierCode'>[],
  today: Date = new Date(),
): { from: string; to: string; carrier: string | null } {
  if (selected.length === 0) return { from: ymd(today), to: ymd(today), carrier: null };
  const days = selected.map((r) => r.shipDate).sort();
  const carriers = [...new Set(selected.map((r) => r.carrierCode))];
  return { from: days[0], to: days[days.length - 1], carrier: carriers.length === 1 ? carriers[0] : null };
}
