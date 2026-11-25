'use client';
/**
 * Templates gallery: built-in and team templates with search and categories, a full preview,
 * "Use template" (opens the create wizard prefilled) and "Save a project as template".
 * Team templates can be renamed or deleted (with undo). URL: /templates?category=&preview=<id>&save=<projectId>
 */
import { describeTemplateTaskCounts } from '@/lib/template-math';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Eye,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  SearchInput,
  Select,
  Sheet,
  Textarea,
  ToggleGroup,
  buttonVariants,
  toast,
} from '@/components/ui';
import { EntityIcon, StatusIcon } from '@/components/pm';
import { Page } from '@/components/layout/page';
import { routes } from '@/lib/routes';
import type { ProjectSummary, TemplateDTO } from '@/lib/types';
import {
  deleteTemplateAction,
  restoreTemplateAction,
  updateTemplateAction,
} from '@/server/actions/templates';
import { useShell } from '@/features/shell/shell-context';
import { SaveAsTemplateDialog, TEMPLATE_CATEGORIES } from './save-as-template-dialog';
import { ProgramTemplates } from './program-templates';
import type { ProgramTemplateDTO } from '@/lib/program-types';
import { TemplatePreview } from './template-preview';

const TEAM = 'Your team';

function durationText(days: number | undefined): string | null {
  if (!days) return null;
  return days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`;
}

function TemplateCard({
  template,
  canUse,
  canManage,
  onPreview,
  onEdit,
  onDelete,
}: {
  readonly template: TemplateDTO;
  readonly canUse: boolean;
  readonly canManage: boolean;
  readonly onPreview: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const payload = template.payload;
  const automations = payload.automations?.length ?? 0;
  return (
    <li
      className="group flex flex-col rounded-xl border border-border-subtle bg-panel shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-sm"
      data-testid="template-card"
    >
      <div className="relative flex flex-1 flex-col gap-3 rounded-t-xl p-4 has-[button:focus-visible]:outline-2 has-[button:focus-visible]:-outline-offset-2 has-[button:focus-visible]:outline-focus">
        <div className="flex items-start gap-3">
          <EntityIcon icon={template.icon} color={template.color} size={40} />
          <div className="min-w-0 flex-1">
            {/* The title button stretches over the whole card body, so a click anywhere opens the preview. */}
            <button
              type="button"
              onClick={onPreview}
              aria-label={`Preview ${template.name}`}
              className="block max-w-full truncate text-left text-md font-semibold text-fg outline-none transition-colors group-hover:text-primary-text after:absolute after:inset-0 after:rounded-t-xl"
            >
              {template.name}
            </button>
            <p className="mt-0.5 truncate text-xs text-fg-muted">
              {[template.category, describeTemplateTaskCounts({ tasks: template.taskCount, subtasks: template.subtaskCount ?? 0 }), durationText(payload.durationDays)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <p className="line-clamp-2 min-h-10 text-sm text-fg-secondary">
          {template.description || 'A reusable plan made by your team.'}
        </p>
        <ol className="flex flex-wrap items-center gap-1" aria-label="Steps">
          {payload.statuses.slice(0, 5).map((status) => (
            <li
              key={status.key}
              className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-2xs text-fg-secondary"
            >
              <StatusIcon category={status.category} color={status.color} size={10} />
              {status.name}
            </li>
          ))}
          {payload.statuses.length > 5 ? (
            <li className="text-2xs text-fg-muted">+{payload.statuses.length - 5}</li>
          ) : null}
        </ol>
        <div className="flex min-h-5 flex-wrap gap-1.5">
          {template.builtIn ? null : (
            <Badge size="sm" tone="primary">
              Your team
            </Badge>
          )}
          {automations ? (
            <Badge size="sm" tone="warning" icon={<Zap aria-hidden />}>
              {automations} {automations === 1 ? 'automation' : 'automations'}
            </Badge>
          ) : null}
          {payload.asksForCustomer ? (
            <Badge size="sm" tone="info">
              Links a client
            </Badge>
          ) : null}
          {!template.builtIn && template.useCount ? <Badge size="sm">Used {template.useCount}×</Badge> : null}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-4 py-3">
        <Button size="sm" variant="ghost" leadingIcon={<Eye aria-hidden />} onClick={onPreview}>
          Preview
        </Button>
        <span className="flex-1" />
        {canManage && !template.builtIn ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                label={`More for ${template.name}`}
                icon={<MoreHorizontal aria-hidden />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={onEdit}>
                Rename or describe
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={onDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canUse ? (
          <Link
            href={routes.newProject({ template: template.id })}
            className={buttonVariants({ size: 'sm' })}
            data-testid="template-use-card"
          >
            Use template <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function EditTemplateDialog({
  template,
  onOpenChange,
  onSaved,
}: {
  readonly template: TemplateDTO | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState<TemplateDTO | null>(null);
  if (template && template !== loaded) {
    setLoaded(template);
    setName(template.name);
    setDescription(template.description ?? '');
    setCategory(template.category);
  }
  const categories =
    template && !TEMPLATE_CATEGORIES.includes(template.category)
      ? [...TEMPLATE_CATEGORIES, template.category]
      : TEMPLATE_CATEGORIES;
  return (
    <Dialog open={Boolean(template)} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Template details"
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Field label="Name" required>
              {({ inputId }) => (
                <Input id={inputId} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label="Category">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={category}
                  onValueChange={setCategory}
                  options={categories.map((c) => ({ value: c, label: c }))}
                  aria-label="Category"
                />
              )}
            </Field>
          </div>
          <Field label="What is it for?">
            {({ inputId }) => (
              <Textarea
                id={inputId}
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={!name.trim()}
            onClick={async () => {
              if (!template) return;
              setSaving(true);
              const result = await updateTemplateAction({
                templateId: template.id,
                patch: { name, description: description.trim() || null, category },
              });
              setSaving(false);
              if (!result.ok) {
                toast.error("Couldn't save the template", result.error.message);
                return;
              }
              toast.success('Template updated');
              onSaved();
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TemplatesView({
  templates,
  projects,
  programTemplates = [],
}: {
  readonly templates: TemplateDTO[];
  readonly projects: ProjectSummary[];
  readonly programTemplates?: readonly ProgramTemplateDTO[];
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/templates';
  const params = useSearchParams();
  const { can } = useShell();
  const canUse = can('project:create');
  const canManage = can('template:manage');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveProjectId, setSaveProjectId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateDTO | null>(null);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (value) next.set(key, value);
      else next.delete(key);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const list = templates.filter((template) => !hidden.has(template.id));
  const teamCount = list.filter((t) => !t.builtIn).length;
  const categories = useMemo(() => {
    const set = new Set(list.map((t) => t.category));
    return ['All', ...(teamCount ? [TEAM] : []), ...[...set].sort()];
  }, [list, teamCount]);
  const category =
    params?.get('category') && categories.includes(params.get('category') as string)
      ? (params.get('category') as string)
      : 'All';
  const q = query.trim().toLowerCase();
  const visible = list.filter((template) => {
    if (category === TEAM && template.builtIn) return false;
    if (category !== 'All' && category !== TEAM && template.category !== category) return false;
    if (q && !`${template.name} ${template.description ?? ''} ${template.category}`.toLowerCase().includes(q))
      return false;
    return true;
  });
  const previewId = params?.get('preview');
  const preview = previewId ? list.find((t) => t.id === previewId) : undefined;

  // ?save=<projectId> (or 1) opens "Save as template" once, then the param is cleaned up.
  const saveParam = params?.get('save') ?? null;
  const [handledSave, setHandledSave] = useState<string | null>(null);
  if (saveParam && canManage && saveParam !== handledSave) {
    setHandledSave(saveParam);
    setSaveProjectId(saveParam === '1' ? null : saveParam);
    setSaveOpen(true);
  }
  useEffect(() => {
    if (saveParam) setParam('save', null);
  }, [saveParam, setParam]);

  const remove = async (template: TemplateDTO) => {
    setHidden((current) => new Set(current).add(template.id));
    const result = await deleteTemplateAction({ templateId: template.id });
    if (!result.ok) {
      setHidden((current) => {
        const next = new Set(current);
        next.delete(template.id);
        return next;
      });
      toast.error("Couldn't delete the template", result.error.message);
      return;
    }
    toast.undo(`Deleted “${template.name}”`, {
      onUndo: async () => {
        const restored = await restoreTemplateAction({ templateId: template.id });
        if (!restored.ok) {
          toast.error("Couldn't bring it back", restored.error.message);
          return;
        }
        setHidden((current) => {
          const next = new Set(current);
          next.delete(template.id);
          return next;
        });
        router.refresh();
      },
    });
    router.refresh();
  };

  return (
    <Page
      title="Templates"
      actions={
        canManage ? (
          <Button
            variant="secondary"
            leadingIcon={<LayoutTemplate aria-hidden />}
            onClick={() => {
              setSaveProjectId(null);
              setSaveOpen(true);
            }}
            data-testid="save-as-template"
          >
            Save a project as template
          </Button>
        ) : null
      }
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search templates"
          aria-label="Search templates"
          containerClassName="w-full lg:w-64"
        />
        <div className="-mx-1 min-w-0 overflow-x-auto px-1 max-md:pr-6 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)]">
          <ToggleGroup
            label="Category"
            className="min-w-max [&>button]:whitespace-nowrap"
            value={category}
            onValueChange={(value) => setParam('category', value === 'All' ? null : value)}
            options={categories.map((c) => ({ value: c, label: c }))}
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          size="sm"
          visual={<Search aria-hidden className="size-10 text-icon" />}
          title={category === TEAM ? 'Your team hasn’t saved a template yet' : 'No templates match'}
          description={
            category === TEAM
              ? 'Save any project as a template.'
              : 'Try another word or pick “All”.'
          }
          actions={
            category === TEAM && canManage ? (
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => setSaveOpen(true)}>
                Save a project as template
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setParam('category', null);
                }}
              >
                Show all templates
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="templates-grid">
          {visible.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              canUse={canUse}
              canManage={canManage}
              onPreview={() => setParam('preview', template.id)}
              onEdit={() => setEditing(template)}
              onDelete={() => void remove(template)}
            />
          ))}
          {canManage && category !== TEAM && !q ? (
            <li className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong p-6 text-center">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-info-subtle text-info-text">
                <LayoutTemplate aria-hidden className="size-5" />
              </span>
              <p className="font-semibold text-fg">Make your own</p>
              <p className="max-w-60 text-xs text-fg-muted">
                Save any project as a template.
              </p>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Plus aria-hidden />}
                onClick={() => setSaveOpen(true)}
              >
                Save a project as template
              </Button>
            </li>
          ) : null}
        </ul>
      )}

      <ProgramTemplates templates={programTemplates} canUse={canUse} />

      <Sheet open={Boolean(preview)} onOpenChange={(open) => !open && setParam('preview', null)}>
        {preview ? <TemplatePreview template={preview} canUse={canUse} /> : null}
      </Sheet>

      <SaveAsTemplateDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        projects={projects}
        defaultProjectId={saveProjectId}
        onSaved={() => {
          setParam('category', TEAM);
          router.refresh();
        }}
      />
      <EditTemplateDialog
        template={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => router.refresh()}
      />
    </Page>
  );
}
