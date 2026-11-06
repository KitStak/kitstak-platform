'use client';

/** Dashboard creation wizard: 1) name, workspace, privacy  2) boards and starting layout. */
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Globe2, LayoutTemplate, Lock, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  Field,
  Input,
  Select,
  Textarea,
  WizardFooter,
  WizardSteps,
  cn,
  toast,
} from '@/components/ui';
import { useWorkspaces } from '@/lib/hooks';
import { useCreateDashboardFlow, useDashboardSources } from '../hooks';
import { BoardChecklist } from './config-fields';

const STEPS = [
  { id: 'details', title: 'Details' },
  { id: 'data', title: 'Boards & layout' },
];

export interface CreateDashboardDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly orgSlug: string;
  readonly defaultWorkspaceId?: string | null;
}

function Choice({
  active,
  icon,
  title,
  body,
  onSelect,
  name,
}: {
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly onSelect: () => void;
  readonly name: string;
}) {
  return (
    <label
      className={cn(
        'flex flex-1 cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-[var(--duration-instant)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
        active ? 'border-primary bg-primary-subtle' : 'border-border-subtle hover:bg-hover',
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={active} onChange={onSelect} />
      <span aria-hidden className={cn('mt-0.5 [&_svg]:size-5', active ? 'text-primary-text' : 'text-icon')}>
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="text-base font-medium text-fg">{title}</span>
        <span className="text-sm text-fg-secondary">{body}</span>
      </span>
    </label>
  );
}

export function CreateDashboardDialog({ open, onOpenChange, orgSlug, defaultWorkspaceId }: CreateDashboardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="create-dashboard-dialog">
        {open ? <CreateFlow orgSlug={orgSlug} defaultWorkspaceId={defaultWorkspaceId} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateFlow({ orgSlug, defaultWorkspaceId, onClose }: { readonly orgSlug: string; readonly defaultWorkspaceId?: string | null; readonly onClose: () => void }) {
  const router = useRouter();
  const workspaces = useWorkspaces();
  const sources = useDashboardSources();
  const create = useCreateDashboardFlow();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(defaultWorkspaceId ?? undefined);
  const [privacy, setPrivacy] = useState<'main' | 'private'>('main');
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [starter, setStarter] = useState<'blank' | 'sales'>('sales');
  // Default to the first workspace that actually has boards (a brand-new empty workspace is a poor default).
  const withBoards = workspaces.data?.find((workspace) => sources.data?.boards.some((board) => board.workspaceId === workspace.id));
  const resolvedWorkspace = workspaceId ?? withBoards?.id ?? workspaces.data?.[0]?.id;
  const boards = (sources.data?.boards ?? []).filter((board) => !resolvedWorkspace || board.workspaceId === resolvedWorkspace);
  const nameError = touched && !name.trim() ? 'Give the dashboard a name' : null;
  const hasDeals = boards.some((board) => boardIds.includes(board.id) && board.kind === 'deals');

  const submit = () => {
    create.mutate(
      { name: name.trim(), description: description.trim() || null, workspaceId: resolvedWorkspace ?? null, privacy, boardIds, starter: boardIds.length > 0 ? starter : 'blank' },
      {
        onSuccess: (dashboard) => {
          toast.success('Dashboard created', `${dashboard.name} is ready.`);
          onClose();
          router.push(`/${orgSlug}/dashboards/${dashboard.id}${boardIds.length === 0 ? '?add=1' : ''}`);
        },
      },
    );
  };

  return (
    <>
      <DialogHeader title="New dashboard" description="Bring numbers from several boards into one live view." />
      <WizardSteps steps={STEPS} current={step} />
      <DialogBody className="flex h-[min(480px,calc(100dvh-260px))] min-h-[300px] flex-col gap-4 overflow-y-auto pb-5">
        {step === 0 ? (
          <>
            <Field label="Name" required error={nameError}>
              {({ inputId, describedBy, invalid }) => (
                <Input id={inputId} aria-describedby={describedBy} invalid={invalid} autoFocus value={name} maxLength={255} placeholder="e.g. Q4 sales cockpit" onChange={(event) => setName(event.target.value)} onBlur={() => setTouched(true)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) setStep(1); }} />
              )}
            </Field>
            <Field label="Description" hint="Optional. Shown under the title.">
              {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />}
            </Field>
            <Field label="Workspace">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={resolvedWorkspace}
                  onValueChange={(value) => { setWorkspaceId(value); setBoardIds([]); }}
                  options={(workspaces.data ?? []).map((workspace) => ({ value: workspace.id, label: workspace.name }))}
                  placeholder={workspaces.isPending ? 'Loading workspaces…' : 'Choose a workspace'}
                  disabled={workspaces.isPending}
                />
              )}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-semibold text-fg-secondary">Privacy</legend>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Choice name="privacy" active={privacy === 'main'} icon={<Globe2 />} title="Workspace" body="Everyone in the workspace can view." onSelect={() => setPrivacy('main')} />
                <Choice name="privacy" active={privacy === 'private'} icon={<Lock />} title="Private" body="Only you and admins." onSelect={() => setPrivacy('private')} />
              </div>
            </fieldset>
          </>
        ) : (
          <>
            <Field label="Connect boards" hint="Widgets read from these boards. You can change this any time.">
              {() =>
                sources.isPending ? (
                  <div className="flex flex-col gap-1.5" data-skeleton>
                    {[0, 1, 2, 3].map((index) => <div key={index} className="h-9 animate-pulse rounded-sm bg-skeleton" />)}
                  </div>
                ) : boards.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border-default p-4 text-sm text-fg-secondary">This workspace has no boards yet. You can still create the dashboard and add text widgets.</p>
                ) : (
                  <BoardChecklist boards={boards} selected={boardIds} onChange={setBoardIds} />
                )
              }
            </Field>
            {boardIds.length > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-semibold text-fg-secondary">Start with</legend>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Choice name="starter" active={starter === 'sales'} icon={<Sparkles />} title={hasDeals ? 'Sales cockpit' : 'Starter widgets'} body={hasDeals ? 'KPIs, forecast, funnel, leaderboard and top deals.' : 'A KPI, progress battery, chart and list.'} onSelect={() => setStarter('sales')} />
                  <Choice name="starter" active={starter === 'blank'} icon={<LayoutTemplate />} title="Blank canvas" body="Add widgets one by one." onSelect={() => setStarter('blank')} />
                </div>
              </fieldset>
            ) : null}
          </>
        )}
      </DialogBody>
      <WizardFooter
        step={step}
        totalSteps={STEPS.length}
        onCancel={onClose}
        onBack={() => setStep(0)}
        onNext={() => {
          if (step === 0) {
            setTouched(true);
            if (name.trim()) setStep(1);
          } else submit();
        }}
        canProceed={step === 0 ? true : !create.isPending}
        loading={create.isPending}
        finishLabel="Create dashboard"
        hideDots
      />
    </>
  );
}
