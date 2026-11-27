'use client';

/**
 * Product detail › Pack types & barcodes, edited in place (Logiwa Edit Product › Pack Type).
 * Shows the pack hierarchy (Case = 12 × Each = 12 units, Pallet = 40 × Case = 480 units), then
 * the Primary, Hierarchical and Irregular cards with their rendered barcodes. Users with
 * Products › Edit add, edit and delete packs and barcodes through the wizard's pack type modal;
 * every change is saved at once (PATCH `{ packTypes, version }`) with a toast, and the page
 * refetches. Server rules still apply (barcode uniqueness per client, a pack with stock can't be
 * removed or renamed); a rejected change rolls the cards back and says why.
 */
import * as React from 'react';
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form';
import { ArrowRight, Box, Boxes, Layers } from 'lucide-react';
import { apiFetch, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import {
  normalizePackTypes,
  newPackType,
  type PackKind,
  type PackTypeFormValue,
  type ProductFormValues,
} from '@/lib/grid-defs/products/product-form';
import type { ProductCategory } from '@/lib/grid-defs/products/catalog-options';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SkeletonText } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProductWizardProvider } from './wizard/context';
import { PackTypeModal } from './wizard/pack-type-modal';
import { AddCard, PackCard, packsAfterRemove, packsAfterSave } from './wizard/step-pack-types';
import type { ProductDetailData } from './catalog-shared';

/* ---------------- hierarchy ---------------- */

export interface HierarchyNode {
  readonly key: string;
  readonly packType: string;
  readonly kind: PackKind;
  readonly parentKey: string | null;
  readonly childQty: number | null;
  readonly uomQty: number;
}

export interface HierarchyLine {
  readonly node: HierarchyNode;
  readonly depth: number;
  /** "12 × Each" for a hierarchical pack, null for the primary and irregulars. */
  readonly made: string | null;
}

/** Primary first, then each hierarchical pack under the pack it contains (depth-first). */
export function packHierarchy(nodes: readonly HierarchyNode[]): {
  readonly tree: readonly HierarchyLine[];
  readonly irregular: readonly HierarchyNode[];
} {
  const primary = nodes.find((n) => n.kind === 'Primary');
  const hier = nodes.filter((n) => n.kind === 'Hierarchical');
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const parentOf = (n: HierarchyNode) =>
    n.parentKey && byKey.has(n.parentKey) ? n.parentKey : (primary?.key ?? null);
  const tree: HierarchyLine[] = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    for (const child of hier.filter((h) => parentOf(h) === key && !seen.has(h.key))) {
      seen.add(child.key);
      tree.push({ node: child, depth, made: `${child.childQty ?? 2} × ${byKey.get(key)?.packType ?? '?'}` });
      walk(child.key, depth + 1);
    }
  };
  if (primary) {
    tree.push({ node: primary, depth: 0, made: null });
    walk(primary.key, 1);
  }
  // Orphans (no primary yet) still show.
  for (const h of hier)
    if (!seen.has(h.key)) tree.push({ node: h, depth: 1, made: `${h.childQty ?? 2} × ?` });
  return { tree, irregular: nodes.filter((n) => n.kind === 'Irregular') };
}

