'use client';
/**
 * Installs a multi-board solution (CRM suite) into a new workspace, with a setup checklist
 * that ticks through each board while the server builds and wires them (WZ-022).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft, Check, LayoutDashboard, Link2 } from 'lucide-react';
import { Button, DialogBody, DialogFooter, Field, IconButton, Input, Spinner, Switch, cn, toast } from '@/components/ui';
import type { TemplateGalleryEntry } from '@/server/services/wizards-gallery';
import type { InstalledSolutionDto } from '@/server/services/wizards-solutions';
import { useOrg } from '@/features/shell/org-context';
import { useInstallSolution, describeError, type DescribedError } from '../api';
import { InlineError } from './primitives';
import { BoardGlyph, boardTemplateIcon } from './template-icons';

const TICK_MS = 380;

export function SolutionInstall({
  entry,
  onBack,
  onInstalled,
  onBusyChange,
}: {
  readonly entry: TemplateGalleryEntry;
  readonly onBack: () => void;
  readonly onInstalled: (result: InstalledSolutionDto) => void;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const { org } = useOrg();
  const install = useInstallSolution(org.id);
  const [name, setName] = useState('Sales CRM');
  const [withSampleData, setWithSampleData] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<DescribedError | null>(null);
  const [progress, setProgress] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const steps = [
    ...entry.boards.map((board) => ({ id: board.templateId, label: `${board.name} board`, icon: boardTemplateIcon(board.templateId) })),
    { id: 'relations', label: 'Connecting boards to each other', icon: Link2 },
    ...(entry.includesDashboard ? [{ id: 'dashboard', label: 'Sales dashboard', icon: LayoutDashboard }] : []),
  ];
  const running = install.isPending || (install.isSuccess && progress < steps.length);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => onBusyChange(install.isPending), [install.isPending, onBusyChange]);

  // Tick the checklist while the request runs; hold the last step until the server answers.
  useEffect(() => {
    if (!running) return;
    const limit = install.isSuccess ? steps.length : steps.length - 1;
    if (progress >= limit) return;
    const timer = window.setTimeout(() => setProgress((value) => value + 1), install.isSuccess ? 120 : TICK_MS);
    return () => window.clearTimeout(timer);
  }, [running, progress, install.isSuccess, steps.length]);

  useEffect(() => {
    if (install.isSuccess && install.data && progress >= steps.length) {
      const timer = window.setTimeout(() => {
        toast.success(`“${name.trim()}” is ready`, `${entry.boards.length} connected boards and a dashboard were created.`);
        onInstalled(install.data);
      }, 350);
      return () => window.clearTimeout(timer);
    }
  }, [install.isSuccess, install.data, progress, steps.length, name, entry.boards.length, onInstalled]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (install.isPending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Give the workspace a name.');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setError(null);
    setProgress(0);
    install.mutate(
      { solutionId: entry.id, workspaceName: trimmed, withSampleData },
      {
        onError: (cause) => {
          const described = describeError(cause);
          setError(described);
          setProgress(0);
        },
      },
    );
  };

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col" data-testid="solution-install">
      <div className="flex items-start gap-3 px-6 pt-6 pr-14 pb-4">
        <IconButton label="Back to templates" icon={<ArrowLeft aria-hidden />} onClick={onBack} disabled={running} className="-ml-2 shrink-0" />
        <div className="min-w-0">
          <DialogPrimitive.Title className="text-xl font-semibold text-fg">Install {entry.name}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-base text-fg-secondary [text-wrap:balance]">
            We’ll create a workspace with every board connected, so deals link to accounts and contacts from day one.
          </DialogPrimitive.Description>
        </div>
      </div>
      <DialogBody className="flex flex-col gap-5 pb-4">
        {running || install.isSuccess ? (
          <ol aria-label="Setup progress" aria-live="polite" className="flex flex-col gap-1" data-testid="solution-progress">
            {steps.map((step, index) => {
              const done = index < progress;
              const active = index === progress && running;
              const Icon = step.icon;
              return (
                <li
                  key={step.id}
                  className={cn(
                    'flex h-11 items-center gap-3 rounded-md px-3 transition-colors duration-[var(--duration-normal)]',
                    active && 'bg-primary-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-full transition-[background-color,transform] duration-[var(--duration-normal)] ease-[var(--ease-emphasized)]',
                      done ? 'scale-100 bg-success text-white' : 'bg-muted text-icon',
                    )}
                  >
                    {done ? <Check aria-hidden strokeWidth={3} className="size-3.5" /> : active ? <Spinner size="xs" label={null} /> : <Icon aria-hidden className="size-3.5" />}
                  </span>
                  <span className={cn('text-base', done || active ? 'text-fg' : 'text-fg-muted')}>{step.label}</span>
                  <span className="sr-only">{done ? 'done' : active ? 'in progress' : 'waiting'}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <>
            <Field label="Workspace name" required error={nameError}>
              {({ inputId, describedBy, invalid }) => (
                <Input
                  ref={nameRef}
                  id={inputId}
                  size="lg"
                  value={name}
                  maxLength={120}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError) setNameError(null);
                  }}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  data-testid="solution-workspace-name"
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              {entry.boards.map((board) => {
                return (
                  <span key={board.templateId} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-sunken px-2.5 text-sm text-fg">
                    <BoardGlyph templateId={board.templateId} className="size-4 text-icon" />
                    {board.name}
                  </span>
                );
              })}
            </div>
            <Switch
              checked={withSampleData}
              onCheckedChange={setWithSampleData}
              label="Include sample data"
              description="Example deals, leads and accounts. Delete them any time."
            />
            {error ? (
              <InlineError onRetry={error.retryable ? () => submit() : undefined}>{error.message}</InlineError>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onBack} disabled={running}>
          Back
        </Button>
        <Button type="submit" loading={install.isPending} disabled={running && !install.isPending} data-testid="solution-install-submit">
          Install suite
        </Button>
      </DialogFooter>
    </form>
  );
}
