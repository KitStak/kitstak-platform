'use client';

/**
 * Quick Count / Instant Count (M07 checklist 8). Scan a location, enter the counted qty
 * per SKU / lot, submit. Creates an `IC<timestamp>` Instant Count plan through
 * `POST /api/counts/instant`, which executes the count task; with "Update inventory now"
 * the variances post straight to the ledger, and a count with no difference always
 * closes as Inventory Updated, so no open line is left behind.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ClipboardCheck,
  MapPin,
  ScanLine,
  Search,
  Zap,
} from 'lucide-react';
import { unitsLabel } from '@/lib/grid-defs/counts/count-math';
import { DeltaBadge } from './count-badges';
import { apiFetch } from '@/lib/api-client';
import { useMe } from '@/lib/permissions-client';
import { useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FieldError, FieldLabel } from '@/components/ui/form';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { YesNoToggle } from '@/components/ui/yes-no-toggle';
import { LookupSelect, WarehouseSelect } from '@/components/shared/entity-pickers';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import {
  CountEntryTable,
  countedValueError,
  draftsError,
  draftsFromBuckets,
  toPayload,
  type EntryDraft,
  type SheetBucket,
} from './count-entry-table';
import { errorMessage, useCountCan, COUNT_QUERY_TIMEOUT_MS } from './counts-client';

interface InstantLocation {
  readonly locationId: string;
  readonly code: string;
  readonly warehouseId: string;
  readonly buckets: readonly SheetBucket[];
  readonly openCount: string | null;
  /** Open Lock Locations plan holding the location: the quick count is refused. */
  readonly lockedBy?: string | null;
  readonly blind?: boolean;
}

interface InstantResult {
  readonly planId: string;
  readonly code: string;
  readonly status: string;
  readonly varianceLines: number;
  readonly awaitingApproval?: boolean;
}

