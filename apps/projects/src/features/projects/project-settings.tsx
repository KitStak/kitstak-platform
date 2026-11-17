'use client';
/**
 * Project settings: general details, workflow (statuses), labels, custom fields, people and
 * roles, and archive / template / delete. A sticky section menu on wide screens; `?section=`
 * deep-links (e.g. the header's Share button opens `?section=members`).
 */
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Copy, FileStack, Lock, Trash2, UserPlus, Users } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  Select,
  Switch,
  Textarea,
  ToggleGroup,
  Tooltip,
  UserPicker,
  cn,
  toast,
} from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { PROJECT_KEY_PATTERN, PROJECT_ROLES, PROJECT_ROLE_LABELS, PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectRole, type ProjectStatus } from '@/lib/constants';
import { usePeople, useSpaces } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import {
  addProjectMembersAction,
  archiveProjectAction,
  deleteProjectAction,
  duplicateProjectAction,
  removeProjectMemberAction,
  restoreProjectAction,
  saveProjectAsTemplateAction,
  updateProjectAction,
  updateProjectMemberRoleAction,
} from '@/server/actions/projects';
import { useShell } from '@/features/shell/shell-context';
import { AppearancePicker } from './appearance-picker';
import { useCurrentProject } from './project-context';
import { CustomFieldsSettings, LabelsSettings } from './settings-fields';
import { SettingsSection, useSettingsRunner } from './settings-shared';
import { WorkflowSettings } from './settings-workflow';

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'labels', label: 'Labels' },
  { id: 'fields', label: 'Custom fields' },
  { id: 'members', label: 'People & roles' },
  { id: 'danger', label: 'Archive & delete' },
] as const;

const ROLE_HELP: Readonly<Record<ProjectRole, string>> = {
  owner: 'Can do everything, including people and delete',
  editor: 'Can add and change tasks and settings',
  commenter: 'Can view and comment',
  viewer: 'Can only look',
};

function GeneralSettings({ highlight }: { readonly highlight?: boolean }) {
  const { project, capabilities } = useCurrentProject();
  const run = useSettingsRunner();
  const spaces = useSpaces();
  const people = usePeople();
  const { user } = useShell();
  const canEdit = capabilities['project:update'];
  const canManage = capabilities['project:manage_members'];
  const [name, setName] = useState(project.name);
  const [key, setKey] = useState(project.key);
  const router = useRouter();
  const keyError = key && !PROJECT_KEY_PATTERN.test(key) ? 'Use 2 to 6 letters or numbers, starting with a letter.' : undefined;
  const dirty = name.trim() !== project.name || key !== project.key;
  const save = (patch: Parameters<typeof updateProjectAction>[0]['patch'], message = 'Saved') => run(updateProjectAction({ projectId: project.id, patch }), message);

  return (
    <SettingsSection id="general" title="General" highlight={highlight}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || keyError) return;
          const keyChanged = key !== project.key;
          void save({ name: name.trim(), ...(keyChanged ? { key } : {}) }, keyChanged ? `Saved. Tasks are now ${key}-1, ${key}-2…` : 'Saved').then((updated) => {
            if (updated && keyChanged) router.replace(routes.projectTab(updated.key, 'settings'));
          });
        }}
      >
        <div className="flex items-start gap-4">
          <div className="pt-6">
            <AppearancePicker color={project.color} icon={project.icon} size={44} disabled={!canEdit} onChange={(next) => void save(next, 'Look updated')} />
          </div>
          <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
            <Field label="Project name">
              {({ inputId }) => <Input id={inputId} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={!canEdit} size="lg" data-testid="settings-name" />}
            </Field>
            <Field label="Key" hint={canManage ? 'Changing it renames every task id' : 'Only owners can change it'} error={keyError}>
              {({ inputId, describedBy, invalid }) => (
                <Input
                  id={inputId}
                  value={key}
                  onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  disabled={!canManage}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  size="lg"
                  className="font-key"
                />
              )}
            </Field>
          </div>
        </div>
        {dirty ? (
          <div className="-mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setName(project.name); setKey(project.key); }}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || Boolean(keyError)} data-testid="save-general">
              Save changes
            </Button>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Space">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={project.spaceId ?? 'none'}
                disabled={!canEdit}
                onValueChange={(value) => void save({ spaceId: value === 'none' ? null : value }, 'Moved to the new space')}
                options={[{ value: 'none', label: 'No space' }, ...(spaces.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
                size="lg"
              />
            )}
          </Field>
          <Field label="Stage">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={project.status === 'archived' ? 'active' : project.status}
                disabled={!canEdit}
                onValueChange={(value) => void save({ status: value as ProjectStatus }, `Stage set to ${PROJECT_STATUS_LABELS[value as ProjectStatus]}`)}
                options={PROJECT_STATUSES.filter((s) => s !== 'archived').map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))}
                size="lg"
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Start date</span>
            <IsoDatePicker value={project.startDate} disabled={!canEdit} onChange={(startDate) => void save({ startDate })} aria-label="Start date" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Due date</span>
            <IsoDatePicker value={project.dueDate} disabled={!canEdit} onChange={(dueDate) => void save({ dueDate })} aria-label="Due date" placeholder="No due date" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Owner</span>
            <UserPicker
              people={people.data ?? []}
              meId={user.id}
              value={project.ownerId}
              allowNone={false}
              disabled={!canManage}
              onChange={(ownerId) => ownerId && void save({ ownerId }, 'New owner set')}
              className="h-10 w-full"
              aria-label="Owner"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">Who can see it</span>
            <ToggleGroup
              label="Who can see it"
              value={project.visibility}
              onValueChange={(visibility) => canManage && void save({ visibility }, visibility === 'private' ? 'Now only members can see it' : 'Now everyone in the workspace can see it')}
              options={[
                { value: 'org', label: 'Workspace', icon: <Users aria-hidden />, disabled: !canManage },
                { value: 'private', label: 'Members only', icon: <Lock aria-hidden />, disabled: !canManage },
              ]}
            />
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}

