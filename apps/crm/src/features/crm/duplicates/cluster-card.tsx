'use client';
import { useState } from 'react';
import Link from 'next/link';
import { GitMerge, Info, Link2, X } from 'lucide-react';
import { Badge, Button, Checkbox, ConfirmDialog, cn, toast } from '@/components/ui';
import type { DuplicateClusterDto, DuplicateRecordDto } from '@/server/services/crm-contracts';
import { useDismissDuplicates, useMergeDuplicates } from '../api';
import { Radio } from '../components/crm-ui';
import { plural, relativeDay } from '../lib/format';
import { differingFields, fieldChoicesToSend, initialChoices, initialIncluded } from './merge-plan';

export type DuplicateKind = 'contacts' | 'accounts';

const REASON: Readonly<Record<DuplicateClusterDto['reason'], string>> = {
  email: 'Same email address',
  domain: 'Same website domain',
  name: 'Same name',
};

interface ClusterCardProps {
  readonly cluster: DuplicateClusterDto;
  readonly kind: DuplicateKind;
  readonly orgSlug: string;
  readonly canEdit: boolean;
}

/** One group of suspected duplicates: side-by-side compare, per-field winners, merge / dismiss. */
export function ClusterCard({ cluster, kind, orgSlug, canEdit }: ClusterCardProps) {
  const [primaryId, setPrimaryId] = useState(cluster.suggestedPrimaryId);
  const [included, setIncluded] = useState<string[]>(() => initialIncluded(cluster, cluster.suggestedPrimaryId));
  const [choices, setChoices] = useState<Record<string, string>>(() => initialChoices(cluster, cluster.suggestedPrimaryId));
  const [confirming, setConfirming] = useState(false);
  const merge = useMergeDuplicates();
  const dismiss = useDismissDuplicates();
  const primary = cluster.records.find((record) => record.id === primaryId);
  const mergeIds = included.filter((id) => id !== primaryId);
  const recordNoun = kind === 'contacts' ? 'contact' : 'account';
  const isPossible = cluster.confidence !== 'high';
  const conflicts = cluster.fields.filter((field) => field.conflict);
  const busy = merge.isPending || dismiss.isPending;

  const choosePrimary = (id: string) => {
    setPrimaryId(id);
    setIncluded((current) => {
      const next = current.filter((entry) => entry !== id);
      // Keep the previous primary in the merge set only for high-confidence groups.
      return isPossible ? next : [...new Set([...next, primaryId])].filter((entry) => entry !== id);
    });
    setChoices(initialChoices(cluster, id));
  };

  const toggleIncluded = (id: string, on: boolean) => {
    setIncluded((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));
    if (!on) {
      // A record that is no longer merged cannot win a field.
      setChoices((current) =>
        Object.fromEntries(Object.entries(current).map(([key, winner]) => [key, winner === id ? primaryId : winner])),
      );
    }
  };

  const doMerge = async () => {
    try {
      const result = await merge.mutateAsync({
        kind,
        primaryId,
        duplicateIds: mergeIds,
        fieldChoices: fieldChoicesToSend(cluster, choices, primaryId, mergeIds),
        clusterKey: cluster.key,
      });
      setConfirming(false);
      merge.afterSuccess(result);
      toast.undo(`Merged ${plural(result.mergedIds.length, recordNoun)} into ${result.primary.name}`, {
        description: [
          result.movedLinks > 0 ? `${plural(result.movedLinks, 'relation')} moved` : null,
          result.filledFields.length > 0 ? `updated ${result.filledFields.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        onUndo: async () => {
          try {
            await merge.restore(result.mergedIds, result.primary.id);
            toast.success('Merge undone', 'The records, their fields and relations are back as they were.');
          } catch {
            toast.error('Couldn’t undo the merge', 'Restore the records from Trash instead.');
          }
        },
      });
    } catch {
      setConfirming(false);
    }
  };

  const doDismiss = () => {
    const itemIds = cluster.records.map((record) => record.id);
    dismiss.mutate(
      { kind, itemIds, clusterKey: cluster.key },
      {
        onSuccess: () =>
          toast.undo('Marked as not duplicates', {
            onUndo: () => dismiss.undo(kind, itemIds),
          }),
      },
    );
  };

  const notDuplicates = (
    <Button
      variant={isPossible ? 'secondary' : 'ghost'}
      size="sm"
      leadingIcon={<X aria-hidden />}
      onClick={doDismiss}
      disabled={busy}
      data-testid="crm-not-duplicates"
    >
      Not duplicates
    </Button>
  );
  const mergeButton = (
    <Button
      variant={isPossible ? 'secondary' : 'primary'}
      size="sm"
      leadingIcon={<GitMerge aria-hidden />}
      disabled={mergeIds.length === 0 || busy}
      onClick={() => setConfirming(true)}
      data-testid="crm-merge"
    >
      {mergeIds.length > 0 ? `Merge ${mergeIds.length}` : 'Merge'}
    </Button>
  );

  return (
    <article
      aria-label={`Suspected duplicates: ${cluster.records.map((record) => record.name).join(', ')}`}
      data-testid="crm-duplicate-cluster"
      data-confidence={cluster.confidence}
      className="rounded-lg border border-border-subtle bg-panel shadow-xs"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isPossible ? 'neutral' : 'primary'}>{isPossible ? 'Possible' : 'High confidence'}</Badge>
          <span className="text-sm text-fg-secondary">{REASON[cluster.reason]}</span>
          {conflicts.length > 0 ? (
            <Badge tone="warning" size="sm">
              {plural(conflicts.length, 'field')} differ
            </Badge>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            {notDuplicates}
            {mergeButton}
          </div>
        ) : null}
      </header>
      {isPossible ? (
        <p className="flex items-start gap-2 border-b border-border-subtle bg-sunken px-4 py-2.5 text-sm text-fg-secondary">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
          Only the name matches. Check the details below — nothing is selected for merging until you tick a record.
        </p>
      ) : null}
      <CompareTable
        cluster={cluster}
        kind={kind}
        orgSlug={orgSlug}
        canEdit={canEdit}
        primaryId={primaryId}
        included={included}
        choices={choices}
        onPrimary={choosePrimary}
        onInclude={toggleIncluded}
        onChoose={(key, id) => setChoices((current) => ({ ...current, [key]: id }))}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive
        loading={merge.isPending}
        title={`Merge ${plural(mergeIds.length, recordNoun)} into ${primary?.name ?? 'the kept record'}?`}
        description={[
          conflicts.length > 0 ? 'Conflicting fields keep the values you picked.' : null,
          'Empty fields are filled from the duplicates, every relation (deals, contacts, activities) moves to the kept record, and the duplicates go to Trash. You can undo right after.',
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Merge"
        onConfirm={() => void doMerge()}
      />
    </article>
  );
}

interface CompareTableProps {
  readonly cluster: DuplicateClusterDto;
  readonly kind: DuplicateKind;
  readonly orgSlug: string;
  readonly canEdit: boolean;
  readonly primaryId: string;
  readonly included: readonly string[];
  readonly choices: Readonly<Record<string, string>>;
  readonly onPrimary: (id: string) => void;
  readonly onInclude: (id: string, on: boolean) => void;
  readonly onChoose: (key: string, id: string) => void;
}

function CompareTable({ cluster, kind, orgSlug, canEdit, primaryId, included, choices, onPrimary, onInclude, onChoose }: CompareTableProps) {
  const href = (id: string) => `/${orgSlug}/crm/${kind}/${id}`;
  const isActive = (record: DuplicateRecordDto) => record.id === primaryId || included.includes(record.id);
  const columnClass = (record: DuplicateRecordDto) =>
    cn(
      'min-w-[176px] px-3 py-2 align-top sm:min-w-[200px] transition-colors duration-[var(--duration-fast)]',
      record.id === primaryId && 'bg-primary-subtle/40',
      !isActive(record) && 'text-fg-secondary',
    );
  return (
    <div className="overflow-x-auto" data-testid="crm-duplicate-compare">
      {cluster.records.length > 1 ? (
        <p className="px-4 pt-2 text-xs text-fg-muted sm:hidden">Scroll sideways to compare all {cluster.records.length} records.</p>
      ) : null}
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Field-by-field comparison of {cluster.records.map((record) => record.name).join(', ')}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-24 min-w-24 border-b sm:w-32 sm:min-w-32 border-border-subtle bg-panel px-4 py-3 text-left text-xs font-semibold text-fg-muted">
              Field
            </th>
            {cluster.records.map((record) => {
              const isPrimary = record.id === primaryId;
              const differs = differingFields(cluster, record.id, primaryId);
              return (
                <th key={record.id} scope="col" className={cn(columnClass(record), 'border-b border-border-subtle py-3 text-left font-normal')}>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={href(record.id)}
                        title={record.name}
                        className="min-w-0 truncate rounded-sm text-base font-semibold text-fg outline-none hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {record.name}
                      </Link>
                      {isPrimary ? <Badge tone="primary">Keep</Badge> : null}
                    </div>
                    {canEdit ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                          <Radio name={`primary-${cluster.key}`} value={record.id} checked={isPrimary} onChange={onPrimary} testId="crm-keep-radio" />
                          Keep this one
                        </label>
                        {!isPrimary ? (
                          <Checkbox
                            size="sm"
                            checked={included.includes(record.id)}
                            onCheckedChange={(checked) => onInclude(record.id, checked === true)}
                            label="Merge"
                            data-testid="crm-merge-include"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <p className="text-xs text-fg-muted">
                      {isPrimary
                        ? 'Kept record'
                        : differs.length > 0
                          ? `Differs: ${differs.join(', ')}`
                          : 'No conflicting values'}
                    </p>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {cluster.fields.map((field) => (
            <tr key={field.key} data-conflict={field.conflict || undefined}>
              <th
                scope="row"
                className={cn(
                  'sticky left-0 z-10 border-b border-border-subtle bg-panel px-4 py-2 text-left align-top text-xs font-medium text-fg-secondary',
                  field.conflict && 'shadow-[inset_3px_0_0_var(--warning)]',
                )}
              >
                {field.title}
                {field.conflict ? <span className="mt-0.5 block text-2xs font-semibold text-warning-text">Differs</span> : null}
              </th>
              {cluster.records.map((record) => {
                const value = record.fields[field.key] ?? null;
                const selectable = canEdit && field.conflict && value !== null && isActive(record);
                return (
                  <td key={record.id} className={cn(columnClass(record), 'border-b border-border-subtle', field.conflict && 'bg-warning-subtle/30')}>
                    {selectable ? (
                      <label className="flex cursor-pointer items-start gap-2 text-fg">
                        <Radio
                          name={`field-${cluster.key}-${field.key}`}
                          value={record.id}
                          checked={choices[field.key] === record.id}
                          onChange={(id) => onChoose(field.key, id)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 break-words">{value}</span>
                      </label>
                    ) : (
                      <span className={cn('block break-words', value === null ? 'text-fg-muted' : 'text-fg')}>{value ?? '—'}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="sticky left-0 z-10 bg-panel px-4 py-2 text-left align-top text-xs font-medium text-fg-secondary">
              Activity
            </th>
            {cluster.records.map((record) => (
              <td key={record.id} className={columnClass(record)}>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary">
                  <span className="inline-flex items-center gap-1">
                    <Link2 aria-hidden className="size-3.5" />
                    {plural(record.linkCount, 'relation')}
                  </span>
                  <span>Updated {relativeDay(record.updatedAt.slice(0, 10)).toLowerCase()}</span>
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
