'use client';

/**
 * Location Zone › "Match With Product Groups" (Logiwa parity): one row per zone (grouped by
 * warehouse) with a multi-select of product groups. Saves only the zones that changed, with a
 * change-log entry per zone. Put-away and picking rules read `meta.productGroupIds`.
 */
import * as React from 'react';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { sameIdSet } from '@/lib/grid-defs/admin/lookups';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';

const dataSchema = z.object({
  zones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      code: z.string().nullable(),
      warehouseCode: z.string().nullable(),
      isActive: z.boolean(),
      productGroupIds: z.array(z.string()),
    }),
  ),
  groups: z.array(
    z.object({ id: z.string(), name: z.string(), clientName: z.string().nullable(), isActive: z.boolean() }),
  ),
});

export const ZONE_GROUPS_QUERY_KEY = ['zone-product-groups'] as const;

export function ZoneGroupsDialog({
  open,
  onOpenChange,
  canEdit,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly canEdit: boolean;
  readonly onSaved: () => void;
}) {
  const qc = useQueryClient();
  const q = useApiQuery<unknown>(
    ZONE_GROUPS_QUERY_KEY,
    open ? '/api/company/lookups/location_zone/product-groups' : null,
    { staleTime: 0 },
  );
  const parsed = dataSchema.safeParse(q.data?.data);
  const data = parsed.success ? parsed.data : null;
  const [draft, setDraft] = React.useState<Record<string, readonly string[]>>({});
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!open) setDraft({});
  }, [open]);
  const valueOf = (zoneId: string, saved: readonly string[]) => draft[zoneId] ?? saved;
  const changed = data
    ? data.zones.filter((z) => draft[z.id] && !sameIdSet(draft[z.id] ?? [], z.productGroupIds))
    : [];
  const options = (data?.groups ?? []).map((g) => ({
    value: g.id,
    label: g.name,
    description: [g.clientName ?? 'All clients', g.isActive ? null : 'Inactive'].filter(Boolean).join(' · '),
  }));
  const byWarehouse = new Map<string, NonNullable<typeof data>['zones']>();
  for (const z of data?.zones ?? [])
    byWarehouse.set(z.warehouseCode ?? 'No warehouse', [
      ...(byWarehouse.get(z.warehouseCode ?? 'No warehouse') ?? []),
      z,
    ]);

  const save = async () => {
    if (!changed.length) return;
    setSaving(true);
    try {
      const { data: r } = await apiRequest<{ updated: number }>(
        '/api/company/lookups/location_zone/product-groups',
        {
          method: 'PUT',
          body: {
            assignments: changed.map((z) => ({ zoneId: z.id, productGroupIds: [...(draft[z.id] ?? [])] })),
          },
        },
      );
      toast.success(
        'Product groups matched',
        r.updated === 1 ? '1 zone updated' : `${r.updated} zones updated`,
      );
      void qc.invalidateQueries({ queryKey: ZONE_GROUPS_QUERY_KEY });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't save", isApiError(e) ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) onOpenChange(o);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader
          title="Match With Product Groups"
          description="Choose the product groups each zone stores. Put-away suggests these zones for products in the matched groups."
        />
        <DialogBody className="flex flex-col gap-4">
          {q.isError ? (
            <Callout
              variant="error"
              title="Couldn't load zones"
              action={
                <Button size="sm" onClick={() => void q.refetch()}>
                  Retry
                </Button>
              }
            >
              Check your connection and try again.
            </Callout>
          ) : null}
          {q.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : null}
          {data && data.zones.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-secondary">
              Create a location zone first, then match it with product groups.
            </p>
          ) : null}
          {data && data.zones.length > 0 && data.groups.length === 0 ? (
            <Callout variant="info" title="No product groups yet">
              Create product groups in Data Setup › Product Group to match them with zones.
            </Callout>
          ) : null}
          {data
            ? [...byWarehouse.entries()].map(([wh, zones]) => (
                <section key={wh} className="flex flex-col gap-2">
                  <h3 className="text-2xs font-bold text-faint">{wh}</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {zones.map((z) => {
                      const value = valueOf(z.id, z.productGroupIds);
                      const dirty = draft[z.id] !== undefined && !sameIdSet(value, z.productGroupIds);
                      return (
                        <li
                          key={z.id}
                          className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[200px_1fr]"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground" title={z.name}>
                              {z.name}
                            </span>
                            {z.code ? <span className="shrink-0 text-2xs text-faint">{z.code}</span> : null}
                            {!z.isActive ? (
                              <Badge size="sm" tone="neutral">
                                Inactive
                              </Badge>
                            ) : null}
                            {dirty ? (
                              <Badge size="sm" tone="info">
                                Changed
                              </Badge>
                            ) : null}
                          </span>
                          <Combobox
                            multiple
                            aria-label={`Product groups for ${z.name}`}
                            options={options}
                            value={value}
                            disabled={!canEdit || saving}
                            placeholder="No product groups"
                            emptyText="No product group matches"
                            onChange={(next) => setDraft((d) => ({ ...d, [z.id]: next }))}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            : null}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-xs text-faint">
            {changed.length
              ? `${changed.length} ${changed.length === 1 ? 'zone' : 'zones'} changed`
              : 'No changes yet'}
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={!canEdit || saving || changed.length === 0}
            aria-busy={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