function MembersSettings({ highlight }: { readonly highlight?: boolean }) {
  const { project, capabilities } = useCurrentProject();
  const { user } = useShell();
  const people = usePeople();
  const run = useSettingsRunner();
  const router = useRouter();
  const canManage = capabilities['project:manage_members'];
  const [role, setRole] = useState<ProjectRole>('editor');
  const [leaving, setLeaving] = useState(false);
  const owners = project.members.filter((m) => m.role === 'owner');
  const candidates = (people.data ?? []).filter((p) => !project.members.some((m) => m.userId === p.id));

  return (
    <SettingsSection
      id="members"
      title={`People & roles (${project.members.length})`}
      description={project.visibility === 'private' ? 'This project is private: only these people can see it.' : 'Everyone in the workspace can see this project. Members get notified and can be assigned.'}
      highlight={highlight}
      action={
        canManage ? (
          <div className="flex items-center gap-2">
            <Select size="sm" aria-label="Role for new people" value={role} onValueChange={(value) => setRole(value as ProjectRole)} options={PROJECT_ROLES.map((r) => ({ value: r, label: `as ${PROJECT_ROLE_LABELS[r]}` }))} className="w-32" />
            <UserPicker
              multiple
              people={candidates}
              meId={user.id}
              value={[]}
              onChange={(ids) => {
                if (ids.length) void run(addProjectMembersAction({ projectId: project.id, members: ids.map((userId) => ({ userId, role })) }), ids.length === 1 ? 'Added to the project' : `Added ${ids.length} people`);
              }}
              trigger={
                <Button size="sm" leadingIcon={<UserPlus aria-hidden />} disabled={candidates.length === 0} data-testid="settings-add-people">
                  Add people
                </Button>
              }
            />
          </div>
        ) : null
      }
    >
      <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle" data-testid="member-list">
        {project.members.map((member) => {
          const lastOwner = member.role === 'owner' && owners.length <= 1;
          const isMe = member.userId === user.id;
          return (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
              <div className="min-w-0 flex-1">
                <PersonAvatar userId={member.userId} showName />
                <p className="ml-7 truncate text-xs text-fg-muted">{member.person.email}{isMe ? ' · you' : ''}</p>
              </div>
              <Tooltip content={lastOwner ? 'Every project needs an owner. Make someone else owner first.' : ROLE_HELP[member.role]}>
                <span>
                  <Select
                    size="sm"
                    aria-label={`Role for ${member.person.name}`}
                    value={member.role}
                    disabled={!canManage || lastOwner}
                    onValueChange={(next) => void run(updateProjectMemberRoleAction({ projectId: project.id, userId: member.userId, role: next as ProjectRole }), `${member.person.name} is now ${PROJECT_ROLE_LABELS[next as ProjectRole].toLowerCase()}`)}
                    options={PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE_LABELS[r], description: ROLE_HELP[r] }))}
                    className="w-32"
                  />
                </span>
              </Tooltip>
              {isMe && !lastOwner ? (
                <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>
                  Leave
                </Button>
              ) : canManage && !lastOwner ? (
                <IconButton label={`Remove ${member.person.name}`} icon={<Trash2 aria-hidden />} size="sm" onClick={() => void run(removeProjectMemberAction({ projectId: project.id, userId: member.userId }), `Removed ${member.person.name}`)} />
              ) : (
                <span className="w-8" />
              )}
            </li>
          );
        })}
      </ul>
      {!canManage ? <p className="mt-3 text-xs text-fg-muted">Only project owners can add people or change roles.</p> : null}
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave this project?"
        description={project.visibility === 'private' ? 'It’s private, so you won’t see it anymore unless someone adds you back.' : 'You’ll stop getting its notifications. You can still find it in Projects.'}
        confirmLabel="Leave project"
        destructive
        onConfirm={() => {
          setLeaving(false);
          void run(removeProjectMemberAction({ projectId: project.id, userId: user.id }), 'You left the project').then((result) => {
            if (result && project.visibility === 'private') router.push(routes.projects());
          });
        }}
      />
    </SettingsSection>
  );
}

