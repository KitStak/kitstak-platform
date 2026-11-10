/**
 * RMA photos grouping (PURE, unit tested). Return Station photos are named "<SKU> · <file>";
 * they are grouped under their RMA line, in line order, and everything else under "General".
 */
import type { Attachment } from "@/components/shared/contracts";

export interface PhotoItem {
  readonly attachment: Attachment;
  /** File name without the "<SKU> · " prefix. */
  readonly displayName: string;
  readonly isImage: boolean;
}

export interface PhotoGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly PhotoItem[];
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export function photoGroups(docs: readonly Attachment[], skus: readonly string[]): PhotoGroup[] {
  const bySku = new Map<string, PhotoItem[]>();
  const general: PhotoItem[] = [];
  // Longest SKU first so "ABC-1" does not swallow "ABC-10 · x.jpg".
  const ordered = [...skus].sort((a, b) => b.length - a.length);
  for (const a of docs) {
    const name = a.fileName ?? a.documentType;
    const isImage = Boolean(a.mime?.startsWith("image/")) || IMAGE_EXT.test(name);
    const sku = ordered.find((s) => name.startsWith(`${s} · `));
    if (sku) {
      const list = bySku.get(sku) ?? [];
      list.push({ attachment: a, displayName: name.slice(sku.length + 3) || name, isImage });
      bySku.set(sku, list);
    } else {
      general.push({ attachment: a, displayName: name, isImage });
    }
  }
  const out: PhotoGroup[] = skus.filter((s) => bySku.has(s)).map((s) => ({ key: `line-${s}`, label: `Line ${s}`, items: bySku.get(s) ?? [] }));
  if (general.length) out.push({ key: "general", label: "General", items: general });
  return out;
}
