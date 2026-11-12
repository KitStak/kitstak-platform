'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Lock, Share2, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  Field,
  Input,
  WizardFooter,
  WizardSteps,
  cn,
  toast,
} from '@/components/ui';
import { useCreateBoard, type BoardKind, type BoardPrivacy } from '../api';
import { BOARD_KIND_META } from '../entity-icon';
import { useOrg } from '../org-context';
import { routes } from '../routes';

const STEPS = [
  { id: 'basics', title: 'Name & type' },
  { id: 'privacy', title: 'Who can see it' },
] as const;

const KIND_ORDER: readonly BoardKind[] = [
  'deals',
  'leads',
  'contacts',
  'accounts',
  'activities',
  'projects',
  'custom',
];

const TERMINOLOGY: Readonly<Record<BoardKind, string>> = {
  deals: 'Deal',
  leads: 'Lead',
  contacts: 'Contact',
  accounts: 'Account',
  activities: 'Activity',
  projects: 'Project',
  custom: 'Item',
};

const PRIVACY: readonly {
  readonly value: BoardPrivacy;
  readonly title: string;
  readonly body: string;
  readonly icon: LucideIcon;
}[] = [
  { value: 'main', title: 'Main', body: 'Visible to everyone in the workspace.', icon: Globe },
  { value: 'private', title: 'Private', body: 'Only people you invite to the board.', icon: Lock },
  {
    value: 'shareable',
    title: 'Shareable',
    body: 'Invite guests from outside your organization.',
    icon: Share2,
  },
];

const NAME_MAX = 120;

export interface CreateBoardDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspaceId: string;
  readonly folderId?: string | null;
  /** Start from a board template (columns, groups and views come from it). */
  readonly templateId?: string;
  readonly initialName?: string;
  readonly initialKind?: BoardKind;
}

/** Two-step board creation: name + "what are you managing", then privacy. */
export function CreateBoardDialog({
  open,
  onOpenChange,
  workspaceId,
  folderId,
  templateId,
  initialName,
  initialKind,
}: CreateBoardDialogProps) {
  const router = useRouter();
  const { org } = useOrg();
  const createBoard = useCreateBoard(org.id);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName ?? '');
  const [kind, setKind] = useState<BoardKind>(initialKind ?? 'deals');
  const [privacy, setPrivacy] = useState<BoardPrivacy>('main');
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const nameError = trimmed.length > NAME_MAX ? `Use ${NAME_MAX} characters or fewer.` : null;

  const reset = () => {
    setStep(0);
    setName('');
    setKind('deals');
    setPrivacy('main');
    setError(null);
  };

  const submit = () => {
    setError(null);
    createBoard.mutate(
      {
        workspaceId,
        folderId: folderId ?? null,
        name: trimmed,
        kind,
        privacy,
        itemTerminology: TERMINOLOGY[kind],
        ...(templateId ? { templateId } : {}),
      },
      {
        onSuccess: (board) => {
          toast.success(`“${board.name}” is ready`);
          onOpenChange(false);
          reset();
          router.push(routes.board(org.slug, board.id));
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : 'Something went wrong.'),
      },
    );
  };

  const next = (event?: FormEvent) => {
    event?.preventDefault();
    if (!trimmed || nameError) return;
    if (step === 0) setStep(1);
    else submit();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) reset();
      }}
    >
      <DialogContent size="md">
        <DialogHeader
          title="Create board"
          description="Boards organize your work into groups, columns and views."
        />
        <WizardSteps steps={STEPS} current={step} />
        <form onSubmit={next} className="contents">
          <DialogBody className="flex min-h-[300px] flex-col gap-5">
            {step === 0 ? (
              <>
                <Field label="Board name" required error={nameError}>
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      size="lg"
                      autoFocus
                      value={name}
                      maxLength={NAME_MAX + 10}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Q3 enterprise pipeline"
                      aria-describedby={describedBy}
                      invalid={invalid}
                    />
                  )}
                </Field>
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-fg-secondary">
                    What are you managing?
                  </legend>
                  <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {KIND_ORDER.map((value) => {
                      const meta = BOARD_KIND_META[value];
                      const Icon = meta.icon;
                      const selected = kind === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setKind(value)}
                          className={cn(
                            'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)]',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                            selected
                              ? 'border-primary bg-primary-subtle shadow-[0_0_0_1px_var(--primary)]'
                              : 'border-border-default hover:border-border-strong hover:bg-muted',
                          )}
                        >
                          <span
                            className="inline-flex size-7 items-center justify-center rounded-md"
                            style={{
                              background: `color-mix(in srgb, ${meta.accent} 14%, transparent)`,
                              color: meta.accent,
                            }}
                          >
                            <Icon aria-hidden className="size-4" />
                          </span>
                          <span className="text-sm font-semibold text-fg">
                            {value === 'custom' ? 'Something else' : meta.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </>
            ) : (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-fg-secondary">Privacy</legend>
                <div role="radiogroup" className="flex flex-col gap-2">
                  {PRIVACY.map((option) => {
                    const Icon = option.icon;
                    const selected = privacy === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setPrivacy(option.value)}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color] duration-[var(--duration-fast)]',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                          selected
                            ? 'border-primary bg-primary-subtle'
                            : 'border-border-default hover:bg-muted',
                        )}
                      >
                        <span className="inline-flex size-9 items-center justify-center rounded-md bg-sunken text-icon-strong">
                          <Icon aria-hidden className="size-[18px]" />
                        </span>
                        <span className="flex-1">
                          <span className="block font-semibold text-fg">{option.title}</span>
                          <span className="block text-sm text-fg-secondary">{option.body}</span>
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            'size-4 rounded-full border-2 transition-colors',
                            selected
                              ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_var(--surface-raised)]'
                              : 'border-border-strong',
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {error ? (
              <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <WizardFooter
            step={step}
            totalSteps={STEPS.length}
            onBack={() => setStep(0)}
            onNext={() => next()}
            onCancel={() => onOpenChange(false)}
            finishLabel="Create board"
            canProceed={Boolean(trimmed) && !nameError}
            loading={createBoard.isPending}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