export function InstantCountModal({
  open,
  onOpenChange,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDone: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        {open ? <Body onOpenChange={onOpenChange} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  onOpenChange,
  onDone,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onDone: () => void;
}) {
  const router = useRouter();
  const me = useMe();
  const canUpdate = useCountCan([P.updateInv, P.mobileInstantUpdate], 'any').allowed;
  const ctx = me.data?.data;
  // Same default as the Create New Count wizard: working-context warehouse, else the only one, else the busiest in scope.
  const canPlan = useCountCan([P.create, P.edit], 'any').allowed;
  const nextCode = useApiQuery<{ code: string; defaultWarehouseId?: string | null }>(
    ['count-next-code'],
    canPlan ? '/api/counts/next-code' : null,
    { timeoutMs: COUNT_QUERY_TIMEOUT_MS },
  );
  const warehouses = ctx?.contextOptions.warehouses ?? [];
  const initialWarehouse =
    ctx?.context.warehouseId ??
    (warehouses.length === 1 ? (warehouses[0]?.id ?? null) : null) ??
    nextCode.data?.data.defaultWarehouseId ??
    warehouses[0]?.id ??
    null;
  const [pickedWarehouse, setWarehouseId] = React.useState<string | null>(null);
  const warehouseId = pickedWarehouse ?? initialWarehouse;
  const [code, setCode] = React.useState('');
  const [location, setLocation] = React.useState<InstantLocation | null>(null);
  const [drafts, setDrafts] = React.useState<readonly EntryDraft[]>([]);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [looking, setLooking] = React.useState(false);
  const [updateWanted, setUpdateNow] = React.useState(true);
  const updateNow = canUpdate && updateWanted;
  const [reasonId, setReasonId] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  /** Review step before a posting quick count (critic r5: a −78% shrink posted in one click). */
  const [reviewing, setReviewing] = React.useState(false);
  /** Submit errors render inside the modal, never as a toast over its primary action. */
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const scanRef = React.useRef<HTMLInputElement>(null);

  const lookup = async () => {
    const scanned = code.trim();
    if (!warehouseId) {
      setLookupError('Choose a warehouse first');
      return;
    }
    if (!scanned) {
      setLookupError('Scan or type a location code');
      scanRef.current?.focus();
      return;
    }
    setLooking(true);
    setLookupError(null);
    try {
      const loc = await apiFetch<InstantLocation>('/api/counts/instant/location', {
        query: { warehouseId, code: scanned },
      });
      setLocation(loc);
      setDrafts(draftsFromBuckets(loc.buckets));
      setTried(false);
    } catch (error) {
      setLocation(null);
      setDrafts([]);
      setLookupError(errorMessage(error, 'The location could not be found.'));
      requestAnimationFrame(() => scanRef.current?.select());
    } finally {
      setLooking(false);
    }
  };

  const entryError = draftsError(drafts);
  const invalidValue = drafts.some((d) => countedValueError(d.counted));
  const diffs = invalidValue ? [] : drafts.filter((d) => d.counted !== null && d.counted !== d.systemQty);
  const unitsUp = diffs.reduce((s, d) => s + Math.max(0, (d.counted ?? 0) - d.systemQty), 0);
  const unitsDown = diffs.reduce((s, d) => s + Math.max(0, d.systemQty - (d.counted ?? 0)), 0);
  // A posting quick count with differences needs an adjustment reason (same server rule as Update Inv.).
  const reasonRequired = updateNow && diffs.length > 0;
  const reasonMissing = reasonRequired && !reasonId;
  const belowAllocated = diffs.filter((d) => (d.allocated ?? 0) > 0 && (d.counted ?? 0) < (d.allocated ?? 0));
  const submitReason = !location
    ? 'Scan a location first'
    : location.lockedBy
      ? `Locked by count plan ${location.lockedBy}`
      : invalidValue
        ? 'Fix the invalid counted quantities'
        : reasonMissing
          ? 'Choose an adjustment reason: counted quantities differ from the system'
          : saving
            ? 'Submitting…'
            : null;
  const reset = () => {
    setLocation(null);
    setDrafts([]);
    setCode('');
    setTried(false);
    setReviewing(false);
    setSubmitError(null);
  };

  /** First click validates; a posting count with differences opens the review step first. */
  const proceed = () => {
    setTried(true);
    setSubmitError(null);
    if (!location || !warehouseId || entryError || reasonMissing) return;
    if (updateNow && diffs.length > 0 && !reviewing) {
      setReviewing(true);
      return;
    }
    void submit();
  };

  const submit = async () => {
    if (!location || !warehouseId || entryError) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await apiFetch<InstantResult>('/api/counts/instant', {
        method: 'POST',
        body: {
          warehouseId,
          locationId: location.locationId,
          entries: toPayload(drafts),
          updateInventory: updateNow,
          reasonId,
        },
      });
      const closed = res.status === 'Inventory Updated';
      toast.show({
        variant: 'success',
        title: 'Success',
        message: closed
          ? `${res.code}: ${location.code} counted and inventory updated.`
          : res.awaitingApproval
            ? `${res.code}: ${location.code} counted. The difference waits for a supervisor to approve it with Update Inv. (four-eyes rule).`
            : `${res.code}: ${location.code} counted. ${res.varianceLines} line waits for Update Inv.`,
        action: {
          label: 'Open count',
          onClick: () => router.push(`/counts/${encodeURIComponent(res.code)}`),
        },
      });
      onDone();
      reset();
      requestAnimationFrame(() => scanRef.current?.focus());
    } catch (error) {
      setSubmitError(errorMessage(error, 'The count could not be submitted.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader
        title="Quick count"
        description="Creates an Instant Count plan (IC + timestamp) and closes it in one step."
      />
      <DialogBody>
        <div className="flex flex-col gap-4">
          <form
            noValidate
            className="grid grid-cols-1 gap-3 md:grid-cols-[300px_1fr_auto] md:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="ic-wh" required>
                Warehouse
              </FieldLabel>
              <WarehouseSelect
                id="ic-wh"
                value={warehouseId}
                onChange={(v) => {
                  setWarehouseId(v);
                  setLocation(null);
                  setDrafts([]);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="ic-loc" required>
                Location
              </FieldLabel>
              <TextField
                id="ic-loc"
                ref={scanRef}
                autoFocus
                value={code}
                maxLength={120}
                placeholder={warehouseId ? 'Scan or type a location code' : 'Choose a warehouse first'}
                onChange={(e) => {
                  setCode(e.target.value);
                  setLookupError(null);
                }}
                invalid={Boolean(lookupError)}
                className={lookupError ? undefined : 'focus-within:border-focus focus-within:ring-focus/20'}
                aria-describedby={lookupError ? 'ic-loc-err' : undefined}
                leading={<ScanLine className="h-4 w-4 text-faint" aria-hidden />}
              />
              <FieldError id="ic-loc-err" message={lookupError ?? undefined} />
            </div>
            <Button type="submit" variant="secondary" className="md:mt-[22px]" disabled={looking}>
              {looking ? <Spinner className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" aria-hidden />}
              Find
            </Button>
          </form>

          {location ? (
            <section aria-label={`Count ${location.code}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-soft px-2.5 py-1 text-sm font-semibold text-primary">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {location.code}
                </span>
                <span className="text-xs text-secondary">
                  {location.buckets.length} {location.buckets.length === 1 ? 'bucket' : 'buckets'} expected
                </span>
              </div>
              {location.lockedBy ? (
                <Callout variant="error" title={`Locked by count plan ${location.lockedBy}`}>
                  <Link
                    className="font-semibold text-primary hover:underline"
                    href={`/counts/${encodeURIComponent(location.lockedBy)}`}
                  >
                    {location.lockedBy}
                  </Link>{' '}
                  holds this location (Lock Locations), so a quick count can&apos;t change its stock. Count it
                  on that plan&apos;s count sheet, or finish or cancel the plan first.
                </Callout>
              ) : location.openCount ? (
                <Callout variant="attention" title="This location is already in an open count">
                  Count plan{' '}
                  <Link
                    className="font-semibold text-primary hover:underline"
                    href={`/counts/${encodeURIComponent(location.openCount)}`}
                  >
                    {location.openCount}
                  </Link>{' '}
                  is waiting for it. A quick count still works, but the other count will compare against the
                  new quantity.
                </Callout>
              ) : null}
              {reviewing ? (
                <ReviewPanel
                  code={location.code}
                  diffs={diffs}
                  unitsUp={unitsUp}
                  unitsDown={unitsDown}
                  expected={drafts.length}
                  belowAllocated={belowAllocated.length}
                />
              ) : (
                <CountEntryTable
                  drafts={drafts}
                  onChange={(next) => {
                    setDrafts(next);
                    setSubmitError(null);
                  }}
                  warehouseId={location.warehouseId}
                  disabled={saving}
                  showErrors={tried}
                  idPrefix="ic"
                  blind={Boolean(location.blind)}
                />
              )}
              {tried && entryError ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {entryError}
                </p>
              ) : null}
              {reviewing ? null : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <FieldLabel
                      htmlFor="ic-update"
                      info="When off, counted differences wait on the count plan for Update Inv. A count with no difference always closes."
                    >
                      Update inventory now
                    </FieldLabel>
                    <DisabledReason
                      reason={canUpdate ? null : "You don't have permission to update inventory from a count"}
                    >
                      <span>
                        <YesNoToggle
                          id="ic-update"
                          value={updateNow}
                          onChange={setUpdateNow}
                          disabled={!canUpdate}
                          ariaLabel="Update inventory now"
                        />
                      </span>
                    </DisabledReason>
                  </div>
                  <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor="ic-reason" required={reasonRequired}>
                      Adjustment reason
                    </FieldLabel>
                    <LookupSelect
                      id="ic-reason"
                      type="adjustment_reason"
                      aria-label="Adjustment reason"
                      value={reasonId}
                      onChange={(v) => {
                        setReasonId(v);
                        setSubmitError(null);
                      }}
                      placeholder={reasonRequired ? 'Select a reason' : 'Required when a quantity differs'}
                      disabled={!updateNow}
                      invalid={reasonMissing && tried}
                      clearable
                    />
                    <FieldError
                      id="ic-reason-err"
                      message={
                        reasonMissing
                          ? diffs.length === 1
                            ? '1 bucket differs from the system: choose a reason before submitting'
                            : `${diffs.length} buckets differ from the system: choose a reason before submitting`
                          : undefined
                      }
                    />
                  </div>
                </div>
              )}
              {submitError ? (
                <Callout variant="error" title="The count was not submitted">
                  {submitError}
                </Callout>
              ) : null}
            </section>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Zap className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-foreground">Scan a location to start</p>
              <p className="max-w-[420px] text-xs text-secondary">
                The expected SKUs, lots and LPs appear here. Enter what you see on the shelf, then submit. The
                next location is ready to scan right after.
              </p>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        {reviewing ? (
          <Button variant="secondary" onClick={() => setReviewing(false)} disabled={saving}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to counts
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Close
          </Button>
        )}
        <DisabledReason reason={submitReason}>
          <Button variant="primary" disabled={Boolean(submitReason)} onClick={proceed}>
            {saving ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : reviewing ? (
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Zap className="h-3.5 w-3.5" aria-hidden />
            )}
            {reviewing
              ? 'Post to inventory'
              : updateNow && diffs.length > 0
                ? 'Review and submit'
                : 'Submit count'}
          </Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}

/** Units added / removed and the differing buckets, confirmed before a quick count posts (same KPIs as Update Inv.). */
function ReviewPanel({
  code,
  diffs,
  unitsUp,
  unitsDown,
  expected,
  belowAllocated,
}: {
  readonly code: string;
  readonly diffs: readonly EntryDraft[];
  readonly unitsUp: number;
  readonly unitsDown: number;
  readonly expected: number;
  readonly belowAllocated: number;
}) {
  const system = diffs.reduce((s, d) => s + d.systemQty, 0);
  const net = unitsUp - unitsDown;
  return (
    <div className="flex flex-col gap-3" data-testid="quick-count-review">
      <Callout
        variant={unitsDown > 0 && system > 0 && unitsDown / system > 0.05 ? 'attention' : 'info'}
        title={`Review before posting to ${code}`}
      >
        <p className="text-xs">
          {diffs.length === 1 ? '1 bucket differs' : `${diffs.length} of ${expected} buckets differ`} from the
          system. Posting writes Count transactions now; net change {net > 0 ? '+' : net < 0 ? '−' : ''}
          {unitsLabel(Math.abs(net))}.
        </p>
      </Callout>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <span className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-success-soft text-success">
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-md font-semibold tabular-nums text-foreground">
              {unitsUp.toLocaleString()}
            </span>
            <span className="text-2xs text-secondary">{unitsUp === 1 ? 'unit added' : 'units added'}</span>
          </span>
        </span>
        <span className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-danger-soft text-danger">
            <ArrowDownRight className="h-4 w-4" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-md font-semibold tabular-nums text-foreground">
              {unitsDown.toLocaleString()}
            </span>
            <span className="text-2xs text-secondary">
              {unitsDown === 1 ? 'unit removed' : 'units removed'}
            </span>
          </span>
        </span>
      </div>
      {belowAllocated > 0 ? (
        <Callout
          variant="attention"
          title={
            belowAllocated === 1
              ? '1 bucket is counted below its allocated qty'
              : `${belowAllocated} buckets are counted below their allocated qty`
          }
        >
          <p className="text-xs">
            Unpicked orders holding this stock are shorted first, with an allocation exception on each order.
            Picked or in-job stock can&apos;t be posted: the count is then refused and nothing changes.
          </p>
        </Callout>
      ) : null}
      <div className="ks-scroll max-h-[260px] overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-surface-sunken text-2xs font-semibold text-faint">
            <tr>
              <th scope="col" className="px-2.5 py-1.5">
                SKU
              </th>
              <th scope="col" className="px-2.5 py-1.5">
                Lot / LP
              </th>
              <th scope="col" className="px-2.5 py-1.5 text-right">
                System
              </th>
              <th scope="col" className="px-2.5 py-1.5 text-right">
                Counted
              </th>
              <th scope="col" className="px-2.5 py-1.5 text-right">
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={d.key} className="border-t border-border">
                <td className="px-2.5 py-1.5 font-semibold text-foreground">
                  {d.sku}
                  {d.damageReason ? (
                    <span className="ml-1.5 text-2xs font-semibold text-danger">Damaged</span>
                  ) : null}
                </td>
                <td className="px-2.5 py-1.5 text-secondary">
                  {[d.lotNumber, d.lpNumber].filter(Boolean).join(' · ') || 'None'}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{d.systemQty.toLocaleString()}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{(d.counted ?? 0).toLocaleString()}</td>
                <td className="px-2.5 py-1.5 text-right">
                  <DeltaBadge value={(d.counted ?? 0) - d.systemQty} system={d.systemQty} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
