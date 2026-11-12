'use client';

/**
 * Bulk Update Return Info (Logiwa header action on Return Orders). Each field has an
 * "Update" checkbox: only ticked fields are sent, so untouched fields keep their values;
 * a ticked empty field clears it. Completed / cancelled RMAs are skipped server-side and
 * reported in the per-id result.
 */
import * as React from 'react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { bulkMessage, type BulkOutcome } from './return-types';

type Key =
  'expectedReturnDate' | 'carrierCode' | 'carrierServiceName' | 'trackingNumber' | 'fromCountry' | 'note';

const FIELDS: readonly { key: Key; label: string; max: number; placeholder?: string }[] = [
  { key: 'expectedReturnDate', label: 'Expected return date', max: 40 },
  { key: 'carrierCode', label: 'Return carrier', max: 60, placeholder: 'e.g. UPS' },
  { key: 'carrierServiceName', label: 'Return shipping option', max: 120, placeholder: 'e.g. Ground' },
  { key: 'trackingNumber', label: 'Return tracking number', max: 80 },
  { key: 'fromCountry', label: 'From country', max: 80 },
  { key: 'note', label: 'Note', max: 1000 },
];

/** Payload for the ticked fields only (pure; exported for tests). */
export function bulkInfoPayload(
  on: Readonly<Partial<Record<Key, boolean>>>,
  values: Readonly<Partial<Record<Key, string>>>,
): Partial<Record<Key, string | null>> {
  const out: Partial<Record<Key, string | null>> = {};
  for (const f of FIELDS) if (on[f.key]) out[f.key] = values[f.key]?.trim() ? values[f.key]!.trim() : null;
  return out;
}

const toIsoDate = (d: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : '';

export function BulkReturnInfoModal({
  open,
  onOpenChange,
  ids,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly ids: readonly string[];
  readonly onDone: () => void;
}) {
  const [on, setOn] = React.useState<Partial<Record<Key, boolean>>>({});
  const [values, setValues] = React.useState<Partial<Record<Key, string>>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time the modal opens
    if (open) {
      setOn({});
      setValues({});
      setError(null);
    }
  }, [open]);

  const set = (k: Key, v: string) => {
    setValues((p) => ({ ...p, [k]: v }));
    setOn((p) => ({ ...p, [k]: true }));
  };
  const payload = bulkInfoPayload(on, values);
  const none = Object.keys(payload).length === 0;

  const submit = async () => {
    if (none) {
      setError('Tick at least one field to update.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiRequest<BulkOutcome>('/api/returns/bulk-info', {
        method: 'POST',
        body: { ids, ...payload },
      });
      if (data.succeeded.length === 0)
        toast.error('Nothing updated', data.failed[0]?.message ?? bulkMessage(data, 'updated'));
      else toast.success('Return info updated', bulkMessage(data, 'updated'));
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not update the returns.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Bulk update return info"
          description={`${ids.length} ${ids.length === 1 ? 'return' : 'returns'} selected. Only ticked fields change; a ticked empty field is cleared.`}
        />
        <DialogBody className="space-y-3">
          {FIELDS.map((f) => {
            const id = `bri-${f.key}`;
            return (
              <div key={f.key} className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2">
                <Checkbox
                  className="mt-6"
                  aria-label={`Update ${f.label.toLowerCase()}`}
                  checked={Boolean(on[f.key])}
                  onCheckedChange={(c) => setOn((p) => ({ ...p, [f.key]: c === true }))}
                />
                <label htmlFor={id} className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium text-body">{f.label}</span>
                  {f.key === 'expectedReturnDate' ? (
                    <DatePicker
                      id={id}
                      value={
                        values.expectedReturnDate ? new Date(`${values.expectedReturnDate}T00:00:00`) : null
                      }
                      onChange={(d) => set('expectedReturnDate', toIsoDate(d))}
                      clearable
                      aria-label={f.label}
                    />
                  ) : f.key === 'note' ? (
                    <Textarea
                      id={id}
                      rows={2}
                      maxLength={f.max}
                      value={values.note ?? ''}
                      onChange={(e) => set('note', e.target.value)}
                      placeholder="Replaces the RMA note"
                    />
                  ) : (
                    <Input
                      id={id}
                      maxLength={f.max}
                      value={values[f.key] ?? ''}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                </label>
              </div>
            );
          })}
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={saving || none}
            title={none ? 'Tick at least one field' : undefined}
          >
            {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
            Update {ids.length} {ids.length === 1 ? 'return' : 'returns'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
