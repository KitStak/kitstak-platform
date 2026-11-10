/** Header barcode: the product barcode, else the primary pack type's first barcode (with its pack type), else none. */
export function headerBarcode(
  productBarcode: string | null | undefined,
  packTypes: readonly { readonly kind: string; readonly packType: string; readonly barcodes: readonly string[] }[],
): { readonly value: string | null; readonly source: string | null } {
  if (productBarcode && productBarcode.trim()) return { value: productBarcode, source: null };
  const withCodes = packTypes.find((pt) => pt.kind === "Primary" && pt.barcodes.length) ?? packTypes.find((pt) => pt.barcodes.length);
  return withCodes ? { value: withCodes.barcodes[0] ?? null, source: withCodes.packType } : { value: null, source: null };
}
