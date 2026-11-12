/**
 * Hierarchical pack derivations (beyond Logiwa). PURE.
 *
 * A Case of 12 × Unit weighs at least 12 × the unit's weight; Logiwa stores 0 unless the user
 * types it, so cartonization, rate shopping and case-pick labels run on 0 lb. Here the case
 * weight is pre-filled from its child (editable), saved packs with no weight get the derived
 * value, and packs with no dimensions or weight are flagged.
 */
import {
  computeVolume,
  convertVolume,
  convertWeight,
  hasIncompleteDimensions,
  hasMissingWeight,
} from './catalog-options';

export interface DerivablePack {
  readonly key: string;
  readonly kind: 'Primary' | 'Hierarchical' | 'Irregular';
  readonly packType?: string;
  readonly parentKey?: string | null;
  readonly childQty?: number | null;
  readonly weight: number | null;
  readonly weightUnit: string;
  readonly length?: number | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly dimensionUnit?: string;
  readonly volume?: number | null;
  readonly volumeUnit?: string;
  readonly volumeOverridden?: boolean;
}

const MAX_DEPTH = 10;

function parentOf<T extends DerivablePack>(pack: T, packs: readonly T[]): T | undefined {
  const byKey = pack.parentKey ? packs.find((p) => p.key === pack.parentKey) : undefined;
  const parent = byKey ?? packs.find((p) => p.kind === 'Primary');
  return parent && parent.key !== pack.key ? parent : undefined;
}

/** Stored weight when > 0, else (for a hierarchical pack) the weight derived from its child. */
function effectiveWeight(
  pack: DerivablePack,
  packs: readonly DerivablePack[],
  depth: number,
): { weight: number; unit: string } | null {
  if (!hasMissingWeight(pack)) return { weight: pack.weight as number, unit: pack.weightUnit };
  if (pack.kind !== 'Hierarchical' || depth >= MAX_DEPTH) return null;
  const w = derivedPackWeightAt(pack, packs, depth + 1);
  return w === null ? null : { weight: w, unit: pack.weightUnit };
}

function derivedPackWeightAt(
  pack: DerivablePack,
  packs: readonly DerivablePack[],
  depth: number,
): number | null {
  if (pack.kind !== 'Hierarchical') return null;
  const parent = parentOf(pack, packs);
  if (!parent) return null;
  const child = effectiveWeight(parent, packs, depth);
  if (!child) return null;
  const qty = Math.max(1, Math.floor(pack.childQty ?? 2));
  return Math.round(convertWeight(child.weight * qty, child.unit, pack.weightUnit) * 100) / 100;
}

/**
 * Weight a hierarchical pack would have from child qty × its contained pack's weight, in this
 * pack's weight unit (2 dp). Null for primary/irregular packs, or when the child has no weight.
 */
export function derivedPackWeight(pack: DerivablePack, packs: readonly DerivablePack[]): number | null {
  return derivedPackWeightAt(pack, packs.some((p) => p.key === pack.key) ? packs : [...packs, pack], 0);
}

/** Contained pack's own volume (typed or from L×W×H) in its volume unit. */
function packVolume(pack: DerivablePack): number {
  if (pack.volumeOverridden && typeof pack.volume === 'number') return Math.max(0, pack.volume);
  if (!hasIncompleteDimensions(pack))
    return computeVolume(
      pack.length ?? 0,
      pack.width ?? 0,
      pack.height ?? 0,
      pack.dimensionUnit ?? 'Inch',
      pack.volumeUnit ?? 'Cubic Inch',
    );
  return Math.max(0, pack.volume ?? 0);
}

/**
 * Lower bound on a hierarchical pack's volume: child qty × contained pack volume, in this pack's
 * volume unit. A hint only (the outer carton adds air and walls). Null when unknown.
 */
