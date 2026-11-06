'use client';
/**
 * Automation builder dialog.
 *  - "sentence" mode (recipes): one large sentence with editable tokens, monday-style.
 *  - "steps" mode (custom / edit): When / And only if / Then step cards with add/remove/reorder.
 * Both edit the same draft; a recipe can be expanded into steps to add conditions or actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Clock, ListPlus, Plus, Trash2, Zap } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Tooltip,
  cn,
} from '@/components/ui';
import { apiRequest } from '@/lib/api';
import { errorMessage, useOrgId } from '@/lib/hooks';
import type { CreateAutomationInput } from '@/server/automations-engine/recipes';
import type { GroupDto } from '@/server/services/contracts/dto';
import { centerKeys } from '../api';
import { clauseDef, clausesFor, tokenIds, type ClauseRole } from '../model/clauses';
import {
  autoName,
  compileDraft,
  draftParts,
  missingTokens,
  newClause,
  type AutomationDraft,
  type ClauseDraft,
} from '../model/draft';
import { createResolver, type BuilderContext } from '../model/resolver';
import type { TokenValue } from '../model/tokens';
import { ClauseIcon } from './icons';
import { EditableClause, SentenceText, tokenKeyOf } from './sentence';

export interface BuilderSeed {
  readonly mode: 'sentence' | 'steps';
  readonly draft: AutomationDraft;
  readonly title: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly enabled?: boolean;
  readonly submitLabel: string;
  readonly automationId?: string;
}

export interface AutomationBuilderProps {
  readonly seed: BuilderSeed | null;
  readonly context: BuilderContext;
  readonly onClose: () => void;
  readonly onSubmit: (input: CreateAutomationInput, automationId?: string) => Promise<void>;
}

function resetDependents(clause: ClauseDraft, token: string): ClauseDraft['values'] {
  const def = clauseDef(clause.role, clause.type);
  const values: Record<string, TokenValue> = { ...clause.values };
  if (!def) return values;
  for (const [id, spec] of Object.entries(def.tokens)) {
    if ((spec.kind === 'label' || spec.kind === 'labels') && spec.columnToken === token) values[id] = null;
    if (spec.kind === 'targetGroup' && spec.boardToken === token) values[id] = null;
  }
  return values;
}

function mapClauses(
  draft: AutomationDraft,
  key: string,
  fn: (clause: ClauseDraft) => ClauseDraft,
): AutomationDraft {
  return {
    trigger: draft.trigger && draft.trigger.key === key ? fn(draft.trigger) : draft.trigger,
    conditions: draft.conditions.map((clause) => (clause.key === key ? fn(clause) : clause)),
    actions: draft.actions.map((clause) => (clause.key === key ? fn(clause) : clause)),
  };
}

export function AutomationBuilder({ seed, context, onClose, onSubmit }: AutomationBuilderProps) {
  const dirtyRef = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    // Next tick: the Escape keydown that asked to close must not also dismiss the confirm.
    if (dirtyRef.current) setTimeout(() => setConfirmDiscard(true), 0);
    else onClose();
  };
  return (
    <>
      <Dialog open={seed !== null} onOpenChange={(open) => (open ? undefined : requestClose())}>
        {seed ? (
          <BuilderBody
            key={seed.automationId ?? seed.title}
            seed={seed}
            context={context}
            onClose={onClose}
            onCancel={requestClose}
            onDirtyChange={(dirty) => {
              dirtyRef.current = dirty;
            }}
            onSubmit={onSubmit}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this automation?"
        description="The fields you set will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          dirtyRef.current = false;
          onClose();
        }}
      />
    </>
  );
}

function useTargetGroupMap(draft: AutomationDraft, boardId: string): Record<string, readonly GroupDto[]> {
  const orgId = useOrgId();
  const targets = [
    ...new Set(
      draft.actions
        .filter((clause) => clause.type === 'create_item')
        .map((clause) => clause.values.board)
        .filter((value): value is string => typeof value === 'string' && value !== boardId),
    ),
  ];
  const results = useQueries({
    queries: targets.map((target) => ({
      queryKey: centerKeys.targetGroups(orgId, target),
      queryFn: () => apiRequest<GroupDto[]>(`/boards/${target}/groups`, { orgId }),
      staleTime: 60_000,
    })),
  });
  return Object.fromEntries(targets.map((target, index) => [target, results[index]?.data ?? []]));
}

function BuilderBody({
  seed,
  context: baseContext,
  onClose,
  onCancel,
  onDirtyChange,
  onSubmit,
}: {
  readonly seed: BuilderSeed;
  readonly context: BuilderContext;
  readonly onClose: () => void;
  /** Close request that asks for confirmation when there are unsaved changes. */
  readonly onCancel: () => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSubmit: AutomationBuilderProps['onSubmit'];
}) {
  const [draft, setDraft] = useState<AutomationDraft>(seed.draft);
  const [mode, setMode] = useState(seed.mode);
  const [name, setName] = useState(seed.name ?? '');
  const [nameTouched, setNameTouched] = useState(Boolean(seed.name));
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const submitRef = useRef<HTMLButtonElement>(null);
  /** True while a commit hands focus to the next token (keeps Radix from refocusing the old one). */
  const advancingRef = useRef(false);

  const dirty = draft !== seed.draft || (nameTouched && name !== (seed.name ?? ''));
  useEffect(() => {
    onDirtyChange(dirty && !saving);
  }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const targetGroups = useTargetGroupMap(draft, baseContext.boardId);
  const context = useMemo(() => ({ ...baseContext, targetGroups }), [baseContext, targetGroups]);
  const resolver = useMemo(() => createResolver(context), [context]);
  const missing = missingTokens(draft);
  const generatedName = autoName(draft, resolver);
  const effectiveName = nameTouched ? name : generatedName;
  const compiled = compileDraft(draft, {
    name: effectiveName.trim() || generatedName,
    description: seed.description,
    enabled: seed.enabled ?? true,
  });
  const blocked = !compiled.ok;

  const registerChip = useCallback((key: string, element: HTMLElement | null) => {
    if (element) chips.current.set(key, element);
    else chips.current.delete(key);
  }, []);

  /**
   * Wizard-like progression: focus the first unset token and (after a commit) open its picker,
   * or focus the submit button when everything is set. Escape closes a picker without advancing.
   */
  const advance = useCallback((next: AutomationDraft, open: boolean) => {
    const target = missingTokens(next)[0];
    if (open) advancingRef.current = true;
    requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const key = target ? tokenKeyOf(target.clauseKey, target.token) : null;
      const element = key ? chips.current.get(key) : submitRef.current;
      // focusVisible: programmatic advances must show the ring even after a mouse click.
      element?.focus({ preventScroll: false, focusVisible: true } as FocusOptions);
      if (open && key) setOpenToken(key);
      requestAnimationFrame(() => {
        advancingRef.current = false;
      });
    });
  }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    if (advancingRef.current) event.preventDefault();
  }, []);

  useEffect(() => {
    // Initial focus: first unset token, so keyboard users can start right away.
    advance(seed.draft, false);
  }, [advance, seed.draft]);

  const commit = (clauseKey: string, token: string, value: TokenValue, close: boolean) => {
    const next = mapClauses(draft, clauseKey, (clause) => ({
      ...clause,
      values: { ...resetDependents(clause, token), [token]: value },
    }));
    setDraft(next);
    setError(null);
    if (close) {
      advancingRef.current = true;
      setOpenToken(null);
      advance(next, true);
    }
  };

  const addClause = (role: Exclude<ClauseRole, 'trigger'>, type: string) => {
    const clause = newClause(role, type);
    const next =
      role === 'condition'
        ? { ...draft, conditions: [...draft.conditions, clause] }
        : { ...draft, actions: [...draft.actions, clause] };
    setDraft(next);
    const def = clauseDef(role, type);
    const first = def ? tokenIds(def)[0] : undefined;
    if (first) requestAnimationFrame(() => setOpenToken(tokenKeyOf(clause.key, first)));
  };

  const setTrigger = (type: string) => {
    const clause = newClause('trigger', type);
    setDraft({ ...draft, trigger: clause });
    const def = clauseDef('trigger', type);
    const first = def ? tokenIds(def)[0] : undefined;
    if (first) requestAnimationFrame(() => setOpenToken(tokenKeyOf(clause.key, first)));
  };

  const removeClause = (role: 'condition' | 'action', key: string) =>
    setDraft(
      role === 'condition'
        ? { ...draft, conditions: draft.conditions.filter((clause) => clause.key !== key) }
        : { ...draft, actions: draft.actions.filter((clause) => clause.key !== key) },
    );

  const moveAction = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.actions.length) return;
    const actions = [...draft.actions];
    const [moved] = actions.splice(index, 1);
    if (moved) actions.splice(target, 0, moved);
    setDraft({ ...draft, actions });
  };

  const submit = async () => {
    if (!compiled.ok) {
      setShowInvalid(true);
      setError(compiled.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(compiled.input, seed.automationId);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, 'The automation could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const clauseProps = {
    resolver,
    context,
    openToken,
    nextToken: missing[0] ? tokenKeyOf(missing[0].clauseKey, missing[0].token) : null,
    showInvalid,
    onOpenToken: setOpenToken,
    onCommit: commit,
    registerChip,
    onCloseAutoFocus,
  };

  const statusText = !draft.trigger
    ? 'Choose a trigger to start'
    : draft.actions.length === 0
      ? 'Add at least one action'
      : missing.length > 0
        ? `${missing.length} ${missing.length === 1 ? 'field' : 'fields'} left to fill`
        : 'Ready to go';

  return (
    <DialogContent size="lg" data-testid="automation-builder" aria-describedby={undefined}>
      <DialogHeader
        title={seed.title}
        description={
          mode === 'sentence'
            ? 'Click each underlined part to choose what it should be.'
            : 'Pick a trigger, add optional conditions, then chain one or more actions.'
        }
        icon={
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
            <Zap aria-hidden className="size-5" />
          </span>
        }
      />
      <DialogBody className="flex flex-col gap-5 pb-5">
        {mode === 'sentence' ? (
          <div className="rounded-xl border border-border-subtle bg-sunken px-5 py-8 sm:px-8 sm:py-10">
            <p
              className="font-heading text-xl leading-[1.9] font-light text-fg sm:text-2xl sm:leading-[1.8]"
              data-testid="automation-sentence"
            >
              {draft.trigger ? <EditableClause clause={draft.trigger} {...clauseProps} /> : 'When…'}
              {draft.conditions.map((clause, index) => (
                <span key={clause.key}>
                  {index === 0 ? ', and only if ' : ' and '}
                  <EditableClause clause={clause} definite {...clauseProps} />
                </span>
              ))}
              {draft.actions.map((clause, index) => (
                <span key={clause.key}>
                  {index === 0 ? ', then ' : index === draft.actions.length - 1 ? ' and ' : ', '}
                  <EditableClause clause={clause} definite {...clauseProps} />
                </span>
              ))}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                variant="tertiary"
                size="sm"
                leadingIcon={<ListPlus aria-hidden />}
                onClick={() => setMode('steps')}
              >
                Add conditions or more actions
              </Button>
            </div>
          </div>
        ) : (
          <ol className="relative flex flex-col gap-3" aria-label="Automation steps">
            <span aria-hidden className="absolute top-6 bottom-6 left-[19px] w-px bg-border-default" />
            <StepCard label="When" tone="trigger">
              {draft.trigger ? (
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-md leading-8">
                    <EditableClause clause={draft.trigger} omitLead {...clauseProps} />
                  </p>
                  <ClauseMenu
                    role="trigger"
                    onPick={setTrigger}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Change
                      </Button>
                    }
                  />
                </div>
              ) : (
                <TriggerChooser onPick={setTrigger} />
              )}
            </StepCard>
            {draft.conditions.map((clause, index) => (
              <StepCard key={clause.key} label={index === 0 ? 'And only if' : 'And'} tone="condition">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-md leading-8">
                    <EditableClause clause={clause} definite {...clauseProps} />
                  </p>
                  <IconButton
                    label="Remove condition"
                    icon={<Trash2 aria-hidden />}
                    size="sm"
                    onClick={() => removeClause('condition', clause.key)}
                  />
                </div>
              </StepCard>
            ))}
            <li className="relative pl-12">
              <ClauseMenu
                role="condition"
                onPick={(type) => addClause('condition', type)}
                trigger={
                  <Button
                    variant="tertiary"
                    size="sm"
                    leadingIcon={<Plus aria-hidden />}
                    disabled={!draft.trigger}
                  >
                    Add condition
                  </Button>
                }
              />
            </li>
            {draft.actions.map((clause, index) => (
              <StepCard
                key={clause.key}
                label={index === 0 ? 'Then' : 'And then'}
                tone="action"
                icon={clause.type}
              >
                <div className="flex items-start gap-1">
                  <p className="min-w-0 flex-1 text-md leading-8">
                    <EditableClause clause={clause} definite {...clauseProps} />
                  </p>
                  {draft.actions.length > 1 ? (
                    <>
                      <IconButton
                        label="Move up"
                        icon={<ArrowUp aria-hidden />}
                        size="sm"
                        disabled={index === 0}
                        onClick={() => moveAction(index, -1)}
                      />
                      <IconButton
                        label="Move down"
                        icon={<ArrowDown aria-hidden />}
                        size="sm"
                        disabled={index === draft.actions.length - 1}
                        onClick={() => moveAction(index, 1)}
                      />
                    </>
                  ) : null}
                  <IconButton
                    label="Remove action"
                    icon={<Trash2 aria-hidden />}
                    size="sm"
                    onClick={() => removeClause('action', clause.key)}
                  />
                </div>
              </StepCard>
            ))}
            <li className="relative pl-12">
              <ClauseMenu
                role="action"
                onPick={(type) => addClause('action', type)}
                trigger={
                  <Button
                    variant={draft.actions.length === 0 ? 'secondary' : 'tertiary'}
                    size="sm"
                    leadingIcon={<Plus aria-hidden />}
                    disabled={!draft.trigger || draft.actions.length >= 10}
                  >
                    {draft.actions.length === 0 ? 'Add an action' : 'Add another action'}
                  </Button>
                }
              />
            </li>
          </ol>
        )}

        <section
          aria-label="Summary"
          className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-4"
        >
          {mode === 'steps' ? (
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
                In plain English
              </h3>
              <p className="mt-1 text-base leading-6 text-fg" data-testid="automation-summary">
                <SentenceText parts={draftParts(draft, resolver)} term={resolver.term} />
              </p>
            </div>
          ) : null}
          <Field
            label="Name"
            hint={
              nameTouched
                ? undefined
                : generatedName
                  ? 'Generated from the sentence. Type to rename it.'
                  : 'Named automatically once every field is set, or type your own.'
            }
          >
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                value={effectiveName}
                placeholder="e.g. Notify the owner when a deal is won"
                maxLength={255}
                onChange={(event) => {
                  setNameTouched(true);
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
        </section>
      </DialogBody>
      <DialogFooter className="flex-wrap justify-between">
        <p
          className={cn(
            'flex min-w-0 items-center gap-1.5 text-sm',
            error ? 'text-danger-text' : blocked ? 'text-fg-secondary' : 'text-success-text',
          )}
          role={error ? 'alert' : 'status'}
          data-testid="automation-builder-status"
        >
          {error || !blocked ? (
            error ? (
              <CircleAlert aria-hidden className="size-4 shrink-0" />
            ) : (
              <CircleCheck aria-hidden className="size-4 shrink-0" />
            )
          ) : null}
          <span className="truncate">{error ?? statusText}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Tooltip content={blocked ? 'Fill in all fields' : null} side="top">
            <span
              tabIndex={blocked ? 0 : undefined}
              onPointerEnter={() => blocked && setShowInvalid(true)}
              onFocus={() => blocked && setShowInvalid(true)}
              className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Button
                ref={submitRef}
                onClick={() => void submit()}
                disabled={blocked}
                loading={saving}
                data-testid="automation-builder-submit"
              >
                {seed.submitLabel}
              </Button>
            </span>
          </Tooltip>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function StepCard({
  label,
  tone,
  icon,
  children,
}: {
  readonly label: string;
  readonly tone: 'trigger' | 'condition' | 'action';
  readonly icon?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3">
      <span
        aria-hidden
        className={cn(
          'relative z-[1] mt-2 flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-raised text-xs font-bold',
          tone === 'trigger' && 'bg-primary text-primary-fg',
          tone === 'condition' && 'bg-warning-subtle text-warning-text',
          tone === 'action' && 'bg-success-subtle text-success-text',
        )}
      >
        {tone === 'trigger' ? (
          <Zap className="size-4" />
        ) : tone === 'condition' ? (
          'IF'
        ) : (
          <ClauseIcon type={icon ?? ''} className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-panel px-4 py-3 shadow-xs transition-shadow duration-[var(--duration-fast)] focus-within:border-primary hover:shadow-sm">
        <div className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</div>
        {children}
      </div>
    </li>
  );
}

function groupedClauses(role: ClauseRole) {
  const groups = new Map<string, ReturnType<typeof clausesFor>[number][]>();
  for (const def of clausesFor(role)) groups.set(def.menuGroup, [...(groups.get(def.menuGroup) ?? []), def]);
  return [...groups.entries()];
}

function ClauseMenu({
  role,
  onPick,
  trigger,
}: {
  readonly role: ClauseRole;
  readonly onPick: (type: string) => void;
  readonly trigger: React.ReactNode;
}) {
  const groups = groupedClauses(role);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {groups.map(([group, defs], index) => (
          <div key={group}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {defs.map((def) => (
              <DropdownMenuItem
                key={def.type}
                icon={<ClauseIcon type={def.type} />}
                onSelect={() => onPick(def.type)}
              >
                {def.title}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TriggerChooser({ onPick }: { readonly onPick: (type: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Choose a trigger">
      {clausesFor('trigger').map((def) => (
        <button
          key={def.type}
          type="button"
          onClick={() => onPick(def.type)}
          data-testid="trigger-option"
          className="flex items-center gap-2.5 rounded-md border border-border-subtle bg-panel px-3 py-2.5 text-left text-sm font-medium text-fg transition-[border-color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-primary hover:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-focus active:scale-[0.98]"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-text">
            <ClauseIcon type={def.type} className="size-4" />
          </span>
          {def.title}
        </button>
      ))}
      {UPCOMING_TRIGGERS.map((title) => (
        <span
          key={title}
          aria-disabled="true"
          className="flex cursor-not-allowed items-center gap-2.5 rounded-md border border-dashed border-border-subtle px-3 py-2.5 text-sm font-medium text-fg-muted"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sunken text-icon">
            <Clock aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">{title}</span>
          <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-fg-secondary">
            Coming soon
          </span>
        </span>
      ))}
    </div>
  );
}

/** Triggers the engine does not run yet; listed (disabled) so the catalog's breadth is honest. */
const UPCOMING_TRIGGERS = [
  'Every time period (recurring)',
  'When an update is created',
  'When a button is clicked',
  'When a subitem is created',
] as const;
