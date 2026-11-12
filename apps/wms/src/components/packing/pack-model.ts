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

/** Package contents footer (Logiwa "Total SKU: n · Total Quantity: n"): lines with units, and units. */
export function packageTotals(items: Readonly<Record<string, number>>): { readonly skus: number; readonly quantity: number } {
  const qtys = Object.values(items).filter((q) => q > 0);
  return { skus: qtys.length, quantity: qtys.reduce((s, q) => s + q, 0) };
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

/** A line in the Report Issue dialog: picked units still to pack and how many are in a package now. */
export interface IssueLine {
  readonly orderLineId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly toPack: number;
  readonly packed: number;
}

/** Default units to send to the hospital: what is not in a package yet, else the whole line. */
export function defaultIssueQty(line: IssueLine): number {
  const unpacked = Math.max(0, line.toPack - line.packed);
  return unpacked > 0 ? unpacked : line.toPack;
}

/** `/api/packing/report-issue` lines: positive quantities, capped at what is picked. */
export function issueLinesPayload(lines: readonly IssueLine[], qty: Readonly<Record<string, number | null | undefined>>): { readonly orderLineId: string; readonly qty: number }[] {
  return lines
    .map((l) => ({ orderLineId: l.orderLineId, qty: Math.min(l.toPack, Math.max(0, Math.floor(qty[l.orderLineId] ?? 0))) }))
    .filter((l) => l.qty > 0);
}

/** Lot / expiry / serial chips for the package contents grid (Logiwa "Attributes" column). */
export function lineAttributes(line: PackLine, state: PackState): string[] {
  const cap = state.captures[line.orderLineId];
  const out: string[] = [];
  const lot = cap?.lotNumber.trim() || line.lotNumber;
  if (lot) out.push(`Lot ${lot}`);
  const exp = cap?.expiryDate.trim() || line.expiryDate;
  if (exp) out.push(`Exp ${exp.slice(0, 10)}`);
  const serials = cap?.serials ?? [];
  if (serials.length === 1) out.push(`SN ${serials[0]}`);
  else if (serials.length > 1) out.push(`${serials.length} serials`);
  return out;
}

export function boxWeightOz(b: PackBox): number {
  return Math.round(((b.weightLb ?? 0) * 16 + (b.weightOz ?? 0)) * 100) / 100;
}

/** Suggested-weight breakdown: sum(unit weight x qty) for the box contents plus the package tare. */
export function weightBreakdown(lines: readonly PackLine[], b: PackBox, pkg: PackPackageType | null | undefined): { readonly itemsOz: number; readonly tareOz: number; readonly totalOz: number } {
  const itemsOz = Math.round(Object.entries(b.items).reduce((s, [id, q]) => s + (lines.find((l) => l.orderLineId === id)?.weightOz ?? 0) * q, 0) * 100) / 100;
  const tareOz = Math.round((pkg?.emptyWeightLb ?? 0) * 16 * 100) / 100;
  return { itemsOz, tareOz, totalOz: Math.round((itemsOz + tareOz) * 100) / 100 };
}

/** Formats ounces as "1 lb 5.6 oz" / "8 oz". */
export function formatLbOz(oz: number): string {
  const lb = Math.floor(oz / 16);
  const rest = Math.round((oz - lb * 16) * 10) / 10;
  if (lb === 0) return `${rest} oz`;
  return rest === 0 ? `${lb} lb` : `${lb} lb ${rest} oz`;
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

/**
 * Why Get rate is unavailable (null when a quote can be fetched). One rule for Get rate
 * and Complete: every package with items needs its size and weight. Closing is not
 * required; Complete closes the open package itself.
 */
export function rateBlocker(state: PackState): string | null {
  const used = state.boxes.filter((b) => Object.keys(b.items).length > 0);
  if (used.length === 0) return "Scan items into a package first";
  for (const b of used) {
    const e = boxErrors(b);
    const first = e.dims ?? e.weight;
    if (first) return `Package ${b.seq}: ${first}`;
  }
  return null;
}

/** Closes every package that has items (Complete auto-closes the open package). */
export function closeUsedBoxes(state: PackState): PackState {
  return { ...state, boxes: state.boxes.map((b) => (Object.keys(b.items).length > 0 ? { ...b, closed: true } : b)) };
}

/**
 * What F9 / Complete does next with a label: fetch and show the rate first (the operator
 * always sees the cost before a label is bought), or buy. A failed quote does not trap the
 * operator: the second press buys without a quote.
 */
export function completeStep(opts: { readonly withLabel: boolean; readonly hasRate: boolean; readonly quoteTried: boolean }): "quote" | "buy" {
  return opts.withLabel && !opts.hasRate && !opts.quoteTried ? "quote" : "buy";
}

/** Rate request packages: used boxes (or the first box) with their sizes and weights. */
export function rateSpecs(state: PackState): { readonly weightOz: number; readonly length: number; readonly width: number; readonly height: number }[] {
  const used = state.boxes.filter((b) => Object.keys(b.items).length > 0);
  return (used.length ? used : state.boxes.slice(0, 1)).map((b) => ({ weightOz: boxWeightOz(b) || 16, length: b.length ?? 1, width: b.width ?? 1, height: b.height ?? 1 }));
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

/* ------------------------------------------------ rate signature & drafts */

/**
 * What a quote depends on: the rated packages (sizes, weights) and the service. A quote stays
 * valid while this is unchanged, so closing a package (F2) keeps it; editing a size or weight,
 * scanning more units or switching service makes it stale.
 */
export function rateSignature(state: PackState, carrierServiceId: string | null): string {
  return JSON.stringify({ s: carrierServiceId ?? "", p: rateSpecs(state) });
}

/** A rate quote as the pack screen keeps it (mirrors `RateQuote` in pack-types). */
export interface DraftQuote {
  readonly carrierServiceId: string; readonly serviceName: string; readonly carrierCode: string; readonly price: number; readonly amount: number;
  readonly currency: string; readonly transitDays: number; readonly carrierConnectionId: string;
}

/** Server-saved pack progress (`PUT /api/packing/orders/[id]/draft`). */
export interface PackDraftSnapshot {
  readonly boxes: readonly PackBox[];
  readonly active: number;
  readonly captures: Readonly<Record<string, Capture>>;
  readonly choice: { readonly carrierKey: string | null; readonly carrierServiceId: string | null } | null;
  readonly rate: { readonly sig: string; readonly quote: DraftQuote } | null;
}

export function draftSnapshot(state: PackState, choice: PackDraftSnapshot["choice"], rate: PackDraftSnapshot["rate"]): PackDraftSnapshot {
  return { boxes: state.boxes, active: state.active, captures: state.captures, choice, rate };
}

/** Units packed in the snapshot (0 = nothing worth resuming). */
export function draftUnits(d: Pick<PackDraftSnapshot, "boxes">): number {
  return d.boxes.reduce((s, b) => s + Object.values(b.items).reduce((a, q) => a + q, 0), 0);
}

/**
 * Restores a saved snapshot onto the order's current lines, or null when it no longer fits
 * (a line is gone, or more units are packed than are left to pack). Missing captures are
 * filled from the fresh initial state, so newly tracked lines still ask for lot / expiry.
 */
export function restoreDraft(lines: readonly PackLine[], base: PackState, d: PackDraftSnapshot): PackState | null {
  if (d.boxes.length === 0 || d.active < 0 || d.active >= d.boxes.length) return null;
  const byId = new Map(lines.map((l) => [l.orderLineId, l]));
  const packed = new Map<string, number>();
  for (const b of d.boxes) for (const [id, q] of Object.entries(b.items)) {
    if (q <= 0) continue;
    if (!byId.has(id)) return null;
    packed.set(id, (packed.get(id) ?? 0) + q);
  }
  for (const [id, q] of packed) if (q > (byId.get(id)?.toPack ?? 0)) return null;
  const boxes = d.boxes.map((b, i) => ({ ...b, seq: i + 1, items: Object.fromEntries(Object.entries(b.items).filter(([, q]) => q > 0)) }));
  return { boxes, active: d.active, captures: { ...base.captures, ...d.captures }, awaitingSerialFor: null, lastLineId: null };
}

/** Rate shop: the cheapest and the fastest quote (ties: the other measure, then name). */
export function shopPicks<Q extends { readonly price: number; readonly transitDays: number; readonly serviceName: string }>(quotes: readonly Q[]): { readonly cheapest: Q | null; readonly fastest: Q | null } {
  if (quotes.length === 0) return { cheapest: null, fastest: null };
  const cheapest = [...quotes].sort((a, b) => a.price - b.price || a.transitDays - b.transitDays || a.serviceName.localeCompare(b.serviceName))[0] ?? null;
  const fastest = [...quotes].sort((a, b) => a.transitDays - b.transitDays || a.price - b.price || a.serviceName.localeCompare(b.serviceName))[0] ?? null;
  return { cheapest, fastest };
}
