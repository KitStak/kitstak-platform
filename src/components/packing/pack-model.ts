/**
 * Pack screen model (PURE, unit tested): packages (multi-box), product scans with
 * over-pack and wrong-item guards, serial / lot / expiry captures, package closing,
 * readiness checks and the `/api/packing/complete` payload.
 */

export interface PackLine {
  readonly orderLineId: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly packType: string;
  readonly ordered: number;
  readonly toPack: number;
  readonly packed: number;
  readonly weightOz: number;
  readonly scanCodes: readonly string[];
  readonly trackSerial: boolean;
  readonly captureLot: boolean;
  readonly captureExpiry: boolean;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly pickedSerials: readonly string[];
  readonly packingInstructions: string | null;
}

export interface PackPackageType {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly emptyWeightLb: number;
  readonly tracksInventory: boolean;
}

export interface PackBox {
  readonly seq: number;
  readonly shipmentPackageId: string | null;
  readonly length: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly weightLb: number | null;
  readonly weightOz: number | null;
  /** orderLineId → qty in this box. */
  readonly items: Readonly<Record<string, number>>;
  readonly closed: boolean;
}

export interface Capture {
  readonly serials: readonly string[];
  readonly lotNumber: string;
  readonly expiryDate: string;
}

export interface PackState {
  readonly boxes: readonly PackBox[];
  readonly active: number;
  readonly captures: Readonly<Record<string, Capture>>;
  /** A serial-tracked line waiting for its serial scan. */
  readonly awaitingSerialFor: string | null;
  readonly lastLineId: string | null;
}

export function emptyBox(seq: number, pkg?: PackPackageType | null): PackBox {
  return {
    seq, shipmentPackageId: pkg?.id ?? null, length: pkg?.length ?? null, width: pkg?.width ?? null, height: pkg?.height ?? null,
    weightLb: null, weightOz: null, items: {}, closed: false,
  };
}

export function initialPackState(lines: readonly PackLine[], defaultPackage?: PackPackageType | null): PackState {
  const captures: Record<string, Capture> = {};
  for (const l of lines) if (l.trackSerial || l.captureLot || l.captureExpiry) captures[l.orderLineId] = { serials: [], lotNumber: l.lotNumber ?? "", expiryDate: l.expiryDate ?? "" };
  return { boxes: [emptyBox(1, defaultPackage)], active: 0, captures, awaitingSerialFor: null, lastLineId: null };
}

export function packedQty(state: PackState, orderLineId: string): number {
  return state.boxes.reduce((s, b) => s + (b.items[orderLineId] ?? 0), 0);
}

export function totalsOf(lines: readonly PackLine[], state: PackState): { readonly packed: number; readonly toPack: number } {
  return { packed: lines.reduce((s, l) => s + packedQty(state, l.orderLineId), 0), toPack: lines.reduce((s, l) => s + l.toPack, 0) };
}

export type ScanResult = { readonly ok: true; readonly state: PackState; readonly line: PackLine; readonly message: string } | { readonly ok: false; readonly error: string };

function addToActive(state: PackState, lineId: string): PackState {
  let boxes = state.boxes;
  let active = state.active;
  if (boxes[active]?.closed) {
    const reopen = boxes.findIndex((b) => !b.closed);
    if (reopen >= 0) active = reopen;
    else {
      const last = boxes[boxes.length - 1];
      boxes = [...boxes, { ...emptyBox(boxes.length + 1), shipmentPackageId: last?.shipmentPackageId ?? null, length: last?.length ?? null, width: last?.width ?? null, height: last?.height ?? null }];
      active = boxes.length - 1;
    }
  }
  boxes = boxes.map((b, i) => (i === active ? { ...b, items: { ...b.items, [lineId]: (b.items[lineId] ?? 0) + 1 } } : b));
  return { ...state, boxes, active, lastLineId: lineId };
}

/** A product scan: +1 into the open box; wrong item and over-pack are rejected. */
export function scanProduct(lines: readonly PackLine[], state: PackState, code: string): ScanResult {
  const lc = code.trim().toLowerCase();
  if (!lc) return { ok: false, error: "Scan a product barcode" };
  if (state.awaitingSerialFor) {
    const line = lines.find((l) => l.orderLineId === state.awaitingSerialFor);
    return line ? scanSerial(lines, state, code) : { ok: false, error: "Scan the serial number" };
  }
  const matches = lines.filter((l) => l.scanCodes.includes(lc));
  if (matches.length === 0) return { ok: false, error: `Wrong item: ${code} is not on this order.` };
  const line = matches.find((l) => packedQty(state, l.orderLineId) < l.toPack);
  if (!line) {
    const m = matches[0] as PackLine;
    return { ok: false, error: `${m.sku} is already fully packed (${packedQty(state, m.orderLineId)}/${m.toPack}). Over-packing is blocked.` };
  }
  if (line.trackSerial) return { ok: true, line, state: { ...state, awaitingSerialFor: line.orderLineId, lastLineId: line.orderLineId }, message: `Scan the serial number of ${line.sku}` };
  const next = addToActive(state, line.orderLineId);
  return { ok: true, line, state: next, message: `${line.sku} ${packedQty(next, line.orderLineId)}/${line.toPack}` };
}