export function PackHierarchy({
  nodes,
  className,
}: {
  readonly nodes: readonly HierarchyNode[];
  readonly className?: string;
}) {
  const { tree, irregular } = packHierarchy(nodes);
  const primary = nodes.find((n) => n.kind === 'Primary');
  if (!primary) return null;
  const unit = primary.packType;
  return (
    <section
      aria-label="Pack hierarchy"
      className={cn('rounded-lg border border-border bg-surface-sunken/50 px-4 py-3', className)}
    >
      <p className="text-2xs font-semibold text-faint">Pack hierarchy</p>
      <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" data-testid="pack-hierarchy">
        {tree.map((line, i) => (
          <li key={line.node.key} className="flex items-center gap-2">
            {i > 0 ? <ArrowRight className="h-3.5 w-3.5 text-faint" aria-hidden /> : null}
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 shadow-xs">
              {line.node.kind === 'Primary' ? (
                <Box className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Layers className="h-3.5 w-3.5 text-primary" aria-hidden />
              )}
              <span className="font-semibold text-foreground">{line.node.packType}</span>
              {line.made ? (
                <span className="text-secondary">= {line.made}</span>
              ) : (
                <span className="text-secondary">base unit</span>
              )}
              {line.node.kind !== 'Primary' ? (
                <span className="tabular-nums text-faint">
                  · {line.node.uomQty} {unit}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {irregular.length ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
          <Boxes className="h-3.5 w-3.5 text-faint" aria-hidden />
          Irregular:
          {irregular.map((n) => (
            <Badge key={n.key} tone="neutral">
              {n.packType} · {n.uomQty} {unit}
            </Badge>
          ))}
        </p>
      ) : null}
    </section>
  );
}

/** Hierarchy nodes from the detail payload (read-only view). */
export function hierarchyFromView(packs: ProductDetailData['packTypes']): HierarchyNode[] {
  const byName = new Map(packs.map((p) => [p.packType, p.id]));
  return packs.map((p) => ({
    key: p.id,
    packType: p.packType,
    kind: p.kind,
    parentKey: p.parentPackType ? (byName.get(p.parentPackType) ?? null) : null,
    childQty: p.childQty,
    uomQty: p.uomQty,
  }));
}

function hierarchyFromForm(packs: readonly PackTypeFormValue[]): HierarchyNode[] {
  return normalizePackTypes(packs).map((p) => ({
    key: p.key,
    packType: p.packType,
    kind: p.kind,
    parentKey: p.parentKey ?? null,
    childQty: p.childQty ?? null,
    uomQty: p.uomQty,
  }));
}

/* ---------------- editor ---------------- */

type FormPayload = ProductFormValues & { id: string; version: number; clientName: string };

export function PackTypesEditor({
  productId,
  category,
  onSaved,
}: {
  readonly productId: string;
  readonly category: ProductCategory;
  readonly onSaved: () => void;
}) {
  const q = useApiQuery<FormPayload>(['product-form', productId], `/api/products/${productId}`, {
    query: { view: 'form' },
    staleTime: 60_000,
  });
  const data = q.data?.data;
  if (q.isPending) return <SkeletonText lines={6} />;
  if (q.error || !data)
    return (
      <Callout
        variant="error"
        title="Could not load the pack types"
        action={
          <Button size="sm" onClick={() => void q.refetch()}>
            Retry
          </Button>
        }
      >
        {q.error?.message ?? 'Try again.'}
      </Callout>
    );
  return (
    <EditorForm key={`${data.id}:${data.version}`} payload={data} category={category} onSaved={onSaved} />
  );
}

function EditorForm({
  payload,
  category,
  onSaved,
}: {
  readonly payload: FormPayload;
  readonly category: ProductCategory;
  readonly onSaved: () => void;
}) {
  const form = useForm<{ clientId: string | null; packTypes: PackTypeFormValue[] }>({
    defaultValues: { clientId: payload.clientId, packTypes: payload.packTypes },
  });
  return (
    <FormProvider {...form}>
      <ProductWizardProvider
        category={category}
        mode="edit"
        productId={payload.id}
        clientName={payload.clientName}
      >
        <Board payload={payload} onSaved={onSaved} />
      </ProductWizardProvider>
    </FormProvider>
  );
}

function describeChange(before: readonly PackTypeFormValue[], after: readonly PackTypeFormValue[]): string {
  const added = after.filter((a) => !before.some((b) => b.key === a.key));
  const removed = before.filter((b) => !after.some((a) => a.key === b.key));
  if (added[0])
    return `${added[0].packType} was added${added[0].barcodes.length ? ` with ${added[0].barcodes.length} barcode${added[0].barcodes.length === 1 ? '' : 's'}` : ''}.`;
  if (removed[0]) return `${removed[0].packType} and its barcodes were removed.`;
  const changed = after.find(
    (a) => JSON.stringify(a) !== JSON.stringify(before.find((b) => b.key === a.key)),
  );
  return changed ? `${changed.packType} was updated.` : 'Pack types were saved.';
}

function Board({ payload, onSaved }: { readonly payload: FormPayload; readonly onSaved: () => void }) {
  const form = useFormContext<{ clientId: string | null; packTypes: PackTypeFormValue[] }>();
  const packs =
    (useWatch({ control: form.control, name: 'packTypes' }) as PackTypeFormValue[] | undefined) ?? [];
  const [modal, setModal] = React.useState<{ kind: PackKind; value: PackTypeFormValue } | null>(null);
  const [toDelete, setToDelete] = React.useState<PackTypeFormValue | null>(null);
  const [saving, setSaving] = React.useState(false);
  const version = React.useRef(payload.version);
  const primary = packs.find((p) => p.kind === 'Primary');
  const hierarchicals = packs.filter((p) => p.kind === 'Hierarchical');
  const irregulars = packs.filter((p) => p.kind === 'Irregular');

  const persist = async (next: PackTypeFormValue[]) => {
    const before = form.getValues('packTypes');
    form.setValue('packTypes', next);
    setSaving(true);
    try {
      const r = await apiFetch<{ version: number }>(`/api/products/${payload.id}`, {
        method: 'PATCH',
        body: { packTypes: next, version: version.current },
      });
      version.current = r.version;
      toast.success('Pack types saved', describeChange(before, next));
      onSaved();
    } catch (error) {
      form.setValue('packTypes', before);
      if (isApiError(error) && error.code === 'CONFLICT') {
        toast.error(
          'This product changed since you opened it',
          'Reload to see the latest pack types, then try again.',
          { action: { label: 'Reload', onClick: () => window.location.reload() }, duration: Infinity },
        );
      } else {
        const fieldMsg = isApiError(error) ? error.fieldErrors.packTypes?.[0] : undefined;
        toast.error(
          'Pack types not saved',
          fieldMsg ?? (isApiError(error) ? error.message : 'Something went wrong. Try again.'),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const open = (kind: PackKind, value?: PackTypeFormValue) =>
    setModal({ kind, value: value ?? newPackType(kind, packs) });
  const busy = saving ? 'Saving…' : null;
  const card = (p: PackTypeFormValue) => (
    <PackCard
      key={p.key}
      pack={p}
      all={packs}
      onEdit={saving ? undefined : () => open(p.kind, p)}
      onDelete={saving || p.kind === 'Primary' ? undefined : () => setToDelete(p)}
    />
  );
  const noPrimary = primary ? busy : 'Add the primary (UOM) pack type first';

  return (
    <div className="flex flex-col gap-4" data-testid="pack-types-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-secondary">
          Changes save immediately. Scanning any barcode identifies its pack.
        </p>
        {saving ? (
          <span role="status" className="flex items-center gap-1.5 text-xs text-secondary">
            <Spinner className="h-3 w-3" />
            Saving…
          </span>
        ) : null}
      </div>
      <PackHierarchy nodes={hierarchyFromForm(packs)} />
      <PackGroup title="Primary (UOM)" description="The base unit every quantity is counted in.">
        {primary ? (
          card(primary)
        ) : (
          <AddCard
            icon={Box}
            title="Add primary (UOM) pack type"
            description="Dimensions, weight and barcodes of one unit."
            onAdd={() => open('Primary')}
            disabledReason={busy}
          />
        )}
      </PackGroup>
      <PackGroup
        title={`Hierarchical (${hierarchicals.length})`}
        description="Nested packs: Case = n × Unit, Pallet = n × Case."
      >
        {hierarchicals.map(card)}
        <AddCard
          icon={Layers}
          title="Add hierarchical pack type"
          description="Its UOM quantity is derived from child qty."
          onAdd={() => open('Hierarchical')}
          disabledReason={noPrimary}
        />
      </PackGroup>
      <PackGroup
        title={`Irregular (${irregulars.length})`}
        description="Alternate packs outside the hierarchy, e.g. a 3-pack."
      >
        {irregulars.map(card)}
        <AddCard
          icon={Boxes}
          title="Add irregular pack type"
          description="Its UOM quantity is entered directly."
          onAdd={() => open('Irregular')}
          disabledReason={noPrimary}
        />
      </PackGroup>
      {modal ? (
        <PackTypeModal
          open
          onOpenChange={(o) => (o ? null : setModal(null))}
          kind={modal.kind}
          initial={modal.value}
          packs={packs}
          clientId={payload.clientId}
          onSave={(pack) => void persist(packsAfterSave(packs, pack))}
        />
      ) : null}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => (o ? null : setToDelete(null))}
        variant="danger"
        title={`Delete pack type ${toDelete?.packType ?? ''}?`}
        description={`Its ${toDelete?.barcodes.length ?? 0} barcode${toDelete?.barcodes.length === 1 ? '' : 's'} are removed too. Packs nested in it move up one level. A pack type with stock on hand can't be deleted.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (toDelete) await persist(packsAfterRemove(packs, toDelete));
        }}
      />
    </div>
  );
}

function PackGroup({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title.replace(/ \(\d+\)$/, '')}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-secondary">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{children}</div>
    </section>
  );
}