export function minimumPackVolume(pack: DerivablePack, packs: readonly DerivablePack[]): number | null {
  if (pack.kind !== 'Hierarchical') return null;
  const all = packs.some((p) => p.key === pack.key) ? packs : [...packs, pack];
  const parent = parentOf(pack, all);
  if (!parent) return null;
  const v = packVolume(parent);
  if (!(v > 0)) return null;
  const qty = Math.max(1, Math.floor(pack.childQty ?? 2));
  return convertVolume(v * qty, parent.volumeUnit ?? 'Cubic Inch', pack.volumeUnit ?? 'Cubic Inch');
}

/**
 * Saved hierarchical packs with no weight take the derived weight (parents first, so a Pallet of
 * Cases of Units resolves). Packs with a typed weight are never changed.
 */
export function fillDerivedPackWeights<T extends DerivablePack>(packs: readonly T[]): T[] {
  const out: T[] = packs.map((p) => ({ ...p }));
  for (let pass = 0; pass < MAX_DEPTH; pass += 1) {
    let changed = false;
    for (let i = 0; i < out.length; i += 1) {
      const p = out[i] as T;
      if (p.kind !== 'Hierarchical' || !hasMissingWeight(p)) continue;
      const w = derivedPackWeight(p, out);
      if (w !== null && w > 0) {
        out[i] = { ...p, weight: w };
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

export type PackDataGap = 'dimensions' | 'weight';

/** What a pack is missing for cubing, rate shopping and labels. */
export function packDataGaps(pack: DerivablePack): PackDataGap[] {
  const gaps: PackDataGap[] = [];
  if (hasIncompleteDimensions(pack)) gaps.push('dimensions');
  if (hasMissingWeight(pack)) gaps.push('weight');
  return gaps;
}

/**
 * After a pack edit, hierarchical packs whose weight was the calculated one (equal to the value
 * derived from `before`) follow the new child weight. Typed weights are kept.
 */
export function rederiveDependentWeights<T extends DerivablePack>(
  before: readonly T[],
  after: readonly T[],
): T[] {
  const auto = new Set(
    after
      .filter((p) => {
        if (p.kind !== 'Hierarchical') return false;
        const prev = before.find((b) => b.key === p.key);
        if (!prev) return false;
        const was = derivedPackWeight(prev, before);
        return was !== null && prev.weight === was && p.weight === prev.weight;
      })
      .map((p) => p.key),
  );
  let out: T[] = after.map((p) => ({ ...p }));
  for (let pass = 0; pass < MAX_DEPTH && auto.size; pass += 1) {
    let changed = false;
    out = out.map((p) => {
      if (!auto.has(p.key)) return p;
      const w = derivedPackWeight(p, out);
      if (w === null || w === p.weight) return p;
      changed = true;
      return { ...p, weight: w };
    });
    if (!changed) break;
  }
  return out;
}

/**
 * Notices for a kit or packaging material's own dims (the Packing step; they have no pack-type
 * step). Same wording family as the pack-type modal. Packaging feeds box matching and carton
 * weight, so its copy says so. Products return none (their dims live on pack types).
 */
export function ownDimsGaps(
  category: string,
  v: {
    readonly length?: number | null;
    readonly width?: number | null;
    readonly height?: number | null;
    readonly weight?: number | null;
    readonly weightUnit: string;
  },
): string[] {
  if (category !== 'Kit' && category !== 'Packaging Material') return [];
  const packaging = category === 'Packaging Material';
  const out: string[] = [];
  if (hasIncompleteDimensions(v)) {
    out.push(
      packaging
        ? 'No outer dimensions: box matching and cartonization will treat this packaging as 0 × 0 × 0.'
        : 'No outer dimensions: cartonization and box selection will treat this kit as 0 × 0 × 0.',
    );
  }
  if (hasMissingWeight(v)) {
    out.push(
      packaging
        ? `No weight: carton weights will add 0 ${v.weightUnit.toLowerCase()}s for this packaging.`
        : `No weight: rate shopping and shipping labels will use 0 ${v.weightUnit.toLowerCase()}s for this kit.`,
    );
  }
  return out;
}
