'use client';
/**
 * "Save as template": captures a project's workflow, sections, labels, custom fields, milestones,
 * automations and (optionally) its tasks with relative dates, so the team can reuse it.
 * Reusable: <SaveAsTemplateDialog open onOpenChange projects defaultProjectId />.
 */
import { useMemo, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  Textarea,
  toast,
} from '@/components/ui';
import { EntityIcon } from '@/components/pm';
import type { ProjectSummary, TemplateDTO } from '@/lib/types';
import { saveProjectAsTemplateAction } from '@/server/actions/projects';

export const TEMPLATE_CATEGORIES: readonly string[] = [
  'General',
  'Operations',
  'Customer success',
  'Sales',
  'Marketing',
  'Engineering',
  'Events',
];

export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: readonly ProjectSummary[];
  readonly defaultProjectId?: string | null;
  readonly onSaved?: (template: TemplateDTO) => void;
}) {
  const choices = useMemo(() => projects.filter((project) => project.role !== 'viewer'), [projects]);
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId ?? choices[0]?.id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [includeTasks, setIncludeTasks] = useState(true);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const project = choices.find((p) => p.id === projectId);

  // Reset each time the dialog opens (adjusting state during render).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const initial = choices.find((p) => p.id === defaultProjectId) ?? choices[0];
      setProjectId(initial?.id);
      setName(initial ? `${initial.name} template` : '');
      setDescription('');
      setCategory('General');
      setIncludeTasks(true);
      setErrors({});
    }
  }

  const save = async () => {
    if (!projectId) return;
    setSaving(true);
    const result = await saveProjectAsTemplateAction({
      projectId,
      name,
      description: description.trim() || null,
      category,
      includeTasks,
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error("Couldn't save the template", result.error.message);
      return;
    }
    toast.success('Template saved', `“${result.data.name}” is ready for your team in Templates.`);
    onSaved?.(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="save-template-dialog">
        <DialogHeader
          icon={
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-info-subtle text-info-text">
              <LayoutTemplate aria-hidden className="size-5" />
            </span>
          }
          title="Save a project as a template"
          description="Reuse a project that worked well. New projects start with the same steps, sections, labels and automations."
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          {choices.length === 0 ? (
            <p className="rounded-lg bg-sunken px-3 py-3 text-sm text-fg-secondary">
              You need a project you can edit first. Make one, then come back here.
            </p>
          ) : (
            <>
              <Field label="Project to copy">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={projectId}
                    onValueChange={(value) => {
                      const next = choices.find((p) => p.id === value);
                      setProjectId(value);
                      if (next && (!name || name.endsWith(' template'))) setName(`${next.name} template`);
                    }}
                    options={choices.map((p) => ({
                      value: p.id,
                      label: p.name,
                      icon: <EntityIcon icon={p.icon} color={p.color} size={16} />,
                    }))}
                    aria-label="Project to copy"
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                <Field label="Template name" required error={errors.name}>
                  {({ inputId, invalid }) => (
                    <Input
                      id={inputId}
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                      invalid={invalid}
                      data-testid="template-name"
                    />
                  )}
                </Field>
                <Field label="Category">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      value={category}
                      onValueChange={setCategory}
                      options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: c }))}
                      aria-label="Category"
                    />
                  )}
                </Field>
              </div>
              <Field label="What is it for?" hint="One or two sentences so teammates know when to use it.">
                {({ inputId, describedBy }) => (
                  <Textarea
                    id={inputId}
                    aria-describedby={describedBy}
                    rows={2}
                    maxLength={1000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={project ? `Plan a project like “${project.name}”.` : ''}
                  />
                )}
              </Field>
              <Checkbox
                checked={includeTasks}
                onCheckedChange={(checked) => setIncludeTasks(checked === true)}
                label="Include the tasks and subtasks"
                description="Due dates are saved as “day 3”, “day 10”… so they fit any start date. People and comments are not copied."
              />
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!projectId || !name.trim()}
            data-testid="template-save"
          >
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
