'use client';

import * as React from 'react';
import { RadioGroup } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DEFAULT_SWATCHES: readonly string[] = [
  '#2E5CE6',
  '#0D36A3',
  '#621DB8',
  '#C026D3',
  '#E55B56',
  '#B20B1C',
  '#A13406',
  '#EBAC00',
  '#17874D',
  '#16C2AA',
  '#026AA2',
  '#475467',
  '#101828',
  '#98A2B3',
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

/** Readable check-mark colour on top of a swatch (relative luminance). */
export function contrastOn(hex: string): '#FFFFFF' | '#101828' {
  if (!isHexColor(hex)) return '#FFFFFF';
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#101828' : '#FFFFFF';
}

export interface ColorSwatchPickerProps {
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  readonly swatches?: readonly string[];
  /** Show a free hex input after the swatches. Default true. */
  readonly allowCustom?: boolean;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly id?: string;
}

export function ColorSwatchPicker({
  value,
  onChange,
  swatches = DEFAULT_SWATCHES,
  allowCustom = true,
  disabled,
  ariaLabel = 'Colour',
  id,
}: ColorSwatchPickerProps) {
  const [custom, setCustom] = React.useState(value && !swatches.includes(value.toUpperCase()) ? value : '');
  const normalised = value?.toUpperCase() ?? '';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RadioGroup.Root
        id={id}
        value={normalised}
        onValueChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className="flex flex-wrap gap-1.5"
        orientation="horizontal"
      >
        {swatches.map((swatch) => (
          <RadioGroup.Item
            key={swatch}
            value={swatch.toUpperCase()}
            aria-label={swatch}
            style={{ backgroundColor: swatch }}
            className="relative inline-flex h-6 w-6 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(16,24,40,0.12)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 data-[state=checked]:ring-2 data-[state=checked]:ring-foreground/70 data-[state=checked]:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RadioGroup.Indicator>
              <Check
                className="h-3.5 w-3.5"
                style={{ color: contrastOn(swatch) }}
                strokeWidth={3}
                aria-hidden
              />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {allowCustom ? (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Custom hex colour</span>
          <span
            className="h-6 w-6 rounded-full border border-border"
            style={{ backgroundColor: isHexColor(custom) ? custom : 'transparent' }}
            aria-hidden
          />
          <input
            value={custom}
            disabled={disabled}
            placeholder="#RRGGBB"
            maxLength={7}
            onChange={(e) => {
              const next = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
              setCustom(next);
              if (isHexColor(next)) onChange(next.toUpperCase());
            }}
            aria-invalid={custom !== '' && !isHexColor(custom) ? true : undefined}
            className={cn(
              'h-7 w-[92px] rounded-md border border-border-strong/70 bg-surface px-2 font-mono text-xs focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25 aria-[invalid=true]:border-danger',
            )}
          />
        </label>
      ) : null}
    </div>
  );
}
