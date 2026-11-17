'use client';

/**
 * Printout designer (wizard step 3). A block designer with a live preview:
 *   - Page setup: paper or label stock (Letter / A4 / Legal, 4×6 … 2×1), font, size, accent
 *     color, logo position, barcode symbology and, for labels, the printer language (PDF / ZPL).
 *   - Layout: one ordered list of built-in sections and free blocks. Drag a row (or use the
 *     arrows / Alt+↑↓) to reorder, switch rows on or off, click a block to edit it.
 *   - Add block palette: static text, data field (record or custom field binding), barcode
 *     (8 symbologies), image (uploaded PNG/JPEG or the company logo), divider and spacer.
 *   - Preview: a WYSIWYG canvas (click a block to edit it), the server-rendered PDF against the
 *     built-in sample or a real order (embedded, or Open PDF in a new tab), and ZPL text with
 *     Copy / Download for Zebra printers.
 */
import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Barcode,
  Copy,
  Download,
  ExternalLink,
  GripVertical,
  Image as ImageIcon,
  Minus,
  MoveVertical,
  Plus,
  RefreshCw,
  Trash2,
  Type,
  Variable,
} from 'lucide-react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  BARCODE_SYMBOLOGIES,
  BINDABLE_FIELDS,
  BLOCK_KIND_LABELS,
  blockDefaults,
  blockIdOf,
  blockKeyOf,
  blockSummary,
  columnsFor,
  DOCUMENT_PAPERS,
  FONTS,
  isTwoDimensional,
  LABEL_LANGUAGES,
  LABEL_STOCKS,
  layoutSchema,
  LOGO_POSITIONS,
  MAX_BLOCKS,
  MAX_IMAGE_DATA_URL,
  moveItem,
  paperLabel,
  sectionsFor,
  SYMBOLOGY_LABELS,
  type BindableField,
  type BlockKind,
  type PrintBlock,
  type PrintoutFormValues,
  type PrintoutLayout,
  type PrintRecord,
} from '@/lib/grid-defs/admin/printouts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { NumberInput } from '@/components/ui/number-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { CanvasPreview } from './canvas-preview';
import { fetchPdfUrl, fetchText, openPdf } from './pdf-fetch';

type F = PrintoutFormValues;
const PREVIEW_DEBOUNCE_MS = 500;
const BUILT_IN = '__sample';
const LOGO_LABELS: Record<(typeof LOGO_POSITIONS)[number], string> = {
  left: 'Left',
  center: 'Center',
  right: 'Right',
  hidden: 'Hidden',
};
const ALIGNS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
] as const;

const sampleSchema = z.array(z.object({ id: z.string(), label: z.string(), description: z.string() }));
const fieldsSchema = z.object({
  builtIn: z.array(z.object({ key: z.string(), label: z.string(), sample: z.string() })),
  custom: z.array(z.object({ key: z.string(), label: z.string(), sample: z.string() })),
});

const KIND_ICON: Record<BlockKind, React.ComponentType<{ className?: string }>> = {
  text: Type,
  field: Variable,
  barcode: Barcode,
  image: ImageIcon,
  divider: Minus,
  spacer: MoveVertical,
};

interface Item {
  readonly key: string;
  readonly enabled: boolean;
}

function Labeled({
  label,
  htmlFor,
  children,
  className,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-body">
        {label}
      </label>
      {children}
    </div>
  );
}

function ColorChip({
  id,
  value,
  onChange,
  invalid,
  label,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly invalid?: boolean;
  readonly label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <label
        className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border-strong/70 shadow-xs focus-within:ring-2 focus-within:ring-primary/40"
        style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff' }}
      >
        <span className="sr-only">Pick {label}</span>
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <TextField
        id={id}
        value={value}
        maxLength={7}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        invalid={invalid}
        className="font-mono"
        aria-label={`${label} hex`}
      />
    </span>
  );
}

