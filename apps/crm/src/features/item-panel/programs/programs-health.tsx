'use client';
/**
 * Compact KitStak Programs line under a deal or account name: "1 program · $29,970 this month",
 * or units when money is hidden ("1 program · 14,172 kits this month"). A won deal with no
 * program yet reads "Won · no program yet". Clicking it opens the Programs tab. Reads the same
 * query as the tab, so it never makes a request of its own.
 */
import { Repeat2 } from 'lucide-react';
import { formatCents, formatQty } from '@kitstak/programs-engine/format';
import type { ItemProgramsDto } from '@/server/services/programs-bridge';

/** Adds whole cents given as decimal strings (never through floating point). */
export function sumCents(values: readonly (string | null)[]): bigint | null {
  let total = BigInt(0);
  for (const value of values) {
    if (value === null || !/^-?\d+$/.test(value)) return null;
    total += BigInt(value);
  }
  return total;
}

/** Adds 3 decimal quantities ("14172.000") exactly, as thousandths. */
export function sumQty(values: readonly string[]): string {
  let total = BigInt(0);
  for (const value of values) {
    const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
    if (!match) continue;
    const thousandths = BigInt(match[2] ?? '0') * BigInt(1000) + BigInt((match[3] ?? '').padEnd(3, '0') || '0');
    total += match[1] === '-' ? -thousandths : thousandths;
  }
  const negative = total < BigInt(0);
  const abs = negative ? -total : total;
  return `${negative ? '-' : ''}${(abs / BigInt(1000)).toString()}.${(abs % BigInt(1000)).toString().padStart(3, '0')}`;
}

/** The words of the health line, or null when there is nothing to say. */
export function programsHealthSummary(data: Pick<ItemProgramsDto, 'available' | 'programs' | 'moneyHidden' | 'deal' | 'createProgramUrl'>): string | null {
  if (!data.available) return null;
  const programs = data.programs.filter((program) => program.status !== 'archived');
  if (programs.length === 0) {
    return data.deal?.won && data.createProgramUrl ? 'Won · no program yet' : null;
  }
  const count = `${programs.length} ${programs.length === 1 ? 'program' : 'programs'}`;
  const showMoney = programs.every((program) => !program.moneyHidden);
  if (showMoney) {
    const total = sumCents(programs.map((program) => program.month.revenueCents));
    if (total !== null) return `${count} · ${formatCents(total)} this month`;
  }
  const units = new Set(programs.map((program) => program.unit.plural));
  if (units.size === 1) {
    const unit = [...units][0] as string;
    return `${count} · ${formatQty(sumQty(programs.map((program) => program.month.units)))} ${unit} this month`;
  }
  return count;
}

export function ProgramsHealthLine({ data, onOpen }: { readonly data: ItemProgramsDto; readonly onOpen: () => void }) {
  const label = programsHealthSummary(data);
  if (!label) return null;
  const targets = data.programs.map((program) => program.month.targetBp).filter((bp): bp is number => bp !== null);
  // Amber: a won deal waiting for a program, or a program forecast under its monthly target.
  const dot =
    data.programs.length === 0 || targets.some((bp) => bp < 10_000)
      ? 'var(--warning)'
      : targets.length > 0
        ? 'var(--success)'
        : 'var(--border-strong)';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border-subtle bg-panel px-2.5 py-1 text-xs font-medium text-fg-secondary hover:border-border-default hover:text-fg"
      data-testid="crm-programs-health"
    >
      <Repeat2 aria-hidden className="size-3 shrink-0 text-primary" />
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="truncate tabular-nums">{label}</span>
    </button>
  );
}
