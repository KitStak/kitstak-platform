'use client';
/**
 * "Test with an item…": preview (dry run, nothing written) which conditions hold for a chosen
 * item and which actions would run, then optionally run it for real on that item.
 */
import { useMemo, useState } from 'react';
import { CircleCheck, CircleX, FlaskConical, Play } from 'lucide-react';
import {
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  cn,
  toast,
} from '@/components/ui';
import { errorMessage, useBoard } from '@/lib/hooks';
import type { AutomationPreviewDto } from '@/server/services/contracts/automations-center';
import type { AutomationDto } from '@/server/services/contracts/dto';
import { useRunAutomation } from '../api';
import { draftFromAutomation, clauseParts } from '../model/draft';
import { createResolver, type BuilderContext } from '../model/resolver';
import { SentenceText } from './sentence';

export interface TestAutomationDialogProps {
  readonly automation: AutomationDto | null;
  readonly context: BuilderContext;
  readonly onClose: () => void;
}

export function TestAutomationDialog({ automation, context, onClose }: TestAutomationDialogProps) {
  return (
    <Dialog open={automation !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {automation ? (
        <TestBody key={automation.id} automation={automation} context={context} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function TestBody({
  automation,
  context,
  onClose,
}: {
  readonly automation: AutomationDto;
  readonly context: BuilderContext;
  readonly onClose: () => void;
}) {
  const board = useBoard(context.boardId);
  const run = useRunAutomation(context.boardId);
  const [itemId, setItemId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AutomationPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolver = useMemo(() => createResolver(context), [context]);
  const draft = useMemo(() => draftFromAutomation(automation), [automation]);
  const term = context.term.toLowerCase();

  const options = (board.data?.items ?? [])
    .filter((item) => !item.parentItemId)
    .map((item) => ({ value: item.id, label: item.name }));

  const doPreview = (id: string) => {
    setError(null);
    run.mutate(
      { automationId: automation.id, itemId: id, dryRun: true },
      {
        onSuccess: (result) => (result.dryRun ? setPreview(result) : undefined),
        onError: (cause) => setError(errorMessage(cause)),
      },
    );
  };

  const doRun = () => {
    if (!itemId) return;
    setError(null);
    run.mutate(
      { automationId: automation.id, itemId, dryRun: false },
      {
        onSuccess: (result) => {
          if (result.dryRun) return;
          if (result.status === 'succeeded') {
            toast.success('Automation ran', `It ran on ${preview?.itemName ?? `the ${term}`}.`);
            onClose();
          } else if (result.status === 'skipped') setError(result.error ?? 'Skipped');
          else setError(result.error ?? 'The run failed. See Run history for details.');
        },
        onError: (cause) => setError(errorMessage(cause)),
      },
    );
  };

  return (
    <DialogContent size="md">
      <DialogHeader
        title="Test with an item"
        description={`Preview what this automation would do to a ${term}. Previewing changes nothing.`}
        icon={
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
            <FlaskConical aria-hidden className="size-5" />
          </span>
        }
      />
      <DialogBody className="flex flex-col gap-4 pb-5">
        <p className="rounded-md bg-sunken px-3 py-2 text-sm text-fg">{automation.name}</p>
        <Field label={`Choose a ${term}`}>
          {({ inputId }) => (
            <Combobox
              id={inputId}
              options={options}
              value={itemId}
              onValueChange={(value) => {
                setItemId(value);
                setPreview(null);
                if (value) doPreview(value);
              }}
              placeholder={board.isPending ? 'Loading…' : `Select a ${term}`}
              searchPlaceholder="Search by name"
              emptyMessage="No matches"
              disabled={board.isPending}
            />
          )}
        </Field>
        {run.isPending && run.variables?.dryRun ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <div className="h-5 w-2/3 animate-pulse rounded-sm bg-skeleton" data-skeleton />
            <div className="h-5 w-1/2 animate-pulse rounded-sm bg-skeleton" data-skeleton />
          </div>
        ) : null}
        {preview ? (
          <div className="flex flex-col gap-3" data-testid="automation-preview">
            <div
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                preview.conditionsMet
                  ? 'bg-success-subtle text-success-text'
                  : 'bg-warning-subtle text-warning-text',
              )}
            >
              {preview.conditionsMet ? (
                <CircleCheck aria-hidden className="size-4" />
              ) : (
                <CircleX aria-hidden className="size-4" />
              )}
              {preview.conditionsMet
                ? `All conditions hold for ${preview.itemName}.`
                : `${preview.itemName} doesn’t meet the conditions, so nothing would happen.`}
            </div>
            {draft.conditions.length > 0 ? (
              <ul className="flex flex-col gap-1.5 text-sm" aria-label="Conditions">
                {draft.conditions.map((clause, index) => {
                  const holds = preview.conditions[index]?.holds ?? false;
                  return (
                    <li key={clause.key} className="flex items-start gap-2">
                      {holds ? (
                        <CircleCheck aria-label="Holds" className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <CircleX aria-label="Does not hold" className="mt-0.5 size-4 shrink-0 text-danger" />
                      )}
                      <SentenceText parts={clauseParts(clause, resolver, { definite: true })} />
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                {preview.conditionsMet ? 'It would' : 'It would have'}
              </h3>
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                {draft.actions.map((clause) => (
                  <li key={clause.key}>
                    <SentenceText parts={clauseParts(clause, resolver, { definite: true })} />
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          leadingIcon={<Play aria-hidden />}
          onClick={doRun}
          disabled={!preview?.conditionsMet}
          loading={run.isPending && run.variables?.dryRun === false}
        >
          Run on this {term}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
