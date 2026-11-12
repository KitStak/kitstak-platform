'use client';

import * as React from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import {
  DIMENSION_UNITS,
  VOLUME_UNITS,
  WEIGHT_UNITS,
  computeVolume,
  packingFlagsFor,
} from '@/lib/grid-defs/products/catalog-options';
import { ownDimsGaps } from '@/lib/grid-defs/products/pack-derivation';
import { INSTRUCTIONS_MAX } from '@/lib/grid-defs/products/product-form';
import { FormGrid, FormSection } from '@/components/ui/form';
import { ROW } from './pack-type-modal';
import { Button } from '@/components/ui/button';
import { useProductWizard } from './context';
import { AreaF, FlagRow, NumF, SelectF, opts } from './fields';

/**
 * Keeps `<prefix>volume` = L×W×H (converted) until the user types a volume. Beyond Logiwa,
 * which leaves volume at 0.
 */
export function useAutoVolume(prefix = ''): {
  overridden: boolean;
  reset: () => void;
  markOverride: () => void;
} {
  const form = useFormContext();
  const [l, w, h, du, vu, overridden] = useWatch({
    name: [
      `${prefix}length`,
      `${prefix}width`,
      `${prefix}height`,
      `${prefix}dimensionUnit`,
      `${prefix}volumeUnit`,
      `${prefix}volumeOverridden`,
    ],
  }) as [number | null, number | null, number | null, string, string, boolean];
  React.useEffect(() => {
    if (overridden) return;
    const next = computeVolume(l ?? 0, w ?? 0, h ?? 0, du || 'Inch', vu || 'Cubic Inch');
    if (form.getValues(`${prefix}volume`) !== next)
      form.setValue(`${prefix}volume`, next, { shouldDirty: false });
  }, [l, w, h, du, vu, overridden, form, prefix]);
  return {
    overridden: Boolean(overridden),
    reset: () => form.setValue(`${prefix}volumeOverridden`, false, { shouldDirty: true }),
    markOverride: () => form.setValue(`${prefix}volumeOverridden`, true, { shouldDirty: true }),
  };
}

export function VolumeField({ prefix = '' }: { readonly prefix?: string }) {
  const auto = useAutoVolume(prefix);
  return (
    <div className="flex items-end gap-1.5">
      <NumF
        name={`${prefix}volume`}
        label="Volume"
        decimals={5}
        className="min-w-0 flex-1"
        description={auto.overridden ? 'Entered manually' : 'Calculated from L × W × H'}
        onValue={() => auto.markOverride()}
      />
      {auto.overridden ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Recalculate volume from dimensions"
          title="Recalculate from dimensions"
          onClick={auto.reset}
          className="mb-5"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

/** Same amber notice as the pack-type modal: missing dims / weight do not block saving. */
function OwnDimsNotice() {
  const { category } = useProductWizard();
  const [length, width, height, weight, weightUnit] = useWatch({
    name: ['length', 'width', 'height', 'weight', 'weightUnit'],
  }) as [number | null, number | null, number | null, number | null, string];
  const gaps = ownDimsGaps(category, { length, width, height, weight, weightUnit: weightUnit || 'Pound' });
  if (gaps.length === 0) return null;
  return (
    <ul
      data-testid="own-dims-gaps"
      className="flex flex-col gap-0.5 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-xs text-body"
      aria-live="polite"
    >
      {gaps.map((m) => (
        <li key={m} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span>{m} You can save now and add it later.</span>
        </li>
      ))}
    </ul>
  );
}

function KitDims() {
  const { options } = useProductWizard();
  return (
    <FormSection
      title="Dimensions and weight"
      description="Kits and packaging carry their own dims (no pack type step)."
    >
      {/* Same fixed rows as the pack-type modals: no orphan cells, L × W × H on one row. */}
      <div className="flex flex-col gap-y-4">
        <div className={ROW}>
          <SelectF name="dimensionUnit" label="Dimension unit" required options={opts(DIMENSION_UNITS)} />
        </div>
        <div className={ROW}>
          <NumF name="length" label="Length" decimals={2} />
          <NumF name="width" label="Width" decimals={2} />
          <NumF name="height" label="Height" decimals={2} />
        </div>
        <div className={ROW}>
          <SelectF name="volumeUnit" label="Volume unit" required options={opts(VOLUME_UNITS)} />
          <VolumeField />
          <SelectF
            name="useShipPackageId"
            label="Use this shipping box only"
            clearable
            placeholder="Any box"
            options={options.shipmentPackages.map((o) => ({
              value: o.value,
              label: o.label,
              description: o.description,
            }))}
          />
        </div>
        <div className={ROW}>
          <SelectF name="weightUnit" label="Weight unit" required options={opts(WEIGHT_UNITS)} />
          <NumF name="weight" label="Weight" decimals={2} />
        </div>
        <OwnDimsNotice />
      </div>
    </FormSection>
  );
}

export function StepPacking() {
  const { category } = useProductWizard();
  const flags = packingFlagsFor(category);
  return (
    <div className="flex flex-col gap-5">
      {category !== 'Product' ? <KitDims /> : null}
      <FormSection title="Instructions">
        <FormGrid columns={2}>
          <AreaF
            name="packingInstructions"
            label="Packing instructions"
            maxLength={INSTRUCTIONS_MAX}
            placeholder="Shown to packers at the packing station"
          />
          <AreaF
            name="returnInstructions"
            label="Return instructions"
            maxLength={INSTRUCTIONS_MAX}
            placeholder="Shown at the return station"
          />
        </FormGrid>
      </FormSection>
      <FormSection
        title="Handling"
        description="Flags drive packing prompts, box selection and carrier surcharges."
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
          {flags.map((f) => (
            <FlagRow key={f.key} name={f.key} label={f.label} />
          ))}
        </div>
      </FormSection>
    </div>
  );
}
