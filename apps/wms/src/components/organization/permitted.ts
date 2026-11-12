/**
 * Read-only roles (viewer, finance) should not see write actions they can never use.
 * Drops row / bulk actions whose only blocker is a missing permission; actions disabled for a
 * record-specific reason ("12 orders reference this customer") stay visible with that reason.
 */
import { NO_PERMISSION } from '@/components/facility/facility-shared';

export function permitted<A extends { readonly disabledReason?: string | null }>(actions: readonly A[]): A[] {
  return actions.filter((a) => a.disabledReason !== NO_PERMISSION);
}

export function permittedRowActions<R, A extends { readonly disabledReason?: string | null }>(
  build: (row: R) => readonly A[],
): (row: R) => A[] {
  return (row) => permitted(build(row));
}
