/**
 * Working-context label shared by the SSR shell and the header context switcher:
 * a short, never-truncated summary ("MLT1 · All") plus a long form for the tooltip.
 */

import { codeNameLabel } from "./utils";

export interface InitialShellContext {
  /** Short trigger text, e.g. "MLT1 · All". */
  readonly summary: string;
  /** Narrow-header text (below 1440px): "MLT1", or the summary when a client is chosen. */
  readonly compact: string;
  /** Long form for the tooltip / accessible name. */
  readonly description: string;
  /** "MLT1 - Main Fulfillment · All clients" (read-only context chips). */
  readonly long: string;
  /** False when the user has a single warehouse and client: the switcher is hidden. */
  readonly visible: boolean;
}

export interface ContextLabelParts {
  readonly warehouse: { readonly code: string | null; readonly name: string } | null;
  readonly client: { readonly code: string | null; readonly name: string } | null;
}

export const ALL_WAREHOUSES_SHORT = "All WH";
export const ALL_CLIENTS_SHORT = "All";

/** Pure: "MLT1 · All" plus "MLT1 - Main Fulfillment · All clients". */
export function contextLabel({ warehouse, client }: ContextLabelParts): Omit<InitialShellContext, "visible"> {
  const whShort = warehouse ? warehouse.code ?? warehouse.name : ALL_WAREHOUSES_SHORT;
  const clientShort = client ? client.code ?? client.name : ALL_CLIENTS_SHORT;
  const whLong = warehouse ? codeNameLabel(warehouse.code, warehouse.name) : "All warehouses";
  const clientLong = client ? client.name : "All clients";
  const summary = `${whShort} · ${clientShort}`;
  return { summary, compact: client ? summary : whShort, description: `Warehouse: ${whLong} · Client: ${clientLong}`, long: `${whLong} · ${clientLong}` };
}

/** Warehouse wall clock used when a warehouse has no zone of its own (seed default). */
export const DEFAULT_WAREHOUSE_TIME_ZONE = "America/Chicago";

/** Window event that opens the header context switcher (e.g. from a dashboard chip). */
export const OPEN_CONTEXT_SWITCHER_EVENT = "ks:open-context-switcher";
