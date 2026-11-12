/** Return label inputs model (PURE): values, validation and the API payload. */
export interface ReturnLabelValue {
  readonly carrierKey: string | null;
  readonly carrierServiceId: string | null;
  readonly weightLb: number | null;
  readonly length: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export const EMPTY_LABEL: ReturnLabelValue = {
  carrierKey: null,
  carrierServiceId: null,
  weightLb: 1,
  length: 12,
  width: 10,
  height: 6,
};

export type LabelErrors = Partial<Record<keyof ReturnLabelValue, string>>;

/** Pure validation of the label inputs (returns field errors; empty when valid). */
export function validateLabel(v: ReturnLabelValue): LabelErrors {
  const e: LabelErrors = {};
  if (!v.carrierKey) e.carrierKey = 'Choose a carrier';
  if (!v.carrierServiceId) e.carrierServiceId = 'Choose a shipping service';
  if (!v.weightLb || v.weightLb <= 0) e.weightLb = 'Enter the package weight';
  else if (v.weightLb > 150) e.weightLb = 'Max 150 lb';
  if (!v.length || v.length <= 0) e.length = 'Required';
  if (!v.width || v.width <= 0) e.width = 'Required';
  if (!v.height || v.height <= 0) e.height = 'Required';
  return e;
}

/** API payload (`returnLabelSchema`) from valid inputs. */
export function labelPayload(v: ReturnLabelValue): {
  carrierConnectionId: string;
  carrierServiceId: string;
  package: { weightOz: number; length: number; width: number; height: number };
} {
  return {
    carrierConnectionId: (v.carrierKey ?? '').split('|')[0] ?? '',
    carrierServiceId: v.carrierServiceId ?? '',
    package: {
      weightOz: Math.round((v.weightLb ?? 0) * 16 * 100) / 100,
      length: v.length ?? 0,
      width: v.width ?? 0,
      height: v.height ?? 0,
    },
  };
}