/** Serial scan for the awaited serial-tracked line; the unit counts once its serial is in. */
export function scanSerial(lines: readonly PackLine[], state: PackState, serial: string): ScanResult {
  const lineId = state.awaitingSerialFor;
  const line = lines.find((l) => l.orderLineId === lineId);
  if (!line || !lineId) return { ok: false, error: "No item is waiting for a serial number" };
  const s = serial.trim();
  if (!s) return { ok: false, error: "Scan the serial number" };
  const cap = state.captures[lineId] ?? { serials: [], lotNumber: "", expiryDate: "" };
  if (cap.serials.some((x) => x.toLowerCase() === s.toLowerCase())) return { ok: false, error: `Serial ${s} was already scanned.` };
  if (line.pickedSerials.length > 0 && !line.pickedSerials.some((x) => x.toLowerCase() === s.toLowerCase())) return { ok: false, error: `Serial ${s} was not picked for this order.` };
  if (line.scanCodes.includes(s.toLowerCase())) return { ok: false, error: `That is the product barcode. Scan the serial number of ${line.sku}.` };
  const withSerial: PackState = { ...state, awaitingSerialFor: null, captures: { ...state.captures, [lineId]: { ...cap, serials: [...cap.serials, s] } } };
  const next = addToActive(withSerial, lineId);
  return { ok: true, line, state: next, message: `${line.sku} serial ${s} · ${packedQty(next, lineId)}/${line.toPack}` };
}

export function cancelSerial(state: PackState): PackState {
  return { ...state, awaitingSerialFor: null };
}

/** Removes one unit of a line from a box (and its last serial, when serial-tracked). */
export function removeOne(lines: readonly PackLine[], state: PackState, boxIndex: number, orderLineId: string): PackState {
  const box = state.boxes[boxIndex];
  const qty = box?.items[orderLineId] ?? 0;
  if (!box || qty <= 0) return state;
  const items = { ...box.items };
  if (qty === 1) delete items[orderLineId];
  else items[orderLineId] = qty - 1;
  const line = lines.find((l) => l.orderLineId === orderLineId);
  const cap = state.captures[orderLineId];
  const captures = line?.trackSerial && cap ? { ...state.captures, [orderLineId]: { ...cap, serials: cap.serials.slice(0, -1) } } : state.captures;
  return { ...state, captures, boxes: state.boxes.map((b, i) => (i === boxIndex ? { ...b, items, closed: false } : b)) };
}

export function updateBox(state: PackState, index: number, patch: Partial<PackBox>): PackState {
  return { ...state, boxes: state.boxes.map((b, i) => (i === index ? { ...b, ...patch } : b)) };
}

export function choosePackage(state: PackState, index: number, pkg: PackPackageType | null): PackState {
  return updateBox(state, index, { shipmentPackageId: pkg?.id ?? null, length: pkg?.length ?? null, width: pkg?.width ?? null, height: pkg?.height ?? null });
}

export function setCapture(state: PackState, orderLineId: string, patch: Partial<Capture>): PackState {
  const cap = state.captures[orderLineId] ?? { serials: [], lotNumber: "", expiryDate: "" };
  return { ...state, captures: { ...state.captures, [orderLineId]: { ...cap, ...patch } } };
}

export function boxWeightOz(b: PackBox): number {
  return Math.round(((b.weightLb ?? 0) * 16 + (b.weightOz ?? 0)) * 100) / 100;
}

/** Suggested weight: product weights in the box plus the empty package weight. */
export function suggestedWeightOz(lines: readonly PackLine[], b: PackBox, pkg: PackPackageType | null | undefined): number {
  const items = Object.entries(b.items).reduce((s, [id, q]) => s + (lines.find((l) => l.orderLineId === id)?.weightOz ?? 0) * q, 0);
  return Math.round((items + (pkg?.emptyWeightLb ?? 0) * 16) * 100) / 100;
}

export function boxErrors(b: PackBox): Partial<Record<"package" | "dims" | "weight" | "items", string>> {
  const e: Partial<Record<"package" | "dims" | "weight" | "items", string>> = {};
  if (Object.keys(b.items).length === 0) e.items = "This package is empty. Scan items into it.";
  if (!b.length || !b.width || !b.height) e.dims = "Choose a package type or enter L × W × H";
  const w = boxWeightOz(b);
  if (w <= 0) e.weight = "Enter the package weight";
  else if (w > 2400) e.weight = "Max 150 lb per package";
  return e;
}