function DangerZone({ highlight }: { readonly highlight?: boolean }) {
  const { project, capabilities } = useCurrentProject();
  const { can } = useShell();
  const router = useRouter();
  const queryClient = useQueryClient();
  const run = useSettingsRunner();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState(project.name);
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateTasks, setTemplateTasks] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!capabilities['project:update']) return null;

  return (
    <SettingsSection id="danger" title="Archive, copy and delete" highlight={highlight}>
      <ul className="flex flex-col divide-y divide-border-subtle">
        <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{project.archivedAt ? 'Restore this project' : 'Archive this project'}</p>
            <p className="text-xs text-fg-muted">{project.archivedAt ? 'Puts it back in Projects, the sidebar and reports.' : 'Hides it from Projects, the sidebar and reports. Nothing is deleted.'}</p>
          </div>
          <Button
            variant="secondary"
            leadingIcon={project.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            onClick={() => void run(archiveProjectAction({ projectId: project.id, archived: !project.archivedAt }), project.archivedAt ? 'Project restored' : 'Project archived. Find it under Projects → Archived.')}
            data-testid="archive-project"
          >
            {project.archivedAt ? 'Restore' : 'Archive'}
          </Button>
        </li>
        {can('project:create') ? (
          <li className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">Make a copy</p>
              <p className="text-xs text-fg-muted">Same columns, labels, fields, milestones and tasks, in a new project.</p>
            </div>
            <Button
              variant="secondary"
              leadingIcon={<Copy aria-hidden />}
              loading={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  const copy = await run(duplicateProjectAction({ projectId: project.id, name: `${project.name} (copy)`, includeTasks: true }), 'Copy created');
                  setBusy(false);
                  if (copy) router.push(routes.project(copy.key));
                })()
              }
            >
              Make a copy
            </Button>
          </li>
        ) : null}
        <li className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">Save as a template</p>
            <p className="text-xs text-fg-muted">Your team can start new projects from this setup in the New project gallery.</p>
          </div>
          <Button variant="secondary" leadingIcon={<FileStack aria-hidden />} onClick={() => setTemplateOpen(true)}>
            Save as template
          </Button>
        </li>
        {capabilities['project:delete'] ? (
          <li className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-danger-text">Delete this project</p>
              <p className="text-xs text-fg-muted">Removes it and its tasks for everyone. You can undo right after.</p>
            </div>
            <Button variant="danger" leadingIcon={<Trash2 aria-hidden />} onClick={() => setConfirmDelete(true)} data-testid="delete-project">
              Delete project
            </Button>
          </li>
        ) : null}
      </ul>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${project.name}?`}
        description={`The project and its ${project.progress.total} ${project.progress.total === 1 ? 'task disappear' : 'tasks disappear'} for everyone. You can undo right after.`}
        confirmLabel="Delete project"
        destructive
        onConfirm={() =>
          void (async () => {
            setConfirmDelete(false);
            const result = await deleteProjectAction({ projectId: project.id });
            if (!result.ok) {
              toast.error("Couldn't delete the project", result.error.message);
              return;
            }
            void queryClient.invalidateQueries({ queryKey: qk.projects() });
            router.push(routes.projects());
            toast.undo(`Deleted ${project.name}`, {
              onUndo: async () => {
                const undo = await restoreProjectAction({ projectId: project.id });
                if (!undo.ok) throw new Error(undo.error.message);
                void queryClient.invalidateQueries({ queryKey: qk.projects() });
                router.push(routes.project(project.key));
              },
            });
          })()
        }
      />
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent size="sm">
          <DialogHeader title="Save as a template" description="New projects made from it get the same columns, labels, fields and milestones." />
          <DialogBody className="flex flex-col gap-4 pb-4">
            <Field label="Template name">{({ inputId }) => <Input id={inputId} value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={120} autoFocus />}</Field>
            <Field label="What it’s for" hint="Optional">
              {({ inputId, describedBy }) => <Textarea id={inputId} aria-describedby={describedBy} rows={2} value={templateDescription} onChange={(e) => setTemplateDescription(e.target.value)} maxLength={1000} />}
            </Field>
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <span className="text-sm text-fg">Include the tasks ({project.progress.total})</span>
              <Switch checked={templateTasks} onCheckedChange={setTemplateTasks} aria-label="Include the tasks" />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTemplateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!templateName.trim()}
              loading={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  const saved = await run(
                    saveProjectAsTemplateAction({ projectId: project.id, name: templateName.trim(), description: templateDescription.trim() || null, includeTasks: templateTasks }),
                    'Template saved. It’s in the New project gallery.',
                  );
                  setBusy(false);
                  if (saved) {
                    setTemplateOpen(false);
                    void queryClient.invalidateQueries({ queryKey: qk.templates() });
                  }
                })()
              }
            >
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

export function ProjectSettings() {
  const params = useSearchParams();
  const requested = params.get('section');
  const [active, setActive] = useState<string>(requested ?? 'general');

  useEffect(() => {
    if (!requested) return;
    const node = document.getElementById(requested);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [requested]);

  useEffect(() => {
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter((n): n is HTMLElement => Boolean(n));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '0px 0px -65% 0px' },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[180px_minmax(0,1fr)]" data-testid="project-settings">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <ul className="sticky top-5 flex flex-col gap-0.5">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  setActive(section.id);
                }}
                aria-current={active === section.id ? 'true' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                  active === section.id ? 'bg-selected font-medium text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
                )}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-5">
        <GeneralSettings highlight={requested === 'general'} />
        <WorkflowSettings highlight={requested === 'workflow'} />
        <LabelsSettings highlight={requested === 'labels'} />
        <CustomFieldsSettings highlight={requested === 'fields'} />
        <MembersSettings highlight={requested === 'members'} />
        <DangerZone highlight={requested === 'danger'} />
      </div>
    </div>
  );
}
