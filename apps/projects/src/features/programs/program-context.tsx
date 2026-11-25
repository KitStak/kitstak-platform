'use client';
/**
 * Program context for every /programs/[key]/* page (docs/programs/SPEC.md 5.1). The [key] layout
 * loads the program detail and its variants on the server and seeds React Query; tabs, overlays
 * and the frame read them with `useCurrentProgram()` (live: refetches after mutations that
 * invalidate `qk.program(key)`).
 *
 *   const { program, unit, variants, variantById, capabilities, moneyHidden, today } = useCurrentProgram();
 *
 * `useOptionalProgram()` returns null outside a program, for shared views that also run in projects.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useProgram, useVariants } from '@/lib/hooks/use-programs';
import type { StatusDTO } from '@/lib/types';
import type { IsoDate, ProgramCapabilities, ProgramDetailDTO, UnitLabel, VariantDTO } from '@/lib/program-types';

export interface ProgramContextValue {
  readonly program: ProgramDetailDTO;
  readonly key: string;
  readonly unit: UnitLabel;
  readonly statuses: readonly StatusDTO[];
  readonly statusById: ReadonlyMap<string, StatusDTO>;
  /** Active and retired variants in card order. */
  readonly variants: readonly VariantDTO[];
  readonly activeVariants: readonly VariantDTO[];
  readonly variantById: ReadonlyMap<string, VariantDTO>;
  readonly capabilities: ProgramCapabilities;
  /** True when the person cannot see money (M8): money UI hides, charts switch to units. */
  readonly moneyHidden: boolean;
  /** Today in the program time zone (A8). */
  readonly today: IsoDate;
  readonly isFetching: boolean;
}

const ProgramContext = createContext<ProgramContextValue | null>(null);

export interface ProgramProviderProps {
  readonly initial: ProgramDetailDTO;
  readonly initialVariants?: readonly VariantDTO[];
  /** `Date.now()` on the server when the data was read, so the cache does not refetch at once. */
  readonly loadedAt?: number;
  readonly children: ReactNode;
}

export function ProgramProvider({ initial, initialVariants, loadedAt, children }: ProgramProviderProps) {
  const query = useProgram(initial.key, { initialData: initial, initialDataUpdatedAt: loadedAt, staleTime: 30_000 });
  const variantsQuery = useVariants(initial.key, true, { initialData: initialVariants ? [...initialVariants] : undefined, initialDataUpdatedAt: loadedAt, staleTime: 30_000 });
  const program = query.data ?? initial;
  const variantList = variantsQuery.data;
  const value = useMemo<ProgramContextValue>(() => {
    const variants = variantList ?? [];
    return {
      program,
      key: program.key,
      unit: program.unit,
      statuses: program.statuses,
      statusById: new Map(program.statuses.map((status) => [status.id, status])),
      variants,
      activeVariants: variants.filter((variant) => variant.status === 'active'),
      variantById: new Map(variants.map((variant) => [variant.id, variant])),
      capabilities: program.capabilities,
      moneyHidden: program.moneyHidden || !program.capabilities.seesMoney,
      today: program.calendar.today,
      isFetching: query.isFetching,
    };
  }, [program, variantList, query.isFetching]);
  return <ProgramContext.Provider value={value}>{children}</ProgramContext.Provider>;
}

export function useCurrentProgram(): ProgramContextValue {
  const context = useContext(ProgramContext);
  if (!context) throw new Error('useCurrentProgram must be used under /programs/[key]');
  return context;
}

/** The current program, or null on project pages (shared views, the task drawer). */
export function useOptionalProgram(): ProgramContextValue | null {
  return useContext(ProgramContext);
}
