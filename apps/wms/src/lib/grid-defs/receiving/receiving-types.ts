/**
 * Human labels for the stored receipt types (`RECEIVING_TYPES`). The stored values stay as
 * they are (filters, API and exports keep them); only what the user reads changes:
 * "DisassembleKit" reads "Disassemble kit", "Add Inventory" reads "Add inventory".
 */
import { RECEIVING_TYPES } from "@/lib/enums";

export const RECEIVING_TYPE_LABELS: Readonly<Record<(typeof RECEIVING_TYPES)[number], string>> = {
  "Add Inventory": "Add inventory",
  DisassembleKit: "Disassemble kit",
  Kitting: "Kitting",
  "Product Receive": "Product receive",
  "Purchase Order": "Purchase order",
  Return: "Return",
};

/** "DisassembleKit" → "Disassemble kit"; unknown values are split on case and sentence-cased. */
export function receivingTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  const known = (RECEIVING_TYPE_LABELS as Readonly<Record<string, string>>)[type];
  if (known) return known;
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}
