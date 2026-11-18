'use client';
/**
 * Quick add: client, job name, units, price per unit, Enter. The job starts at once with the
 * General job type and a quote made from the price. "More options" opens the full wizard.
 */
import { useId, useRef, useState } from 'react';
import { CornerDownLeft, Plus } from 'lucide-react';
import { Button, Input, toast } from '@/components/ui';
import { ButtonLink } from '@/components/pulse/button-link';
import { formatMoney } from '@/lib/format';
import { mulQuantityPrice } from '@/lib/money';
import { routes } from '@/lib/routes';
import type { ClientDTO, JobDetailDTO } from '@/lib/types';
import { deleteJobAction, quickAddJobAction } from '@/server/actions/jobs';

const NUMBER = /^\d+(\.\d{1,3})?$/;
const PRICE = /^\d+(\.\d{1,4})?$/;

function clean(value: string): string {
  return value.trim().replace(/[$,\s]/g, '');
}

export function QuickAddJob({
  clients,
  onAdded,
}: {
  readonly clients: readonly ClientDTO[];
  readonly onAdded: (job: JobDetailDTO) => void;
}) {
  const listId = useId();
  const clientRef = useRef<HTMLInputElement>(null);
  const [client, setClient] = useState('');
  const [name, setName] = useState('');
  const [units, setUnits] = useState('');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);

  const unitsText = clean(units);
  const priceText = clean(price);
  const preview =
    NUMBER.test(unitsText) && PRICE.test(priceText) ? mulQuantityPrice(unitsText, priceText) : null;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!client.trim()) next.client = 'Pick a client or type a new name.';
    if (!name.trim()) next.name = 'Give the job a name.';
    if (unitsText && !NUMBER.test(unitsText)) next.units = 'Type a number, like 5000.';
    if (priceText && !PRICE.test(priceText)) next.price = 'Type a price, like 1.25.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const match = clients.find((item) => item.name.toLowerCase() === client.trim().toLowerCase());
    setSaving(true);
    const result = await quickAddJobAction({
      clientId: match?.id ?? null,
      clientName: match ? null : client.trim(),
      name: name.trim(),
      plannedUnits: unitsText || null,
      unitPrice: priceText || null,
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error("Couldn't add the job", result.error.message);
      return;
    }
    const job = result.data;
    setName('');
    setUnits('');
    setPrice('');
    onAdded(job);
    clientRef.current?.focus();
    toast.undo(`Added ${job.number}: ${job.name}`, {
      id: `job-add:${job.id}`,
      description: 'It is active from today. Open it to add a plan and see the margin.',
      onUndo: async () => {
        const gone = await deleteJobAction({ jobId: job.id });
        if (!gone.ok) toast.error("Couldn't undo", gone.error.message);
        onAdded(job);
      },
    });
  };

  const firstError =
    errors.client ??
    errors.clientId ??
    errors.name ??
    errors.units ??
    errors.plannedUnits ??
    errors.price ??
    errors.unitPrice ??
    null;

  return (
    <form
      data-testid="quick-add"
      aria-label="Quick add a job"
      className="hidden rounded-xl border border-dashed border-border-default bg-panel p-3 md:block"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(100px,1.1fr)_minmax(110px,1.6fr)_84px_104px_auto_auto] lg:grid-cols-[minmax(140px,1.1fr)_minmax(160px,1.6fr)_110px_120px_auto_auto] md:items-center">
        <div className="col-span-2 md:col-span-1">
          <Input
            ref={clientRef}
            list={listId}
            value={client}
            onChange={(event) => setClient(event.target.value)}
            placeholder="Client"
            aria-label="Client"
            invalid={Boolean(errors.client ?? errors.clientId)}
            autoComplete="off"
            data-testid="quick-client"
          />
          <datalist id={listId}>
            {clients.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </div>
        <div className="col-span-2 md:col-span-1">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Job name, like Holiday gift kits"
            aria-label="Job name"
            invalid={Boolean(errors.name)}
            maxLength={200}
            data-testid="quick-name"
          />
        </div>
        <Input
          value={units}
          onChange={(event) => setUnits(event.target.value)}
          placeholder="Units"
          aria-label="Units to make"
          inputMode="decimal"
          invalid={Boolean(errors.units ?? errors.plannedUnits)}
          data-testid="quick-units"
        />
        <Input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder="Price each"
          aria-label="Price per unit"
          inputMode="decimal"
          leadingIcon={<span className="text-fg-muted">$</span>}
          invalid={Boolean(errors.price ?? errors.unitPrice)}
          data-testid="quick-price"
        />
        <Button
          type="submit"
          loading={saving}
          leadingIcon={<Plus aria-hidden />}
          trailingIcon={<CornerDownLeft aria-hidden className="hidden opacity-60 lg:block" />}
          data-testid="quick-submit"
        >
          Add job
        </Button>
        <ButtonLink href={routes.newJob({ name: name.trim() || undefined })} variant="ghost">
          More options
        </ButtonLink>
      </div>
      <p className="mt-2 text-xs text-fg-muted" aria-live="polite">
        {firstError ? (
          <span role="alert" className="font-medium text-danger-text">
            {firstError}
          </span>
        ) : preview !== null ? (
          <>
            That is <span className="font-medium text-fg tabular-nums">{formatMoney(preview)}</span> of
            revenue. Open the job after to add a plan and see the margin.
          </>
        ) : (
          'Fast way in: type the four boxes and press Enter. The job starts today.'
        )}
      </p>
    </form>
  );
}
