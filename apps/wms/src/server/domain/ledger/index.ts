/**
 * `ledger.*` — the only writer of `inventory` and `inventory_transactions` (BUILD_PLAN 0.4 #1).
 *
 *   import { ledger } from "@/server/domain/ledger";
 *   ledger.add(tx, ctx, { ... });
 */
export * from './bucket';
export * from './txn';
export * from './rules';
export * from './count-locks';
export * from './operations';
export * from './allocations';
export * from './receipts';
export * from './serials';
export * from './verify';

import { allocate, releaseAllocation } from './allocations';
import {
  add,
  adjustTo,
  changeAttributes,
  consume,
  move,
  moveLocation,
  moveLp,
  remove,
  setStatus,
} from './operations';
import { cancelReceipt, recordReceipt } from './receipts';
import {
  assignOrderSerial,
  carrySerials,
  pickSerial,
  registerSerials,
  restockReturnedSerials,
  shipSerials,
  unassignOrderSerials,
} from './serials';
import { reconcileLedger } from './verify';

export const ledger = {
  add,
  remove,
  adjustTo,
  move,
  moveLocation,
  moveLp,
  changeAttributes,
  setStatus,
  consume,
  allocate,
  releaseAllocation,
  recordReceipt,
  cancelReceipt,
  registerSerials,
  pickSerial,
  shipSerials,
  assignOrderSerial,
  unassignOrderSerials,
  carrySerials,
  restockReturnedSerials,
  reconcileLedger,
} as const;
