'use client';
/**
 * Add workspace: 64px live avatar (icon + color), name, privacy Open / Closed, description.
 * Lands on the new workspace's home.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Users } from 'lucide-react';
import {
  Button,
  ColorPicker,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  LABEL_COLORS,
  Textarea,
  cn,
  labelColorStyle,
  toast,
  type LabelColor,
} from '@/components/ui';
import { describeError, useCreateWizardWorkspace, type DescribedError } from './api';
import { useCan, useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { useShellStore } from '@/features/shell/store';
import { WorkspaceTile } from '@/features/shell/sidebar/workspace-switcher';
import { GuardedDialog, InlineError, OptionCards, preventEscape } from './components/primitives';

const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;
/** Emoji icons render inside the workspace tile everywhere (switcher, tree, home). */
const ICONS = ['', '💼', '🚀', '🎯', '📈', '🤝', '🏢', '📣', '🛟', '⚙️', '🧭', '💡'] as const;

export interface AddWorkspaceDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AddWorkspaceDialog({ open, onClose }: AddWorkspaceDialogProps) {
  const router = useRouter();
  const { org } = useOrg();
  const canClose = useCan('workspace:write');
  const setActiveWorkspace = useShellStore((state) => state.setActiveWorkspace);
  const create = useCreateWizardWorkspace(org.id);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>('blue');
  const [icon, setIcon] = useState<string>('');
  const [kind, setKind] = useState<'open' | 'closed'>('open');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<DescribedError | null>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => nameRef.current?.focus(), 0);
  }, [open]);

  const dirty = Boolean(name.trim() || description.trim() || icon || color !== 'blue' || kind !== 'open');

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (create.isPending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Give your workspace a name.');
      nameRef.current?.focus();
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(`Use ${NAME_MAX} characters or fewer.`);
      nameRef.current?.focus();
      return;
    }
    setError(null);
    create.mutate(
      {
        name: trimmed,
        color,
        kind,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(icon ? { icon } : {}),
      },
      {
        onSuccess: (workspace) => {
          setActiveWorkspace(org.id, workspace.id);
          toast.success(`Workspace “${workspace.name}” created`, 'Add a board to get started.');
          onClose();
          router.push(routes.workspace(org.slug, workspace.id));
        },
        onError: (cause) => {
          const described = describeError(cause);
          setError(described);
        },
      },
    );
  };

  return (
    <GuardedDialog open={open} onOpenChange={(next) => !next && onClose()} dirty={dirty} locked={create.isPending}>
      {(requestClose) => (
        <DialogContent size="md" data-testid="add-workspace-dialog" onEscapeKeyDown={preventEscape}>
          <DialogHeader title="Create workspace" />
          <form noValidate onSubmit={submit} className="contents">
            <DialogBody className="flex flex-col gap-5 pb-4">
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center gap-1">
                  <WorkspaceTile workspace={{ name: name || 'W', color, icon: icon || null }} size={64} />
                  <span className="text-xs text-fg-muted">Preview</span>
                </div>
                <Field label="Workspace name" required error={nameError} className="flex-1">
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      ref={nameRef}
                      id={inputId}
                      size="lg"
                      data-testid="workspace-name-input"
                      value={name}
                      maxLength={NAME_MAX}
                      placeholder="e.g. Enterprise sales"
                      onChange={(event) => {
                        setName(event.target.value);
                        if (nameError) setNameError(null);
                      }}
                      aria-describedby={describedBy}
                      invalid={invalid}
                    />
                  )}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-fg-secondary">Color</legend>
                  <ColorPicker
                    value={color}
                    onChange={setColor}
                    colors={LABEL_COLORS}
                    columns={8}
                    label="Workspace color"
                    size="sm"
                    // Keyboard focus draws outside the selection ring so it is visible on the chosen swatch too.
                    className="[&>button:focus-visible]:scale-110 [&>button:focus-visible]:outline-offset-[5px]"
                  />
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-fg-secondary">Icon</legend>
                  <div role="radiogroup" aria-label="Workspace icon" className="grid grid-cols-6 gap-1.5" data-testid="workspace-icons">
                    {ICONS.map((value) => {
                      const selected = icon === value;
                      return (
                        <button
                          key={value || 'letter'}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={value ? `Icon ${value}` : 'First letter'}
                          onClick={() => setIcon(value)}
                          className={cn(
                            // Emoji at 20px on a neutral tile: crisp in both themes, consistent across OSes.
                            'inline-flex size-10 items-center justify-center rounded-lg border text-lg leading-none transition-[border-color,background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95',
                            selected
                              ? 'border-primary bg-primary-subtle shadow-[0_0_0_1px_var(--primary)]'
                              : 'border-border-subtle bg-sunken hover:border-border-default hover:bg-hover',
                          )}
                        >
                          {value || (
                            <span
                              className="inline-flex size-7 items-center justify-center rounded-md bg-[var(--lc-bg)] text-sm font-semibold text-[var(--lc-fg)]"
                              style={labelColorStyle(color)}
                              data-testid="workspace-icon-letter"
                            >
                              {name.trim() ? name.trim()[0]!.toUpperCase() : 'Aa'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-fg-secondary">Privacy</legend>
                <OptionCards<'open' | 'closed'>
                  label="Workspace privacy"
                  columns={2}
                  compact
                  value={kind}
                  onChange={setKind}
                  options={[
                    {
                      value: 'open',
                      title: 'Open',
                      description: 'Anyone in your org can join.',
                      icon: <Users aria-hidden className="size-[18px] text-icon-strong" />,
                    },
                    {
                      value: 'closed',
                      title: 'Closed',
                      description: canClose ? 'Only people you add see it.' : 'Ask an admin to create one.',
                      icon: <Lock aria-hidden className="size-[18px] text-icon-strong" />,
                    },
                  ]}
                />
              </fieldset>

              <Field label="Description">
                {({ inputId, describedBy }) => (
                  <div className="flex flex-col gap-1">
                    <Textarea
                      id={inputId}
                      rows={3}
                      value={description}
                      maxLength={DESCRIPTION_MAX}
                      placeholder="What is this workspace for? (optional)"
                      onChange={(event) => setDescription(event.target.value)}
                      aria-describedby={[describedBy, `${inputId}-count`].filter(Boolean).join(' ')}
                    />
                    <span
                      id={`${inputId}-count`}
                      className="self-end text-xs text-fg-muted tabular-nums"
                      aria-live="polite"
                      data-testid="workspace-description-count"
                    >
                      {description.length}/{DESCRIPTION_MAX}
                    </span>
                  </div>
                )}
              </Field>
              {error ? (
                <InlineError onRetry={error.retryable ? () => submit() : undefined}>{error.message}</InlineError>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={requestClose} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending} data-testid="workspace-create-submit">
                Create workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </GuardedDialog>
  );
}
