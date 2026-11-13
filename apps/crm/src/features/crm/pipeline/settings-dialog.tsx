'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import {
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@/components/ui';
import type { CrmUserDto, FunnelStageDto, PipelineSettingsInput } from '@/server/services/crm-contracts';
import { StagePill } from '../components/crm-ui';

export type SettingsTab = 'stages' | 'quotas' | 'risk';

export interface PipelineSettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialTab: SettingsTab;
  readonly boardId: string;
  readonly stages: readonly FunnelStageDto[];
  readonly probabilities: Readonly<Record<string, number>>;
  readonly quotas: Readonly<Record<string, number>>;
  readonly staleDays: number;
  readonly users: readonly CrmUserDto[];
  readonly currency: string;
  readonly onSave: (input: PipelineSettingsInput) => Promise<unknown>;
}

/** Inline validation for an integer field in [min, max]; null when valid (empty counts as invalid). */
export function intFieldError(raw: string, min: number, max: number, unit = ''): string | null {
  if (raw.trim() === '') return 'Required';
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 'Whole numbers only';
  if (value < min || value > max) return `Between ${min} and ${max}${unit}`;
  return null;
}

/** Quota field: empty = no quota; otherwise a non-negative number. */
export function quotaFieldError(raw: string): string | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 'Enter a number';
  if (value < 0) return 'Can’t be negative';
  return null;
}

/** Stage probabilities, per-rep quarterly quotas and the at-risk rule in one dialog. */
export function PipelineSettingsDialog(props: PipelineSettingsDialogProps) {
  // The dialog is opened from several buttons without a Radix Trigger, so remember the opener
  // and give focus back to it on close (layout effect runs before Radix moves focus inside).
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (props.open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      opener.current = document.activeElement;
    }
  }, [props.open]);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        size="md"
        data-testid="crm-pipeline-settings"
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        {props.open ? <SettingsForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, message }: { readonly id: string; readonly message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="col-span-2 -mt-1 flex items-center justify-end gap-1 text-xs text-danger-text">
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}

