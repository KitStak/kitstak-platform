'use client';
/**
 * The fix for an extra service entry with no price, right on its row: "Set the price" opens a
 * small form, and an entry that came from the warehouse also links to the warehouse contract,
 * where a rate for the service prices every later record.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, toast } from '@/components/ui';
import { refreshAfterEntry, readNumber } from '@/features/costs/ledger-kit';
import { shortDate } from '@/lib/profit/calendar';
import type { VasEntryDTO } from '@/lib/types';
import { saveVasEntryAction } from '@/server/actions/entries';

/** The look of a link that leaves Pulse: link color, always underlined, with the "opens elsewhere" icon. */
export const OUT_LINK_CLASS =
  'inline-flex items-center gap-1 rounded-sm text-xs font-medium whitespace-nowrap text-fg-link underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** The warehouse billing page, where a client contract holds the rate of each service. Null when the entry has no warehouse link. */
export function warehouseContractUrl(entry: Pick<VasEntryDTO, 'source' | 'sourceUrl'>): string | null {
  if (entry.source !== 'wms' || !entry.sourceUrl) return null;
  try {
    return `${new URL(entry.sourceUrl).origin}/billing`;
  } catch {
    return null;
  }
}

/** "From the warehouse" as a real link back to the warehouse record, or plain words when the warehouse is off the plan. */
export function WarehouseSourceLink({ entry, className, testId }: { readonly entry: Pick<VasEntryDTO, 'source' | 'sourceUrl'>; readonly className?: string; readonly testId?: string }) {
  if (entry.source !== 'wms') return null;
  if (!entry.sourceUrl) return <span className={className ?? 'text-xs text-fg-muted'}>From the warehouse</span>;
  return (
    <a href={entry.sourceUrl} target="_blank" rel="noreferrer" title="The warehouse keeps the date, the service and the count of this entry. Opens the warehouse in a new tab." className={className ?? OUT_LINK_CLASS} data-testid={testId}>
      From the warehouse
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A link to the warehouse contract for a warehouse entry with no price. Nothing for any other entry. */
export function WarehouseContractLink({ entry, testId }: { readonly entry: Pick<VasEntryDTO, 'source' | 'sourceUrl' | 'noPrice'>; readonly testId?: string }) {
  const href = entry.noPrice ? warehouseContractUrl(entry) : null;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" title="Add a rate for this service to the client's contract in the warehouse. The next sync prices the entry." className={OUT_LINK_CLASS} data-testid={testId}>
      Open the warehouse contract
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * "Set the price" for one entry with no price. `canEdit` is the reader's `vas:manage` right.
 * A locked entry (its month is closed) says so in place of the button.
 */
export function SetEntryPrice({ entry, serviceName, unitWord, canEdit, perHour }: { readonly entry: VasEntryDTO; readonly serviceName: string; readonly unitWord: string; readonly canEdit: boolean; readonly perHour: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!entry.noPrice || !canEdit || entry.moneyHidden) return null;
  if (entry.locked) return <span className="text-xs text-fg-muted">Its month is closed</span>;

  const save = async () => {
    const amount = readNumber(price.replace(/[$,]/g, '').trim(), 4);
    if (amount === null || Number(amount) <= 0) return setError('Type the price of one, like 0.35.');
    setBusy(true);
    setError(null);
    try {
      const result = await saveVasEntryAction({
        id: entry.id,
        version: entry.version,
        vasServiceId: entry.vasServiceId,
        jobId: entry.jobId,
        clientId: entry.jobId ? null : entry.clientId,
        workDate: entry.workDate,
        quantity: entry.quantity,
        unitPrice: amount,
        laborClassId: entry.laborClassId,
        headcount: entry.headcount,
        hours: entry.hours,
        overtimeHours: entry.overtimeHours,
        materialCents: entry.materialCents,
        note: entry.note,
      });
      if (!result.ok) return setError(result.error.message);
      setOpen(false);
      setPrice('');
      await refreshAfterEntry(queryClient);
      toast.success('Price set', `${serviceName} on ${shortDate(entry.workDate)} now earns its price.`);
    } catch {
      setError('Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid={`set-price-${entry.id}`}>
        Set the price
      </Button>
      {open ? (
        <Dialog open onOpenChange={(next) => (!next && !busy ? setOpen(false) : undefined)}>
          <DialogContent size="sm" data-testid="set-price-dialog">
            <DialogHeader title="Set the price" description={`${serviceName} on ${shortDate(entry.workDate)} has no price, so the work earns nothing on paper yet.`} />
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <DialogBody>
                <Field label={perHour ? 'Price of one hour' : `Price of one ${unitWord}`} error={error} hint={entry.source === 'wms' ? 'This sets the price of this entry only. A rate on the warehouse contract prices the ones that come in later.' : 'This sets the price of this entry only.'} required>
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      aria-invalid={invalid || undefined}
                      inputMode="decimal"
                      autoFocus
                      value={price}
                      onChange={(event) => {
                        setPrice(event.target.value);
                        setError(null);
                      }}
                      data-testid="set-price-input"
                    />
                  )}
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                  Not now
                </Button>
                <Button type="submit" loading={busy} data-testid="set-price-save">
                  Save the price
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
