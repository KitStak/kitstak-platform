/**
 * Licensable KitStak modules (BLUEPRINT.md §3.2). Kept in lockstep with the
 * `core.entitlements.module` CHECK constraint owned by `@kitstak/db`.
 */
import type { EntitlementModule } from '@kitstak/db/schema';

export type Module = 'crm' | 'wms';

export const MODULES: readonly Module[] = ['crm', 'wms'] as const;

/**
 * Compile-time lockstep guard: `Module` must stay identical to the schema's
 * `EntitlementModule` union. Drifting either side fails typecheck here.
 */
type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : never) : never;
const _modulesMatchSchema: MutuallyAssignable<Module, EntitlementModule> = true;
void _modulesMatchSchema;

export function isModule(value: string): value is Module {
  return (MODULES as readonly string[]).includes(value);
}