function usePreview(typeKey: string, layout: PrintoutLayout, sampleId: string, mode: 'pdf' | 'zpl' | null) {
  const [state, setState] = React.useState<{
    url: string | null;
    zpl: string | null;
    loading: boolean;
    error: string | null;
    ms: number | null;
  }>({ url: null, zpl: null, loading: true, error: null, ms: null });
  const [nonce, setNonce] = React.useState(0);
  const key = JSON.stringify(layout);
  const valid = layoutSchema.safeParse(layout);
  const invalid = valid.success ? null : (valid.error.issues[0]?.message ?? 'Fix the highlighted settings');
  React.useEffect(() => {
    if (!valid.success || mode === null) return;
    const ctrl = new AbortController();
    const body = { typeKey, layout: valid.data, sampleIds: sampleId === BUILT_IN ? [] : [sampleId] };
    const timer = window.setTimeout(() => {
      const started = performance.now();
      setState((st) => ({ ...st, loading: true }));
      const job =
        mode === 'zpl'
          ? fetchText('/api/printouts/preview', { ...body, format: 'zpl' }, ctrl.signal).then((text) =>
              setState((st) => ({
                ...st,
                zpl: text,
                loading: false,
                error: null,
                ms: Math.round(performance.now() - started),
              })),
            )
          : fetchPdfUrl('/api/printouts/preview', body, ctrl.signal).then((url) =>
              setState((st) => {
                if (st.url) URL.revokeObjectURL(st.url);
                return {
                  ...st,
                  url,
                  loading: false,
                  error: null,
                  ms: Math.round(performance.now() - started),
                };
              }),
            );
      job.catch((e: unknown) => {
        if (!ctrl.signal.aborted)
          setState((st) => ({
            ...st,
            loading: false,
            error: e instanceof Error ? e.message : 'Preview failed',
          }));
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey, key, sampleId, nonce, mode]);
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    urlRef.current = state.url;
  }, [state.url]);
  React.useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );
  return {
    ...state,
    loading: invalid || mode === null ? false : state.loading,
    error: invalid ?? state.error,
    refresh: () => setNonce((n) => n + 1),
  };
}

const recordsSchema = z.object({
  records: z.array(z.custom<PrintRecord>((v) => typeof v === 'object' && v !== null && 'code' in v)),
  companyName: z.string(),
  logoUrl: z.string().nullable(),
});

/** Preview records + branding for the canvas (refetched only when the sample changes). */
function useCanvasData(typeKey: string, layout: PrintoutLayout, sampleId: string) {
  const [data, setData] = React.useState<z.infer<typeof recordsSchema> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  const layoutRef = React.useRef(layout);
  React.useEffect(() => {
    layoutRef.current = layout;
  });
  React.useEffect(() => {
    const ctrl = new AbortController();
    const parsedLayout = layoutSchema.safeParse(layoutRef.current);
    if (!parsedLayout.success) return;
    setLoading(true);
    apiRequest<unknown>('/api/printouts/preview', {
      method: 'POST',
      body: {
        typeKey,
        layout: parsedLayout.data,
        sampleIds: sampleId === BUILT_IN ? [] : [sampleId],
        format: 'record',
      },
      signal: ctrl.signal,
    })
      .then(({ data: d }) => {
        const r = recordsSchema.safeParse(d);
        if (r.success) {
          setData(r.data);
          setError(null);
        } else setError('unexpected');
      })
      // The raw server message is never shown to the user; the callout carries friendly copy.
      .catch(() => {
        if (!ctrl.signal.aborted) setError('failed');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [typeKey, sampleId, nonce]);
  return { data, error, loading, retry: () => setNonce((n) => n + 1) };
}

/** Whether this page's CSP lets an iframe load a blob: URL (frame-src → child-src → default-src). PURE. */
export function cspAllowsBlobFrames(csp: string | null): boolean {
  if (!csp) return true;
  const directives = new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map((parts) => [parts[0]!.toLowerCase(), parts.slice(1)] as const),
  );
  const sources = directives.get('frame-src') ?? directives.get('child-src') ?? directives.get('default-src');
  return !sources || sources.includes('blob:') || sources.includes('*');
}

/**
 * null while unknown, then whether embedding blob: PDFs is blocked. Reads the page's own CSP
 * header up front (same-origin HEAD), so a blocked iframe is never attempted (no console error),
 * and still listens for violations as a fallback.
 */
function useFrameBlocked(): boolean | null {
  const [blocked, setBlocked] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch(window.location.pathname, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' })
      .then((res) => {
        if (alive) setBlocked(!cspAllowsBlobFrames(res.headers.get('content-security-policy')));
      })
      .catch(() => {
        if (alive) setBlocked(false);
      });
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (/frame-src|child-src|default-src/.test(e.effectiveDirective) && e.blockedURI.startsWith('blob'))
        setBlocked(true);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => {
      alive = false;
      document.removeEventListener('securitypolicyviolation', onViolation);
    };
  }, []);
  return blocked;
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      reject(new Error('Use a PNG or JPEG image'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      if (url.length > MAX_IMAGE_DATA_URL)
        reject(new Error('Image is too large. Use one under about 150 KB.'));
      else resolve(url);
    };
    reader.onerror = () => reject(new Error("Couldn't read the image"));
    reader.readAsDataURL(file);
  });
}

function BlockEditor({
  block,
  fields,
  onChange,
  family,
}: {
  readonly block: PrintBlock;
  readonly fields: readonly BindableField[];
  readonly onChange: (b: PrintBlock) => void;
  readonly family: 'document' | 'label';
}) {
  const id = `blk-${block.id}`;
  const set = <K extends keyof PrintBlock>(k: K, v: PrintBlock[K]) => onChange({ ...block, [k]: v });
  const fieldOptions = fields.map((f) => ({ value: f.key, label: f.label }));
  const fileRef = React.useRef<HTMLInputElement>(null);
  const showsText = block.kind === 'text' || block.kind === 'field';
  return (
    <div className="grid grid-cols-2 gap-3 border-t border-border bg-surface px-3 py-3">
      {block.kind === 'text' ? (
        <Labeled label="Text" htmlFor={`${id}-text`} className="col-span-2">
          <TextField
            id={`${id}-text`}
            value={block.text}
            maxLength={300}
            onChange={(e) => set('text', e.target.value)}
            placeholder="e.g. Handle with care"
          />
        </Labeled>
      ) : null}
      {block.kind === 'field' || block.kind === 'barcode' ? (
        <Labeled
          label="Bound field"
          htmlFor={`${id}-field`}
          className={block.kind === 'field' ? '' : 'col-span-2'}
        >
          <Select
            id={`${id}-field`}
            value={block.field}
            onChange={(v) => v && set('field', v)}
            options={fieldOptions}
          />
        </Labeled>
      ) : null}
      {block.kind === 'field' ? (
        <Labeled label="Caption (optional)" htmlFor={`${id}-cap`}>
          <TextField
            id={`${id}-cap`}
            value={block.text}
            maxLength={60}
            onChange={(e) => set('text', e.target.value)}
            placeholder="e.g. Ship by: "
          />
        </Labeled>
      ) : null}
      {block.kind === 'barcode' ? (
        <Labeled label="Symbology" htmlFor={`${id}-sym`}>
          <Select
            id={`${id}-sym`}
            value={block.symbology}
            onChange={(v) => v && set('symbology', v as PrintBlock['symbology'])}
            options={BARCODE_SYMBOLOGIES.map((x) => ({ value: x, label: SYMBOLOGY_LABELS[x] }))}
          />
        </Labeled>
      ) : null}
      {block.kind === 'image' ? (
        <div className="col-span-2 flex flex-wrap items-center gap-2">
          {block.imageDataUrl ? (
            <img
              src={block.imageDataUrl}
              alt=""
              className="h-10 w-auto max-w-[120px] rounded border border-border object-contain"
            />
          ) : (
            <Badge tone="neutral" size="sm">
              Uses the company logo
            </Badge>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-label="Upload image"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f)
                readImage(f)
                  .then((url) => set('imageDataUrl', url))
                  .catch((err: Error) => toast.error('Image not added', err.message));
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            {block.imageDataUrl ? 'Replace image' : 'Upload image'}
          </Button>
          {block.imageDataUrl ? (
            <Button size="sm" variant="ghost" onClick={() => set('imageDataUrl', '')}>
              Use company logo
            </Button>
          ) : null}
          <span className="text-2xs text-faint">PNG or JPEG, up to about 150 KB.</span>
        </div>
      ) : null}
      {showsText ? (
        <>
          <Labeled label="Size (pt)" htmlFor={`${id}-size`}>
            <NumberInput
              id={`${id}-size`}
              value={block.size}
              min={6}
              max={48}
              onChange={(v) => set('size', Math.min(48, Math.max(6, v ?? 10)))}
            />
          </Labeled>
          <Labeled label="Color" htmlFor={`${id}-color`}>
            <ColorChip
              id={`${id}-color`}
              label="text color"
              value={block.color}
              onChange={(v) => set('color', v)}
            />
          </Labeled>
          <div className="col-span-2 flex items-center gap-2">
            <Switch id={`${id}-bold`} checked={block.bold} onCheckedChange={(v) => set('bold', v === true)} />
            <label htmlFor={`${id}-bold`} className="text-xs text-body">
              Bold
            </label>
          </div>
        </>
      ) : null}
      {block.kind === 'barcode' ||
      block.kind === 'image' ||
      block.kind === 'spacer' ||
      block.kind === 'divider' ? (
        <Labeled
          label={
            block.kind === 'spacer'
              ? 'Gap (pt)'
              : block.kind === 'divider'
                ? 'Thickness (pt)'
                : isTwoDimensional(block.symbology) && block.kind === 'barcode'
                  ? 'Size (pt)'
                  : 'Height (pt)'
          }
          htmlFor={`${id}-h`}
        >
          <NumberInput
            id={`${id}-h`}
            value={block.height}
            min={2}
            max={family === 'label' ? 300 : 400}
            onChange={(v) => set('height', Math.min(400, Math.max(2, v ?? 12)))}
          />
        </Labeled>
      ) : null}
      {block.kind === 'barcode' || block.kind === 'image' ? (
        <Labeled label="Max width (%)" htmlFor={`${id}-w`}>
          <NumberInput
            id={`${id}-w`}
            value={block.widthPct}
            min={10}
            max={100}
            onChange={(v) => set('widthPct', Math.min(100, Math.max(10, v ?? 60)))}
          />
        </Labeled>
      ) : null}
      {block.kind === 'divider' ? (
        <Labeled label="Color" htmlFor={`${id}-color`}>
          <ColorChip
            id={`${id}-color`}
            label="line color"
            value={block.color}
            onChange={(v) => set('color', v)}
          />
        </Labeled>
      ) : null}
      {block.kind !== 'spacer' && block.kind !== 'divider' ? (
        <Labeled label="Alignment" className="col-span-2">
          <SegmentedControl
            ariaLabel="Block alignment"
            value={block.align}
            onChange={(v) => set('align', v)}
            options={ALIGNS.map((a) => ({ value: a.value, label: a.label }))}
          />
        </Labeled>
      ) : null}
    </div>
  );
}

function LayoutList({
  layout,
  typeKey,
  fields,
  onSections,
  onBlocks,
  selected,
  setSelected,
}: {
  readonly layout: PrintoutLayout;
  readonly typeKey: string;
  readonly fields: readonly BindableField[];
  readonly onSections: (items: Item[]) => void;
  readonly onBlocks: (blocks: PrintBlock[], sections?: Item[]) => void;
  readonly selected: string | null;
  readonly setSelected: (id: string | null) => void;
}) {
  const defs = sectionsFor(typeKey);
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);
  const items = layout.sections;
  const custom = fields.filter((f) => f.key.startsWith('custom:'));
  const labelOf = (key: string) => {
    const id = blockIdOf(key);
    if (id === null)
      return {
        title: defs.find((d) => d.key === key)?.label ?? key,
        hint: defs.find((d) => d.key === key)?.description,
        block: null,
      };
    const b = layout.blocks.find((x) => x.id === id) ?? null;
    return {
      title: b ? BLOCK_KIND_LABELS[b.kind] : 'Block',
      hint: b ? blockSummary(b, custom) : undefined,
      block: b,
    };
  };
  const drop = (to: number) => {
    if (dragFrom === null || dragFrom === to) return;
    const next = [...items];
    const [moved] = next.splice(dragFrom, 1);
    next.splice(to, 0, moved as Item);
    onSections(next);
  };
  const remove = (id: string) => {
    onBlocks(
      layout.blocks.filter((b) => b.id !== id),
      items.filter((x) => x.key !== blockKeyOf(id)),
    );
    if (selected === id) setSelected(null);
  };
  return (
    <ol
      className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border"
      aria-label="Layout order"
    >
      {items.map((it, i) => {
        const meta = labelOf(it.key);
        const b = meta.block;
        const Icon = b ? KIND_ICON[b.kind] : null;
        const open = b !== null && selected === b.id;
        return (
          <li
            key={it.key}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', it.key);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(i);
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            className={cn(
              'bg-surface',
              dragOver === i &&
                dragFrom !== null &&
                dragFrom !== i &&
                'shadow-[inset_0_2px_0_0_var(--color-primary)]',
              dragFrom === i && 'opacity-50',
            )}
          >
            <div
              className={cn(
                'flex items-center gap-2 px-2 py-2',
                !it.enabled && 'bg-surface-sunken/50',
                open && 'bg-primary-soft/40',
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-faint" aria-hidden />
              <span className="w-5 text-right text-2xs tabular-nums text-faint">{i + 1}</span>
              {Icon ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-info-soft text-info">
                  <Icon className="h-3.5 w-3.5" />
                </span>
              ) : null}
              <button
                type="button"
                disabled={!b}
                onClick={() => b && setSelected(open ? null : b.id)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    onSections(moveItem(items, i, e.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
                aria-expanded={b ? open : undefined}
                className={cn(
                  'min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  b && 'cursor-pointer',
                )}
              >
                <span
                  className={cn('block text-sm', it.enabled ? 'font-medium text-foreground' : 'text-faint')}
                >
                  {meta.title}
                  {b ? (
                    <span className="ml-1.5 text-2xs font-normal text-primary">
                      {open ? 'Close' : 'Edit'}
                    </span>
                  ) : null}
                </span>
                {meta.hint ? <span className="block truncate text-2xs text-faint">{meta.hint}</span> : null}
              </button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${meta.title} up`}
                disabled={i === 0}
                onClick={() => onSections(moveItem(items, i, -1))}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${meta.title} down`}
                disabled={i === items.length - 1}
                onClick={() => onSections(moveItem(items, i, 1))}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              {b ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${meta.title}`}
                  onClick={() => remove(b.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              ) : null}
              <Switch
                aria-label={`Show ${meta.title}`}
                checked={it.enabled}
                onCheckedChange={(v) =>
                  onSections(items.map((x) => (x.key === it.key ? { ...x, enabled: v === true } : x)))
                }
              />
            </div>
            {open && b ? (
              <BlockEditor
                block={b}
                fields={fields}
                family={layout.family}
                onChange={(nb) => onBlocks(layout.blocks.map((x) => (x.id === nb.id ? nb : x)))}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ColumnsList({
  items,
  labelOf,
  onChange,
}: {
  readonly items: readonly Item[];
  readonly labelOf: (k: string) => string;
  readonly onChange: (items: Item[]) => void;
}) {
  return (
    <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {items.map((it, i) => (
        <li
          key={it.key}
          className={cn('flex items-center gap-2 px-3 py-2', !it.enabled && 'bg-surface-sunken/50')}
        >
          <span className="w-5 text-right text-2xs tabular-nums text-faint">{i + 1}</span>
          <span
            className={cn(
              'min-w-0 flex-1 text-sm',
              it.enabled ? 'font-medium text-foreground' : 'text-faint',
            )}
          >
            {labelOf(it.key)}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${labelOf(it.key)} left`}
            disabled={i === 0}
            onClick={() => onChange(moveItem(items, i, -1))}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Move ${labelOf(it.key)} right`}
            disabled={i === items.length - 1}
            onClick={() => onChange(moveItem(items, i, 1))}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Switch
            aria-label={`Show ${labelOf(it.key)}`}
            checked={it.enabled}
            onCheckedChange={(v) =>
              onChange(items.map((x) => (x.key === it.key ? { ...x, enabled: v === true } : x)))
            }
          />
        </li>
      ))}
    </ol>
  );
}

function Panel({
  title,
  description,
  children,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? <p className="text-xs text-secondary">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DesignerStep({
  form,
  typeKey,
}: {
  readonly form: UseFormReturn<F>;
  readonly typeKey: string;
}) {
  const layout = useWatch({ control: form.control, name: 'layout' }) as PrintoutLayout;
  const blocks = layout.blocks ?? [];
  const [sampleId, setSampleId] = React.useState(BUILT_IN);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'canvas' | 'pdf' | 'zpl'>('canvas');
  const isLabel = layout.family === 'label';
  const zpl = isLabel && layout.labelLanguage === 'ZPL';
  const samplesQ = useApiQuery<unknown>(['printout-samples'], !isLabel ? '/api/printouts/samples' : null, {
    staleTime: 60_000,
  });
  const fieldsQ = useApiQuery<unknown>(
    ['printout-fields', typeKey],
    `/api/printouts/fields?typeKey=${encodeURIComponent(typeKey)}`,
    { staleTime: 60_000 },
  );
  const parsedFields = fieldsSchema.safeParse(fieldsQ.data?.data);
  const fields: readonly BindableField[] = parsedFields.success
    ? [...parsedFields.data.builtIn, ...parsedFields.data.custom]
    : BINDABLE_FIELDS;
  const samples = sampleSchema.safeParse(samplesQ.data?.data);
  const sampleOptions = [
    ...(samples.success
      ? samples.data.map((sm) => ({ value: sm.id, label: `${sm.label} · ${sm.description}` }))
      : samplesQ.isLoading && !isLabel
        ? [{ value: '__loading', label: 'Loading recent orders…', disabled: true }]
        : []),
    { value: BUILT_IN, label: 'Built-in sample (SO010412)' },
  ];
  // Preview against the most recent real order by default; the user's own pick always wins.
  const samplePicked = React.useRef(false);
  const firstSample = samples.success ? samples.data[0]?.id : undefined;
  React.useEffect(() => {
    if (!samplePicked.current && firstSample) setSampleId(firstSample);
  }, [firstSample]);
  const full = {
    ...layout,
    blocks,
    barcodeType: layout.barcodeType ?? 'code128',
    labelLanguage: layout.labelLanguage ?? 'PDF',
  } as PrintoutLayout;
  const frameBlocked = useFrameBlocked();
  // Render the embedded PDF only when it can actually be shown; ZPL only for ZPL labels.
  const previewMode =
    tab === 'zpl' ? (zpl ? 'zpl' : null) : tab === 'pdf' && frameBlocked === false ? 'pdf' : null;
  const preview = usePreview(typeKey, full, sampleId, previewMode);
  const canvas = useCanvasData(typeKey, full, sampleId);
  const [opening, setOpening] = React.useState(false);
  const openFullPdf = async () => {
    const parsed = layoutSchema.safeParse(full);
    if (!parsed.success) {
      toast.error('Fix the design first', parsed.error.issues[0]?.message ?? 'One setting is invalid.');
      return;
    }
    setOpening(true);
    try {
      await openPdf('/api/printouts/preview', {
        typeKey,
        layout: parsed.data,
        sampleIds: sampleId === BUILT_IN ? [] : [sampleId],
      });
    } catch (e) {
      toast.error("Couldn't open the PDF", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setOpening(false);
    }
  };
  const set = <K extends keyof PrintoutLayout>(k: K, v: PrintoutLayout[K]) =>
    form.setValue(`layout.${k}` as 'layout.paper', v as never, { shouldDirty: true, shouldValidate: true });
  const setBlocks = (next: PrintBlock[], sections?: Item[]) => {
    form.setValue('layout.blocks' as 'layout.paper', next as never, { shouldDirty: true });
    if (sections)
      form.setValue('layout.sections' as 'layout.paper', sections as never, { shouldDirty: true });
    void form.trigger('layout' as 'layout.paper');
  };
  const addBlock = (kind: BlockKind) => {
    if (blocks.length >= MAX_BLOCKS) {
      toast.error('Block limit reached', `A template can hold up to ${MAX_BLOCKS} blocks.`);
      return;
    }
    const b = blockDefaults(kind);
    const sized =
      isLabel && (kind === 'text' || kind === 'field') ? { ...b, size: layout.paper === '2x1' ? 7 : 10 } : b;
    setBlocks([...blocks, sized], [...layout.sections, { key: blockKeyOf(sized.id), enabled: true }]);
    setSelected(sized.id);
  };
  const columnDefs = columnsFor(typeKey);
  const papers = isLabel ? LABEL_STOCKS : DOCUMENT_PAPERS;
  const errors = form.formState.errors.layout;
  const errorText = errors
    ? (errors.message ??
      errors.accentColor?.message ??
      errors.fontSize?.message ??
      errors.paper?.message ??
      (errors.blocks as { message?: string } | undefined)?.message ??
      'One setting is invalid.')
    : null;
  const copyZpl = async () => {
    if (!preview.zpl) return;
    try {
      await navigator.clipboard.writeText(preview.zpl);
      toast.success('ZPL copied', 'Paste it into your printer utility or send it to port 9100.');
    } catch {
      toast.error("Couldn't copy", 'Select the text and copy it manually.');
    }
  };
  const downloadZpl = () => {
    if (!preview.zpl) return;
    const url = URL.createObjectURL(new Blob([preview.zpl], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(layout.title || 'label').replace(/[^A-Za-z0-9-]+/g, '-')}.zpl`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(380px,460px)_1fr]">
      <div className="flex flex-col gap-5">
        <Panel title="Page setup">
          <div className="grid grid-cols-2 gap-3">
            <Labeled label={isLabel ? 'Label stock' : 'Paper size'} htmlFor="pd-paper">
              <Select
                id="pd-paper"
                value={layout.paper}
                onChange={(v) => v && set('paper', v as PrintoutLayout['paper'])}
                options={papers.map((p) => ({ value: p, label: paperLabel(p) }))}
                invalid={Boolean(errors?.paper)}
              />
            </Labeled>
            {isLabel ? (
              <Labeled label="Printer language" htmlFor="pd-lang">
                <Select
                  id="pd-lang"
                  value={full.labelLanguage}
                  onChange={(v) => {
                    if (v) {
                      set('labelLanguage', v as PrintoutLayout['labelLanguage']);
                      if (v === 'PDF' && tab === 'zpl') setTab('canvas');
                    }
                  }}
                  options={LABEL_LANGUAGES.map((l) => ({
                    value: l,
                    label: l === 'PDF' ? 'PDF (any printer)' : 'ZPL II (Zebra)',
                  }))}
                />
              </Labeled>
            ) : (
              <Labeled label="Font" htmlFor="pd-font">
                <Select
                  id="pd-font"
                  value={layout.font}
                  onChange={(v) => v && set('font', v as PrintoutLayout['font'])}
                  options={FONTS.map((f) => ({ value: f, label: f }))}
                />
              </Labeled>
            )}
            {isLabel ? (
              <Labeled label="Font" htmlFor="pd-font">
                <Select
                  id="pd-font"
                  value={layout.font}
                  onChange={(v) => v && set('font', v as PrintoutLayout['font'])}
                  options={FONTS.map((f) => ({ value: f, label: f }))}
                />
              </Labeled>
            ) : null}
            <Labeled label="Font size (pt)" htmlFor="pd-size">
              <NumberInput
                id="pd-size"
                value={layout.fontSize}
                min={7}
                max={16}
                onChange={(v) => set('fontSize', Math.min(16, Math.max(7, v ?? 10)))}
                invalid={Boolean(errors?.fontSize)}
              />
            </Labeled>
            <Labeled label="Accent color" htmlFor="pd-accent">
              <ColorChip
                id="pd-accent"
                label="accent color"
                value={layout.accentColor}
                onChange={(v) => set('accentColor', v)}
                invalid={Boolean(errors?.accentColor)}
              />
            </Labeled>
            <Labeled label="Barcode symbology" htmlFor="pd-sym">
              <Select
                id="pd-sym"
                value={full.barcodeType}
                onChange={(v) => v && set('barcodeType', v as PrintoutLayout['barcodeType'])}
                options={BARCODE_SYMBOLOGIES.map((x) => ({ value: x, label: SYMBOLOGY_LABELS[x] }))}
              />
            </Labeled>
            <Labeled label="Logo position" className="col-span-2">
              <SegmentedControl
                ariaLabel="Logo position"
                value={layout.logoPosition}
                onChange={(v) => set('logoPosition', v)}
                options={LOGO_POSITIONS.map((p) => ({ value: p, label: LOGO_LABELS[p] }))}
              />
            </Labeled>
            <Labeled label="Title" htmlFor="pd-title" className="col-span-2">
              <TextField
                id="pd-title"
                value={layout.title}
                maxLength={60}
                onChange={(e) => set('title', e.target.value)}
              />
            </Labeled>
            {!isLabel ? (
              <Labeled label="Footer text" htmlFor="pd-footer" className="col-span-2">
                <TextField
                  id="pd-footer"
                  value={layout.footerText}
                  maxLength={200}
                  onChange={(e) => set('footerText', e.target.value)}
                  placeholder="e.g. Thank you for your order."
                />
              </Labeled>
            ) : null}
          </div>
        </Panel>
        {errorText ? (
          <Callout variant="error" title="Check the design settings">
            {errorText}
          </Callout>
        ) : null}
        <Panel title="Add block" description="New blocks go to the end; drag them into place.">
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Add block">
            {(Object.keys(BLOCK_KIND_LABELS) as BlockKind[]).map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => addBlock(kind)}
                  disabled={blocks.length >= MAX_BLOCKS}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-xs font-medium text-body shadow-xs transition-colors hover:border-primary/50 hover:bg-primary-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  <Icon className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden />
                  <span className="truncate">{BLOCK_KIND_LABELS[kind]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-2xs text-faint">
            {blocks.length} of {MAX_BLOCKS} blocks used.
            {fields.some((f) => f.key.startsWith('custom:'))
              ? ' Custom fields are available as Data field bindings.'
              : ''}
          </p>
        </Panel>
        <Panel
          title="Layout"
          description="Drag rows (or Alt + ↑ / ↓) to set the print order. Switch a row off to hide it; click a block to edit it."
        >
          <LayoutList
            layout={full}
            typeKey={typeKey}
            fields={fields}
            selected={selected}
            setSelected={setSelected}
            onSections={(items) => set('sections', items)}
            onBlocks={setBlocks}
          />
        </Panel>
        {columnDefs.length ? (
          <Panel title="Lines table columns">
            <ColumnsList
              items={layout.columns}
              labelOf={(k) => columnDefs.find((c) => c.key === k)?.label ?? k}
              onChange={(items) => set('columns', items)}
            />
          </Panel>
        ) : null}
      </div>
      <section
        className="flex min-h-[560px] flex-col gap-2 rounded-lg border border-border bg-surface-sunken/60 p-3 xl:sticky xl:top-2 xl:self-start"
        aria-label="Live preview"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Live preview</h3>
          <Badge tone="neutral" size="sm">
            {paperLabel(layout.paper)}
          </Badge>
          {tab !== 'canvas' && preview.loading ? (
            <Spinner className="h-3.5 w-3.5" label="Rendering preview" />
          ) : tab !== 'canvas' && preview.ms !== null ? (
            <span className="text-2xs text-faint">Rendered in {preview.ms} ms</span>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <SegmentedControl
              ariaLabel="Preview format"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'canvas', label: 'Canvas' },
                { value: 'pdf', label: 'PDF' },
                ...(zpl ? [{ value: 'zpl' as const, label: 'ZPL' }] : []),
              ]}
            />
            {!isLabel ? (
              <span className="w-72">
                <Select
                  aria-label="Preview record"
                  value={sampleId}
                  onChange={(v) => {
                    if (!v || v === '__loading') return;
                    samplePicked.current = true;
                    setSampleId(v);
                  }}
                  options={sampleOptions}
                />
              </span>
            ) : null}
            {tab !== 'canvas' ? (
              <Button size="sm" variant="ghost" onClick={preview.refresh} aria-label="Refresh preview">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void openFullPdf()}
              disabled={opening}
              aria-busy={opening}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open PDF
            </Button>
          </span>
        </div>
        {tab !== 'canvas' && preview.error ? (
          <Callout
            variant="error"
            title="Preview unavailable"
            action={
              <Button size="sm" onClick={preview.refresh}>
                Retry
              </Button>
            }
          >
            {preview.error}
          </Callout>
        ) : null}
        {tab === 'canvas' ? (
          <div className="flex flex-1 flex-col gap-2">
            {canvas.error ? (
              <Callout
                variant="attention"
                title="Showing placeholder data"
                action={
                  <Button size="sm" variant="secondary" onClick={canvas.retry}>
                    Retry
                  </Button>
                }
              >
                The selected order couldn&apos;t be loaded, so the canvas shows placeholder values. The saved
                template is not affected.
              </Callout>
            ) : null}
            {canvas.loading && !canvas.data ? (
              <p className="flex items-center gap-1.5 text-2xs text-faint">
                <Spinner className="h-3 w-3" label="Loading sample record" />
                Loading the sample record…
              </p>
            ) : null}
            <CanvasPreview
              layout={full}
              typeKey={typeKey}
              record={canvas.data?.records[0] ?? null}
              companyName={canvas.data?.companyName ?? 'KitStaks'}
              logoUrl={canvas.data?.logoUrl ?? null}
              selected={selected}
              onSelect={setSelected}
            />
            <p className="text-2xs text-faint">
              Click a block on the canvas to edit it. The PDF tab shows exact page breaks and fonts.
            </p>
          </div>
        ) : zpl && tab === 'zpl' ? (
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-secondary">
                Raw ZPL II at 203 dpi. Send it to the printer on port 9100 or through your print agent.
              </span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" disabled={!preview.zpl} onClick={() => void copyZpl()}>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button size="sm" variant="secondary" disabled={!preview.zpl} onClick={downloadZpl}>
                  <Download className="h-3.5 w-3.5" />
                  Download .zpl
                </Button>
              </span>
            </div>
            <pre
              className="min-h-[440px] flex-1 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-2xs leading-5 text-body"
              aria-label="ZPL output"
            >
              {preview.zpl ?? 'Rendering…'}
            </pre>
          </div>
        ) : frameBlocked === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-secondary">
            <Spinner className="mr-2 h-4 w-4" label="Preparing" />
            Preparing preview…
          </div>
        ) : frameBlocked ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-surface p-6 text-center">
            <p className="max-w-sm text-sm text-secondary">
              Embedded PDFs are blocked by this page&apos;s security policy. Open the rendered PDF in a new
              tab, or use the Canvas view.
            </p>
            <Button variant="primary" onClick={() => void openFullPdf()} disabled={opening}>
              <ExternalLink className="h-4 w-4" />
              Open PDF
            </Button>
          </div>
        ) : preview.url ? (
          <iframe
            title="Printout preview"
            src={`${preview.url}#toolbar=0&navpanes=0&view=FitH`}
            className={cn(
              'w-full flex-1 rounded-md border border-border bg-white transition-opacity',
              isLabel ? 'min-h-[440px]' : 'min-h-[640px]',
              preview.loading && 'opacity-60',
            )}
          />
        ) : !preview.error ? (
          <div className="flex flex-1 items-center justify-center text-sm text-secondary">
            <Spinner className="mr-2 h-4 w-4" label="Rendering" />
            Rendering preview…
          </div>
        ) : null}
      </section>
    </div>
  );
}