function SettingsForm({
  initialTab,
  boardId,
  stages,
  probabilities,
  quotas,
  staleDays,
  users,
  currency,
  onSave,
  onOpenChange,
}: PipelineSettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [probs, setProbs] = useState<Record<string, string>>(() =>
    Object.fromEntries(stages.map((stage) => [stage.label.id, String(probabilities[stage.label.id] ?? stage.probability)])),
  );
  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(users.map((user) => [user.id, quotas[user.id] !== undefined ? String(quotas[user.id]) : ''])),
  );
  const [stale, setStale] = useState(String(staleDays));
  const [saving, setSaving] = useState(false);

  const openStages = stages.filter((stage) => stage.kind === 'open');
  const probErrors = Object.fromEntries(openStages.map((stage) => [stage.label.id, intFieldError(probs[stage.label.id] ?? '', 0, 100, '%')]));
  const quotaErrors = Object.fromEntries(users.map((user) => [user.id, quotaFieldError(quotaDraft[user.id] ?? '')]));
  const staleError = intFieldError(stale, 1, 365, ' days');
  const invalid = {
    stages: Object.values(probErrors).some(Boolean),
    quotas: Object.values(quotaErrors).some(Boolean),
    risk: Boolean(staleError),
  };
  const hasErrors = invalid.stages || invalid.quotas || invalid.risk;

  const save = async () => {
    if (hasErrors) return;
    const stageProbabilities = Object.fromEntries(openStages.map((stage) => [stage.label.id, Number(probs[stage.label.id])]));
    const nextQuotas = Object.fromEntries(
      Object.entries(quotaDraft)
        .filter(([, raw]) => raw.trim() !== '')
        .map(([id, raw]) => [id, Number(raw)]),
    );
    setSaving(true);
    try {
      await onSave({ boardId, stageProbabilities, quotas: nextQuotas, staleDays: Number(stale) });
      toast.success('Pipeline settings saved');
      onOpenChange(false);
    } catch {
      // The mutation already rolled back and showed an error toast.
    } finally {
      setSaving(false);
    }
  };

  const tabLabel = (label: string, bad: boolean) => (
    <>
      {label}
      {bad ? <span aria-label="has errors" className="ml-1 inline-block size-1.5 rounded-full bg-danger" /> : null}
    </>
  );

  return (
    <>
      <DialogHeader title="Pipeline settings" description="Tune how the forecast is weighted and what counts as at risk." />
      <DialogBody className="pb-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
          <TabsList className="mb-4">
            <TabsTrigger value="stages">{tabLabel('Stage probability', invalid.stages)}</TabsTrigger>
            <TabsTrigger value="quotas">{tabLabel('Quotas', invalid.quotas)}</TabsTrigger>
            <TabsTrigger value="risk">{tabLabel('At-risk rule', invalid.risk)}</TabsTrigger>
          </TabsList>
          <TabsContent value="stages" className="flex flex-col gap-2">
            <p className="mb-1 text-sm text-fg-secondary">Weighted value = deal value × stage probability (0 to 100%). Won is always 100%, lost 0%.</p>
            {stages.map((stage) => {
              const locked = stage.kind !== 'open';
              const error = locked ? null : (probErrors[stage.label.id] ?? null);
              const errorId = `prob-error-${stage.label.id}`;
              return (
                <div key={stage.label.id} className="grid grid-cols-[1fr_112px] items-center gap-x-3 gap-y-1">
                  <StagePill label={stage.label} className="justify-self-start" />
                  <Input
                    size="sm"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    disabled={locked}
                    invalid={Boolean(error)}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error ? errorId : undefined}
                    aria-label={`${stage.label.name} probability (%)`}
                    value={locked ? String(stage.kind === 'won' ? 100 : 0) : (probs[stage.label.id] ?? '')}
                    onChange={(event) => setProbs((current) => ({ ...current, [stage.label.id]: event.target.value }))}
                    trailing={<span className="text-sm text-fg-muted">%</span>}
                    data-testid="crm-prob-input"
                  />
                  <FieldError id={errorId} message={error} />
                </div>
              );
            })}
          </TabsContent>
          <TabsContent value="quotas" className="flex flex-col gap-2">
            <p className="mb-1 text-sm text-fg-secondary">Quarterly quota in {currency}. Monthly and yearly views scale it. Leave empty for no quota.</p>
            {users.map((user) => {
              const error = quotaErrors[user.id] ?? null;
              const errorId = `quota-error-${user.id}`;
              return (
                <div key={user.id} className="grid grid-cols-[1fr_160px] items-center gap-x-3 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={user.name} src={user.image} size="sm" colorKey={user.id} />
                    <span className="truncate text-base text-fg">{user.name}</span>
                  </span>
                  <Input
                    size="sm"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="No quota"
                    invalid={Boolean(error)}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error ? errorId : undefined}
                    aria-label={`${user.name} quarterly quota`}
                    value={quotaDraft[user.id] ?? ''}
                    onChange={(event) => setQuotaDraft((current) => ({ ...current, [user.id]: event.target.value }))}
                  />
                  <FieldError id={errorId} message={error} />
                </div>
              );
            })}
          </TabsContent>
          <TabsContent value="risk" className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5" htmlFor="crm-stale-days">
              <span className="text-sm font-semibold text-fg-secondary">Flag open deals with no activity for</span>
            </label>
            <Input
              id="crm-stale-days"
              size="md"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              containerClassName="max-w-40"
              invalid={Boolean(staleError)}
              aria-invalid={Boolean(staleError) || undefined}
              aria-describedby={staleError ? 'crm-stale-error' : undefined}
              value={stale}
              onChange={(event) => setStale(event.target.value)}
              trailing={<span className="text-sm text-fg-muted">days</span>}
            />
            {staleError ? (
              <p id="crm-stale-error" role="alert" className="flex items-center gap-1 text-xs text-danger-text">
                <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                {staleError}
              </p>
            ) : null}
            <p className="text-sm text-fg-muted">Activity = a logged call, email, meeting or an update on the deal. Deals past their close date are always flagged.</p>
          </TabsContent>
        </Tabs>
      </DialogBody>
      <DialogFooter>
        {hasErrors ? <span className="mr-auto text-sm text-danger-text">Fix the highlighted fields to save.</span> : null}
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={hasErrors} data-testid="crm-settings-save">
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