/** Close Pack: closes the open box when valid; opens a new one when items remain. */
export function closeBox(lines: readonly PackLine[], state: PackState): { readonly state: PackState; readonly error: string | null; readonly openedNext: boolean } {
  const box = state.boxes[state.active];
  if (!box) return { state, error: "No open package", openedNext: false };
  const e = boxErrors(box);
  const first = e.items ?? e.dims ?? e.weight ?? null;
  if (first) return { state, error: first, openedNext: false };
  let next = updateBox(state, state.active, { closed: true });
  const remaining = lines.some((l) => packedQty(next, l.orderLineId) < l.toPack);
  if (remaining) {
    next = { ...next, boxes: [...next.boxes, { ...emptyBox(next.boxes.length + 1), shipmentPackageId: box.shipmentPackageId, length: box.length, width: box.width, height: box.height }], active: next.boxes.length };
  }
  return { state: next, error: null, openedNext: remaining };
}

export function addBox(state: PackState): PackState {
  const last = state.boxes[state.boxes.length - 1];
  return {
    ...state,
    boxes: [...state.boxes, { ...emptyBox(state.boxes.length + 1), shipmentPackageId: last?.shipmentPackageId ?? null, length: last?.length ?? null, width: last?.width ?? null, height: last?.height ?? null }],
    active: state.boxes.length,
  };
}

export function removeBox(state: PackState, index: number): PackState {
  if (state.boxes.length <= 1) return state;
  const box = state.boxes[index];
  if (!box || Object.keys(box.items).length > 0) return state;
  const boxes = state.boxes.filter((_, i) => i !== index).map((b, i) => ({ ...b, seq: i + 1 }));
  return { ...state, boxes, active: Math.min(state.active, boxes.length - 1) };
}

/** Why Complete is not possible yet (null when ready). */
export function completeBlocker(lines: readonly PackLine[], state: PackState, opts: { readonly withLabel: boolean; readonly carrierServiceId: string | null }): string | null {
  const short = lines.find((l) => packedQty(state, l.orderLineId) < l.toPack);
  if (short) return `Pack every item first (${short.sku} ${packedQty(state, short.orderLineId)}/${short.toPack}). Use Report Issue for missing items.`;
  if (state.awaitingSerialFor) return "Scan the pending serial number first";
  const used = state.boxes.filter((b) => Object.keys(b.items).length > 0);
  for (const b of used) {
    const e = boxErrors(b);
    const first = e.dims ?? e.weight;
    if (first) return `Package ${b.seq}: ${first}`;
  }
  for (const l of lines) {
    const cap = state.captures[l.orderLineId];
    if (l.captureLot && !cap?.lotNumber.trim()) return `${l.sku}: enter the lot number`;
    if (l.captureExpiry && !cap?.expiryDate.trim()) return `${l.sku}: enter the expiry date`;
  }
  if (opts.withLabel && !opts.carrierServiceId) return "Choose a carrier and shipping service";
  return null;
}

export interface CompletePayload {
  readonly orderId: string;
  readonly stationId: string;
  readonly version?: number;
  readonly withLabel: boolean;
  readonly carrierConnectionId: string | null;
  readonly carrierServiceId: string | null;
  readonly packages: readonly { readonly shipmentPackageId: string | null; readonly length: number; readonly width: number; readonly height: number; readonly weightOz: number; readonly items: readonly { readonly orderLineId: string; readonly qty: number }[] }[];
  readonly captures: readonly { readonly orderLineId: string; readonly serials: readonly string[]; readonly lotNumber: string | null; readonly expiryDate: string | null }[];
}

export function buildCompletePayload(input: { readonly orderId: string; readonly stationId: string; readonly version?: number; readonly withLabel: boolean; readonly carrierConnectionId: string | null; readonly carrierServiceId: string | null }, state: PackState): CompletePayload {
  return {
    ...input,
    packages: state.boxes.filter((b) => Object.keys(b.items).length > 0).map((b) => ({
      shipmentPackageId: b.shipmentPackageId, length: b.length ?? 0, width: b.width ?? 0, height: b.height ?? 0, weightOz: boxWeightOz(b),
      items: Object.entries(b.items).map(([orderLineId, qty]) => ({ orderLineId, qty })),
    })),
    captures: Object.entries(state.captures).map(([orderLineId, c]) => ({ orderLineId, serials: c.serials, lotNumber: c.lotNumber.trim() || null, expiryDate: c.expiryDate.trim() || null })),
  };
}
