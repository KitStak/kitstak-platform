'use client';
import { toast } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { formatCurrencyValue, formatNumberValue, parseNumberInput, type NumberFormatSettings } from '../lib/format';
import { readCurrency, readNumber } from '../lib/values';
import { InlineInput } from '../parts/inline-input';
import { TruncText } from '../parts/common';

/** Roughly how many characters fit before switching to compact notation ("$1.15M"). */
function fitsWidth(text: string, width: number): boolean {
  return text.length * 7.6 + 20 <= width;
}

function NumberDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readNumber(ctx.value);
  if (value === null) return null;
  const settings = ctx.column.settings as NumberFormatSettings;
  const full = formatNumberValue(value, settings);
  const shown = fitsWidth(full, ctx.column.width) ? full : formatNumberValue(value, settings, { compact: true });
  return (
    <span className="flex min-w-0 flex-1 justify-end px-2.5 tabular-nums">
      <TruncText tooltip={full}>{shown}</TruncText>
    </span>
  );
}

function CurrencyDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readCurrency(ctx.value);
  if (!value) return null;
  const decimals = (ctx.column.settings as { decimals?: number }).decimals ?? 0;
  const full = formatCurrencyValue(value.amount, value.currency, decimals);
  const shown = fitsWidth(full, ctx.column.width) ? full : formatCurrencyValue(value.amount, value.currency, decimals, { compact: true });
  return (
    <span className="flex min-w-0 flex-1 justify-end px-2.5 tabular-nums">
      <TruncText tooltip={full}>{shown}</TruncText>
    </span>
  );
}

function validateNumber(draft: string): string | null {
  const result = parseNumberInput(draft);
  return result.ok ? null : result.message;
}

function invalidBlur(draft: string) {
  toast.error('Change not saved', `“${draft}” isn't a number.`);
}

function NumberEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readNumber(ctx.value);
  return (
    <InlineInput
      grabFocus={!ctx.preview}
      initial={ctx.seed ?? (value === null ? '' : String(value))}
      align="end"
      inputMode="decimal"
      aria-label={ctx.column.title}
      validate={validateNumber}
      onInvalidBlur={invalidBlur}
      onCancel={() => ctx.endEdit()}
      onSubmit={(draft, navigate) => {
        const parsed = parseNumberInput(draft);
        if (parsed.ok && parsed.value !== value) ctx.commit(parsed.value);
        ctx.endEdit(navigate);
      }}
    />
  );
}

function CurrencyEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readCurrency(ctx.value);
  const currency = value?.currency ?? (ctx.column.settings as { currency?: string }).currency ?? 'USD';
  return (
    <InlineInput
      grabFocus={!ctx.preview}
      initial={ctx.seed ?? (value ? String(value.amount) : '')}
      align="end"
      inputMode="decimal"
      aria-label={`${ctx.column.title} (${currency})`}
      validate={validateNumber}
      onInvalidBlur={invalidBlur}
      onCancel={() => ctx.endEdit()}
      onSubmit={(draft, navigate) => {
        const parsed = parseNumberInput(draft);
        if (parsed.ok && parsed.value !== (value?.amount ?? null)) {
          ctx.commit(parsed.value === null ? null : { amount: parsed.value, currency });
        }
        ctx.endEdit(navigate);
      }}
    />
  );
}

export const numberRenderer: CellRenderer = {
  behavior: { mode: 'inline', clearable: true, typeToEdit: true },
  Display: NumberDisplay,
  Editor: NumberEditor,
};

export const currencyRenderer: CellRenderer = {
  behavior: { mode: 'inline', clearable: true, typeToEdit: true },
  Display: CurrencyDisplay,
  Editor: CurrencyEditor,
};
