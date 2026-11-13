/**
 * Builds one org's seed (see types.ts) through the real domain layer, then backdates it.
 * Every write is done "as" the person who would have done it (their own DomainContext), so
 * activity, notifications, watchers and automation runs read naturally in the app.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { formSubmissions, projects as projectsTable, statuses as statusesTable } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import {
  addComment,
  addDependency,
  addKeyResult,
  addLink,
  addManualTime,
  checkInGoal,
  createAutomation,
  createCustomField,
  createForm,
  createGoal,
  createLabel,
  createMilestone,
  createProject,
  createSavedView,
  createSection,
  createSpace,
  createStatus,
  createSubtask,
  createTask,
  linkGoalProject,
  postProjectUpdate,
  recordVisit,
  saveProjectAsTemplate,
  setFavorite,
  startTimer,
  submitForm,
  toggleReaction,
  updateKeyResult,
  updateMilestone,
  updateProject,
  updateTask,
  uploadAttachment,
} from '@/server/domain';
import { addDaysIso, todayIso } from '@/lib/dates';
import { mentionToken } from '@/lib/mentions';
import type { StatusCategory } from '@/lib/constants';
import { orgBySlug, orgMembers } from './context';
import { backdateTask, backdateTimeEntry, dbClock, hash01, momentAt, setRowTimes, stampOrgAllSince, stampOrgSince, stampProjectSince } from './backdate';
import { RecordPicker } from './records';
import type { AutomationSeed, Handle, LinkPick, OrgSeed, ProjectRefs, ProjectSeed, Refs, TaskSeed } from './types';
import { wipeOrg } from './wipe';

interface Person {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

interface StatusInfo {
  readonly id: string;
  readonly name: string;
  readonly category: StatusCategory;
}

interface BuiltTask {
  readonly id: string;
  readonly seed: TaskSeed | null;
  readonly title: string;
  readonly target: StatusInfo;
  readonly assignee: Handle | null;
  readonly parent: BuiltTask | null;
  readonly createdDaysAgo: number;
  readonly completedDaysAgo: number | null;
  readonly touchedDaysAgo: number;
}

interface BuiltProject {
  readonly id: string;
  readonly key: string;
  readonly seed: ProjectSeed;
  readonly createdDaysAgo: number;
  readonly statuses: readonly StatusInfo[];
  readonly sections: Map<string, string>;
  readonly labels: Map<string, string>;
  /** Custom field name → id. */
  readonly fields: Map<string, string>;
  readonly tasks: BuiltTask[];
}

export interface OrgSeedStats {
  readonly org: string;
  readonly spaces: number;
  readonly projects: number;
  readonly tasks: number;
  readonly subtasks: number;
  readonly comments: number;
  readonly links: number;
  readonly warnings: readonly string[];
}

const log = (line: string) => process.stdout.write(`${line}\n`);

const isoDay = (offset: number | undefined): string | null => {
  if (offset === undefined) return null;
  const day = addDaysIso(todayIso(), offset);
  // Keep work off weekends: Saturday → Friday, Sunday → Monday.
  const weekday = new Date(`${day}T12:00:00`).getDay();
  if (weekday === 6) return addDaysIso(day, offset < 0 ? -1 : 2);
  if (weekday === 0) return addDaysIso(day, offset < 0 ? -2 : 1);
  return day;
};

const dayOffset = (iso: string | null): number | undefined => {
  if (!iso) return undefined;
  const ms = new Date(`${iso}T12:00:00`).getTime() - new Date(`${todayIso()}T12:00:00`).getTime();
  return Math.round(ms / 86_400_000);
};

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class OrgBuilder {
  private orgId = '';
  private people = new Map<Handle, Person>();
  private contexts = new Map<Handle, DomainContext>();
  private spaces = new Map<string, string>();
  private projects = new Map<string, BuiltProject>();
  private picker!: RecordPicker;
  private readonly warnings: string[] = [];
  private stats = { comments: 0, links: 0, subtasks: 0, tasks: 0 };

  constructor(private readonly spec: OrgSeed) {}

  async run(): Promise<OrgSeedStats> {
    const org = await orgBySlug(this.spec.slug);
    if (!org) throw new Error(`Seed: org ${this.spec.slug} not found. Run the platform seeds first.`);
    this.orgId = org.id;
    this.picker = new RecordPicker(org.id);
    const members = await orgMembers(org.id);
    for (const [handle, email] of Object.entries(this.spec.people)) {
      const member = members.find((m) => m.email.toLowerCase() === email.toLowerCase());
      if (member) this.people.set(handle, { id: member.id, name: member.name, email: member.email });
      else this.warn(`${email} is not a member of ${this.spec.slug}; their work goes to the lead instead`);
    }
    if (!this.people.has(this.spec.me)) throw new Error(`Seed: ${this.spec.people[this.spec.me]} must be a member of ${this.spec.slug}.`);

    log(`seed:${this.spec.slug} - clearing existing Projects data`);
    await wipeOrg(org.id);

    await this.buildSpaces();
    await this.buildWorkspaceLabels();
    for (const automation of this.spec.automations.filter((a) => a.early && a.project === null)) await this.buildAutomation(automation);
    for (const project of this.spec.projects) await this.buildProject(project);
    for (const automation of this.spec.automations.filter((a) => !a.early)) await this.buildAutomation(automation);
    for (const form of this.spec.forms) await this.buildForm(form);
    for (const template of this.spec.templates) await this.buildTemplate(template);
    for (const goal of this.spec.goals) await this.buildGoal(goal);
    await this.buildPersonalState();
    await this.settleInbox();

    return {
      org: this.spec.slug,
      spaces: this.spaces.size,
      projects: this.projects.size,
      tasks: this.stats.tasks,
      subtasks: this.stats.subtasks,
      comments: this.stats.comments,
      links: this.stats.links,
      warnings: this.warnings,
    };
  }

  // --- People ---------------------------------------------------------------------------------

  private warn(message: string): void {
    this.warnings.push(message);
    process.stderr.write(`  ! ${message}\n`);
  }

  private person(handle: Handle | null | undefined): Person | null {
    if (!handle) return null;
    return this.people.get(handle) ?? null;
  }

  private personId(handle: Handle | null | undefined): string | null {
    return this.person(handle)?.id ?? null;
  }

  private ctx(handle: Handle | null | undefined): DomainContext {
    const key = handle && this.people.has(handle) ? handle : this.spec.me;
    const existing = this.contexts.get(key);
    if (existing) return existing;
    const person = this.people.get(key) as Person;
    const ctx: DomainContext = { orgId: this.orgId, orgSlug: this.spec.slug, userId: person.id, userName: person.name, orgRole: 'owner', actorKind: 'user' };
    this.contexts.set(key, ctx);
    return ctx;
  }

  /** `{handle}` → mention token. */
  private mentions(text: string): string {
    return text.replace(/\{([a-z]+)\}/g, (match, handle: string) => {
      const person = this.person(handle);
      return person ? mentionToken(person.name, person.id) : match;
    });
  }

  private refs(): Refs {
    return {
      person: (handle) => {
        const id = this.personId(handle);
        if (!id) throw new Error(`Seed: unknown person ${handle}`);
        return id;
      },
      project: (key) => this.projectRefs(key),
    };
  }

  private projectRefs(key: string): ProjectRefs {
    const built = this.projects.get(key);
    if (!built) throw new Error(`Seed: project ${key} is not built yet`);
    const need = (map: Map<string, string>, name: string, what: string) => {
      const id = map.get(name);
      if (!id) throw new Error(`Seed: ${key} has no ${what} "${name}"`);
      return id;
    };
    return {
      id: built.id,
      key: built.key,
      status: (name) => {
        const status = built.statuses.find((s) => s.name === name);
        if (!status) throw new Error(`Seed: ${key} has no status "${name}"`);
        return status.id;
      },
      section: (name) => need(built.sections, name, 'section'),
      label: (name) => need(built.labels, name, 'label'),
    };
  }

  // --- Workspace ------------------------------------------------------------------------------

  private async buildSpaces(): Promise<void> {
    for (const [index, space] of this.spec.spaces.entries()) {
      const marker = await dbClock();
      const created = await createSpace(this.ctx(space.by), { name: space.name, description: space.description, color: space.color, icon: space.icon });
      this.spaces.set(space.name, created.id);
      const ts = momentAt(96 - index * 2, 10 + index * 0.4);
      await setRowTimes('spaces', created.id, ts);
      await stampOrgSince(this.orgId, marker, ts);
    }
    log(`seed:${this.spec.slug} - ${this.spaces.size} spaces`);
  }

  private async buildWorkspaceLabels(): Promise<void> {
    const marker = await dbClock();
    for (const label of this.spec.workspaceLabels ?? []) await createLabel(this.ctx(this.spec.me), { projectId: null, name: label.name, color: label.color });
    await stampOrgSince(this.orgId, marker, momentAt(95, 11));
  }

  // --- Links ----------------------------------------------------------------------------------

  private async link(ctx: DomainContext, owner: { taskId: string } | { projectId: string }, pick: LinkPick): Promise<void> {
    const record = await this.picker.pick(pick);
    if (!record) {
      this.warn(`no ${pick.type} record found for ${JSON.stringify(pick)}; link skipped`);
      return;
    }
    try {
      await addLink(ctx, { ...owner, targetType: record.type, targetId: record.id });
      this.stats.links += 1;
    } catch (error) {
      this.warn(`link to ${record.type} ${record.label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Projects -------------------------------------------------------------------------------

  private async buildProject(spec: ProjectSeed): Promise<void> {
    const owner = this.ctx(spec.owner);
    const createdDaysAgo = spec.created ?? Math.max(2, -spec.start + 3);
    const projectTs = momentAt(createdDaysAgo, 9.25 + hash01(spec.key) * 2);
    const marker = await dbClock();
    const customerId = spec.customer ? await this.picker.customerId(spec.customer) : null;
    if (spec.customer && !customerId) this.warn(`customer ${spec.customer} not found for ${spec.key}`);
    const startDate = isoDay(spec.start);
    const dueDate = isoDay(spec.due);
    const detail = await createProject(owner, {
      name: spec.name,
      key: spec.key,
      description: spec.description,
      spaceId: this.spaces.get(spec.space) ?? null,
      status: spec.status === 'completed' ? 'active' : spec.status,
      health: 'on_track',
      startDate,
      dueDate,
      color: spec.color,
      icon: spec.icon,
      crmCustomerId: customerId,
      wmsRef: spec.wmsClient && customerId ? { clientId: customerId, clientCode: spec.wmsClient } : null,
      members: spec.members.flatMap(([handle, role]) => {
        const id = this.personId(handle);
        return id ? [{ userId: id, role }] : [];
      }),
      skipDefaults: Boolean(spec.workflow),
    });
    const projectId = detail.id;

    // Workflow
    if (spec.workflow) {
      for (const status of spec.workflow) {
        await createStatus(owner, projectId, { name: status.name, category: status.category, color: status.color, wipLimit: status.wip ?? null });
      }
      const firstTodo = spec.workflow.find((s) => s.category === 'todo') ?? spec.workflow[0];
      await db.execute(sql`update pm.statuses set is_default = (name = ${firstTodo.name}) where project_id = ${projectId}`);
    }
    const statusRows = await db
      .select({ id: statusesTable.id, name: statusesTable.name, category: statusesTable.category })
      .from(statusesTable)
      .where(eq(statusesTable.projectId, projectId))
      .orderBy(sql`${statusesTable.position} COLLATE "C"`);
    const sections = new Map<string, string>();
    for (const name of spec.sections) sections.set(name, (await createSection(owner, projectId, { name })).id);
    const labels = new Map<string, string>();
    for (const label of spec.labels) labels.set(label.name, (await createLabel(owner, { projectId, name: label.name, color: label.color })).id);
    // Workspace labels are usable everywhere.
    const workspaceLabels = await db.execute<{ id: string; name: string }>(sql`select id, name from pm.labels where org_id = ${this.orgId} and project_id is null`);
    for (const row of workspaceLabels.rows) if (!labels.has(row.name)) labels.set(row.name, row.id);
    const fields = new Map<string, { id: string; type: string; options: Map<string, string> }>();
    for (const field of spec.fields ?? []) {
      const options = (field.options ?? []).map((option) => ({ id: `opt-${slug(option.label)}`, label: option.label, color: option.color }));
      const created = await createCustomField(owner, {
        projectId,
        name: field.name,
        type: field.type,
        description: field.description ?? null,
        config: field.type === 'currency' ? { currency: field.currency ?? 'USD', precision: 0 } : options.length ? { options } : {},
      });
      fields.set(field.name, { id: created.id, type: field.type, options: new Map(options.map((o) => [o.label, o.id])) });
    }
    const milestones = new Map<string, string>();
    for (const milestone of spec.milestones ?? []) {
      const created = await createMilestone(owner, projectId, { name: milestone.name, description: milestone.description ?? null, dueDate: isoDay(milestone.due) });
      milestones.set(milestone.name, created.id);
    }
    await stampProjectSince(projectId, marker, projectTs);
    await setRowTimes('projects', projectId, projectTs);

    const built: BuiltProject = {
      id: projectId,
      key: spec.key,
      seed: spec,
      createdDaysAgo,
      statuses: statusRows,
      sections,
      labels,
      fields: new Map([...fields].map(([name, field]) => [name, field.id])),
      tasks: [],
    };
    this.projects.set(spec.key, built);

    // Rules that should fire while the work below happens.
    for (const automation of this.spec.automations.filter((a) => a.early && a.project === spec.key)) await this.buildAutomation(automation);

    // Project-level links (customer, deal, account…)
    if (spec.links?.length) {
      const linkMarker = await dbClock();
      for (const pick of spec.links) await this.link(owner, { projectId }, pick);
      await stampProjectSince(projectId, linkMarker, momentAt(Math.max(0, createdDaysAgo - 1), 11.5));
    }

    // 1) Create every task in its first status.
    const byLocalId = new Map<string, BuiltTask>();
    for (const [index, task] of spec.tasks.entries()) {
      const created = await this.createSeedTask(built, task, index, fields, milestones);
      if (task.id) byLocalId.set(task.id, created);
    }

    // 2) Links and dependencies.
    for (const task of built.tasks) {
      if (!task.seed || task.parent) continue;
      for (const pick of task.seed.links ?? []) await this.link(this.ctx(task.assignee ?? spec.owner), { taskId: task.id }, pick);
      for (const dep of task.seed.deps ?? []) {
        const blocking = byLocalId.get(dep);
        if (!blocking) {
          this.warn(`${spec.key}: dependency ${dep} not found`);
          continue;
        }
        await addDependency(owner, { blockingTaskId: blocking.id, blockedTaskId: task.id }).catch((error: unknown) =>
          this.warn(`${spec.key}: dependency ${dep} → ${task.title} failed: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    }

    // 3) Walk each task through its workflow, with the conversation in between.
    for (const task of built.tasks) await this.walkTask(built, task);

    // 4) Time logged and files.
    for (const task of built.tasks) {
      for (const [handle, minutes, daysAgo, note, billable] of task.seed?.time ?? []) {
        const lo = task.completedDaysAgo ?? 0;
        const when = Math.min(task.createdDaysAgo, Math.max(lo, daysAgo));
        const entry = await addManualTime(this.ctx(handle), { taskId: task.id, minutes, note: note ?? null, billable: billable ?? false });
        const latestStart = Math.max(8.5, 17.5 - minutes / 60);
        await backdateTimeEntry(entry.id, momentAt(when, 8.5 + hash01(entry.id) * (latestStart - 8.5)), minutes);
      }
    }
    for (const file of spec.files ?? []) {
      const task = file.task ? built.tasks.find((t) => t.title === file.task) : undefined;
      if (file.task && !task) this.warn(`${spec.key}: file ${file.name} → task "${file.task}" not found`);
      const fileMarker = await dbClock();
      await uploadAttachment(this.ctx(file.by), {
        projectId,
        taskId: task?.id ?? null,
        name: file.name,
        contentType: file.contentType,
        bytes: new TextEncoder().encode(file.body),
      });
      if (!task) await stampProjectSince(projectId, fileMarker, momentAt(file.daysAgo, 14.2));
    }

    // 5) Spread history over the project's life.
    for (const task of built.tasks) {
      const createdAt = momentAt(task.createdDaysAgo, 8.6 + hash01(`${task.id}:c`) * 3);
      const completedAt = task.completedDaysAgo === null ? null : momentAt(task.completedDaysAgo, 13 + hash01(`${task.id}:d`) * 4.5);
      const lastTouchedAt = momentAt(task.touchedDaysAgo, 10 + hash01(`${task.id}:t`) * 7);
      await backdateTask(task.id, {
        createdAt,
        completedAt: completedAt && completedAt < createdAt ? new Date(createdAt.getTime() + 3_600_000) : completedAt,
        lastTouchedAt: lastTouchedAt < createdAt ? new Date(createdAt.getTime() + 3_600_000) : lastTouchedAt,
      });
    }

    // 6) Milestones reached, status updates, final health/status.
    for (const milestone of spec.milestones ?? []) {
      if (!milestone.done) continue;
      const id = milestones.get(milestone.name) as string;
      const doneMarker = await dbClock();
      await updateMilestone(owner, id, { completed: true });
      await db.execute(sql`update pm.milestones set completed_at = ${momentAt(Math.max(0, -(milestone.due)), 16).toISOString()}::timestamptz where id = ${id}`);
      await stampProjectSince(projectId, doneMarker, momentAt(Math.max(0, -milestone.due), 16));
    }
    for (const update of [...(spec.updates ?? [])].sort((a, b) => b.daysAgo - a.daysAgo)) {
      const updateMarker = await dbClock();
      await postProjectUpdate(this.ctx(update.by), projectId, { health: update.health, note: this.mentions(update.note), status: update.status });
      await stampProjectSince(projectId, updateMarker, momentAt(update.daysAgo, 16.4 + hash01(update.note) * 1.2));
    }
    const last = [...(spec.updates ?? [])].sort((a, b) => a.daysAgo - b.daysAgo)[0];
    if (!last || last.health !== spec.health || (spec.status !== 'completed' && (last.status ?? spec.status) !== spec.status)) {
      const fixMarker = await dbClock();
      await updateProject(owner, projectId, { health: spec.health, status: spec.status });
      await stampProjectSince(projectId, fixMarker, momentAt(Math.max(0, (last?.daysAgo ?? 1) - 0), 17));
    } else if (spec.status === 'completed') {
      const fixMarker = await dbClock();
      await updateProject(owner, projectId, { status: 'completed' });
      await stampProjectSince(projectId, fixMarker, momentAt(last.daysAgo, 17.2));
    }
    if (spec.status === 'completed') {
      const finished = await db.execute<{ ts: string | null }>(sql`select max(completed_at)::text as ts from pm.tasks where project_id = ${projectId}`);
      await db.update(projectsTable).set({ completedAt: finished.rows[0]?.ts ? new Date(finished.rows[0].ts) : momentAt(-spec.due, 17) }).where(eq(projectsTable.id, projectId));
    }

    // 7) Saved views.
    for (const view of spec.views ?? []) {
      const viewMarker = await dbClock();
      const created = await createSavedView(this.ctx(view.personal ?? spec.owner), {
        projectId,
        name: view.name,
        type: view.type,
        config: this.resolvePlaceholders(view.config, built),
        shared: !view.personal,
        isDefault: view.isDefault ?? false,
      });
      const viewTs = momentAt(Math.max(1, createdDaysAgo - 2), 15);
      await setRowTimes('saved_views', created.id, viewTs);
      await stampProjectSince(projectId, viewMarker, viewTs);
    }
    await db.execute(sql`update pm.projects set updated_at = coalesce((select max(created_at) from pm.activity where project_id = ${projectId}), updated_at) where id = ${projectId}`);
    const subtasks = built.tasks.filter((t) => t.parent).length;
    log(`seed:${this.spec.slug} - ${spec.key} ${spec.name}: ${built.tasks.length - subtasks} tasks, ${subtasks} subtasks`);
  }

  /**
   * Saved views name things instead of ids: whole strings `__label:Name`, `__status:Name`,
   * `__person:handle`, and `__field:Name` anywhere inside a string (e.g. `custom:__field:Deal size`).
   */
  private resolvePlaceholders<T>(config: T, project: BuiltProject): T {
    return JSON.parse(
      JSON.stringify(config)
        .replace(/__field:([^"]+)/g, (match, name: string) => {
          const id = project.fields.get(name);
          if (!id) this.warn(`${project.key}: view placeholder field:${name} not found`);
          return id ?? match;
        })
        .replace(/"__(label|status|person):([^"]+)"/g, (match, kind: string, name: string) => {
        const id =
          kind === 'label' ? project.labels.get(name) : kind === 'status' ? project.statuses.find((s) => s.name === name)?.id : this.personId(name);
        if (!id) this.warn(`${project.key}: view placeholder ${kind}:${name} not found`);
        return JSON.stringify(id ?? name);
      }),
    ) as T;
  }

  /** Days-ago bookkeeping for a task, derived from its dates and project life. */
  private timeline(
    project: BuiltProject,
    seed: { readonly start?: number; readonly due?: number; readonly created?: number; readonly comments?: number },
    key: string,
    target: StatusInfo,
  ) {
    const projectAge = project.createdDaysAgo;
    const roll = hash01(`${key}:age`);
    let created: number;
    if (seed.created !== undefined) created = seed.created;
    // About 40% of the work is planned when the project starts; the rest is added along the way.
    else if (roll < 0.4) created = projectAge - Math.round(roll * 5);
    else if (seed.start !== undefined) created = -seed.start + 1 + Math.round(roll * 5);
    else if (seed.due !== undefined) created = -seed.due + Math.round(4 + roll * 18 + Math.max(0, seed.due) * 0.5);
    else created = Math.round(projectAge * (0.2 + 0.6 * roll));
    if (seed.due !== undefined && seed.due < 0) created = Math.max(created, -seed.due + 2);
    // A conversation needs a few days to happen in.
    if (seed.created === undefined && seed.comments) created = Math.max(created, 2 + seed.comments * 2);
    created = Math.max(1, Math.min(projectAge, created));
    let completed: number | null = null;
    if (target.category === 'done' || target.category === 'cancelled') {
      const roll = hash01(`${key}:done`);
      if (seed.due !== undefined && seed.due <= 0) {
        const early = roll < 0.18 ? -1 : roll < 0.6 ? 0 : roll < 0.85 ? 1 : 2;
        completed = Math.max(0, -seed.due + early);
      } else {
        completed = Math.floor(roll * 5);
      }
      completed = Math.min(completed, Math.max(0, created - 1));
    }
    const touched = completed ?? Math.min(created, Math.floor(hash01(`${key}:touch`) * 4));
    return { created, completed, touched };
  }

  private async createSeedTask(
    project: BuiltProject,
    seed: TaskSeed,
    index: number,
    fields: Map<string, { id: string; type: string; options: Map<string, string> }>,
    milestones: Map<string, string>,
  ): Promise<BuiltTask> {
    const target = project.statuses.find((s) => s.name === seed.st);
    if (!target) throw new Error(`Seed: ${project.key} task "${seed.t}" uses unknown status "${seed.st}"`);
    const creator = this.ctx(seed.by ?? project.seed.owner);
    const customFields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(seed.cf ?? {})) {
      const field = fields.get(name);
      if (!field) {
        this.warn(`${project.key}: unknown field ${name}`);
        continue;
      }
      if (field.type === 'select') customFields[field.id] = field.options.get(String(value)) ?? null;
      else if (field.type === 'multiselect') customFields[field.id] = (value as string[]).map((label) => field.options.get(label)).filter(Boolean);
      else if (field.type === 'person') customFields[field.id] = this.personId(String(value));
      else if (field.type === 'date') customFields[field.id] = isoDay(Number(value));
      else customFields[field.id] = value;
    }
    const labelIds = (seed.labels ?? []).flatMap((name) => {
      const id = project.labels.get(name);
      if (!id) this.warn(`${project.key}: unknown label ${name}`);
      return id ? [id] : [];
    });
    // Most real tasks span a few days on the timeline: give dated tasks a start when none is set.
    let start = seed.start;
    if (start === undefined && seed.due !== undefined && !seed.ms) {
      const span = Math.max(1, Math.min(8, Math.round(seed.pts ? 1 + seed.pts * 0.6 : seed.est ? seed.est / 240 : 1 + hash01(`${seed.t}:span`) * 5)));
      start = Math.max(seed.due - span, Math.min(project.seed.start, seed.due));
    }
    const summary = await createTask(creator, {
      projectId: project.id,
      title: seed.t,
      description: seed.d ?? null,
      sectionId: seed.s ? (project.sections.get(seed.s) ?? null) : null,
      priority: seed.p ?? 'none',
      assigneeId: this.personId(seed.a),
      startDate: isoDay(start),
      dueDate: isoDay(seed.due),
      estimatePoints: seed.pts ?? null,
      estimateMinutes: seed.est ?? null,
      isMilestone: seed.ms ?? false,
      milestoneId: seed.milestone ? (milestones.get(seed.milestone) ?? null) : null,
      labelIds,
      customFields,
      watcherIds: (seed.watchers ?? []).flatMap((h) => this.personId(h) ?? []),
    });
    this.stats.tasks += 1;
    const times = this.timeline(project, { start: dayOffset(summary.startDate), due: dayOffset(summary.dueDate), created: seed.created, comments: seed.c?.length ?? 0 }, `${project.key}:${index}:${seed.t}`, target);
    const built: BuiltTask = {
      id: summary.id,
      seed,
      title: seed.t,
      target,
      assignee: seed.a ?? null,
      parent: null,
      createdDaysAgo: times.created,
      completedDaysAgo: times.completed,
      touchedDaysAgo: times.touched,
    };
    project.tasks.push(built);
    for (const [subIndex, sub] of (seed.sub ?? []).entries()) {
      const doneStatus = project.statuses.find((s) => s.category === 'done') as StatusInfo;
      const todo = project.statuses.find((s) => s.category === 'todo') as StatusInfo;
      const parentDone = target.category === 'done';
      const subDone = sub.done ?? parentDone;
      const subSummary = await createSubtask(this.ctx(seed.a ?? project.seed.owner), summary.id, {
        title: sub.t,
        assigneeId: this.personId(sub.a === undefined ? seed.a : sub.a),
        dueDate: isoDay(sub.due),
      });
      this.stats.subtasks += 1;
      const created = Math.max(0, times.created - (subIndex === 0 ? 0 : hash01(`${sub.t}:c`) < 0.5 ? 0 : 1));
      let completed: number | null = null;
      if (subDone) {
        const end = times.completed ?? 0;
        completed = Math.max(end, Math.round(end + (created - end) * (0.15 + 0.7 * ((subIndex + 1) / ((seed.sub?.length ?? 1) + 1)))));
        completed = Math.min(completed, Math.max(0, created));
      }
      project.tasks.push({
        id: subSummary.id,
        seed: null,
        title: sub.t,
        target: subDone ? doneStatus : todo,
        assignee: sub.a === undefined ? (seed.a ?? null) : sub.a,
        parent: built,
        createdDaysAgo: created,
        completedDaysAgo: completed,
        touchedDaysAgo: completed ?? Math.min(created, times.touched),
      });
    }
    return built;
  }

  /** Moves a task from its first status to its target, posting its comments halfway. */
  private async walkTask(project: BuiltProject, task: BuiltTask): Promise<void> {
    const ordered = project.statuses;
    const targetIndex = ordered.findIndex((s) => s.id === task.target.id);
    const first = ordered.find((s) => s.category === 'todo') ?? ordered[0];
    const path =
      task.target.category === 'cancelled'
        ? [task.target]
        : ordered.slice(0, targetIndex + 1).filter((s) => s.id !== first.id && s.category !== 'cancelled' && (s.category !== 'todo' || s.id === task.target.id));
    const comments = task.seed?.c ?? [];
    const mid = path.length === 0 ? 0 : Math.max(1, Math.ceil(path.length / 2));
    const worker = this.ctx(task.assignee ?? project.seed.owner);
    const reviewer = this.ctx(project.seed.owner);
    const hasReview = path.some((s) => /review|qa|approval|check/i.test(s.name));
    let lastCommentId: string | null = null;
    const postComments = async () => {
      for (const comment of comments) {
        const [author, text, options] = comment as readonly [Handle, string, { reply?: boolean; react?: readonly [Handle, string][] }?];
        const posted = await addComment(this.ctx(author), {
          taskId: task.id,
          body: this.mentions(text),
          parentCommentId: options?.reply && lastCommentId ? lastCommentId : null,
        });
        this.stats.comments += 1;
        if (!options?.reply) lastCommentId = posted.id;
        for (const [reactor, emoji] of options?.react ?? []) await toggleReaction(this.ctx(reactor), posted.id, emoji);
      }
    };
    if (path.length === 0) {
      await postComments();
      return;
    }
    for (const [index, status] of path.entries()) {
      if (index === mid) await postComments();
      const isFinal = index === path.length - 1;
      const actor = isFinal && (status.category === 'done' || status.category === 'cancelled') && hasReview ? reviewer : worker;
      await updateTask(actor, task.id, { statusId: status.id });
    }
    if (mid >= path.length) await postComments();
  }

  // --- Studio ---------------------------------------------------------------------------------

  private async buildAutomation(seed: AutomationSeed): Promise<void> {
    const rule = seed.build(this.refs());
    const projectId = seed.project ? this.projectRefs(seed.project).id : null;
    const marker = await dbClock();
    const created = await createAutomation(this.ctx(seed.by), {
      projectId,
      name: seed.name,
      description: seed.description ?? null,
      enabled: seed.enabled ?? true,
      trigger: rule.trigger,
      conditions: rule.conditions ?? [],
      actions: rule.actions,
    });
    const project = seed.project ? this.projects.get(seed.project) : null;
    const age = project ? Math.max(1, project.createdDaysAgo - 1) : 60;
    const ts = momentAt(age, 15.5);
    await setRowTimes('automations', created.id, ts);
    if (projectId) await stampProjectSince(projectId, marker, ts);
    else await stampOrgSince(this.orgId, marker, ts);
  }

  private async buildForm(seed: OrgSeed['forms'][number]): Promise<void> {
    const project = this.projects.get(seed.project);
    if (!project) throw new Error(`Seed: form project ${seed.project} missing`);
    const marker = await dbClock();
    const form = await createForm(this.ctx(seed.by), {
      projectId: project.id,
      name: seed.name,
      description: seed.description,
      fields: seed.fields,
      settings: seed.settings(this.refs()),
      isPublic: true,
      enabled: true,
    });
    const formTs = momentAt(Math.max(3, project.createdDaysAgo - 1), 13);
    await setRowTimes('forms', form.id, formTs);
    await stampProjectSince(project.id, marker, formTs);
    for (const submission of [...seed.submissions].sort((a, b) => b.daysAgo - a.daysAgo)) {
      await submitForm({ token: form.publicToken, answers: submission.answers, submitterName: submission.name, submitterEmail: submission.email });
      const [row] = await db
        .select({ id: formSubmissions.id, taskId: formSubmissions.taskId })
        .from(formSubmissions)
        .where(eq(formSubmissions.formId, form.id))
        .orderBy(sql`${formSubmissions.createdAt} desc`)
        .limit(1);
      if (!row?.taskId) continue;
      this.stats.tasks += 1;
      const createdAt = momentAt(submission.daysAgo, 9 + hash01(submission.email) * 8);
      await db.execute(sql`update pm.form_submissions set created_at = ${createdAt.toISOString()}::timestamptz where id = ${row.id}`);
      await backdateTask(row.taskId, { createdAt, completedAt: null, lastTouchedAt: new Date(createdAt.getTime() + 25 * 60_000) });
    }
    log(`seed:${this.spec.slug} - form “${seed.name}” with ${seed.submissions.length} submissions`);
  }

  private async buildTemplate(seed: OrgSeed['templates'][number]): Promise<void> {
    const project = this.projects.get(seed.fromProject);
    if (!project) throw new Error(`Seed: template source ${seed.fromProject} missing`);
    const marker = await dbClock();
    const template = await saveProjectAsTemplate(this.ctx(seed.by), project.id, { name: seed.name, description: seed.description, category: seed.category, includeTasks: true });
    const ts = momentAt(Math.max(1, Math.round(project.createdDaysAgo / 4)), 16);
    await setRowTimes('templates', template.id, ts);
    await stampProjectSince(project.id, marker, ts);
  }

  private async buildGoal(seed: OrgSeed['goals'][number]): Promise<void> {
    const marker = await dbClock();
    const owner = this.ctx(seed.owner);
    const parent = seed.parent
      ? (await db.execute<{ id: string }>(sql`select id from pm.goals where org_id = ${this.orgId} and name = ${seed.parent} and deleted_at is null limit 1`)).rows[0]?.id
      : null;
    const goal = await createGoal(owner, {
      name: seed.name,
      description: seed.description,
      ownerId: owner.userId,
      parentGoalId: parent ?? null,
      period: seed.period,
      startDate: isoDay(seed.start),
      dueDate: isoDay(seed.due),
      health: seed.checkIns?.length ? 'on_track' : seed.health,
      progressMode: seed.mode,
      manualProgress: seed.manualProgress ?? 0,
      color: seed.color,
    });
    for (const key of seed.projects ?? []) {
      const project = this.projects.get(key);
      if (project) await linkGoalProject(owner, goal.id, project.id, true);
    }
    let latest = goal;
    for (const kr of seed.keyResults ?? []) {
      const project = kr.project ? this.projects.get(kr.project) : undefined;
      latest = await addKeyResult(owner, goal.id, {
        name: kr.name,
        kind: kr.kind,
        startValue: kr.start ?? 0,
        targetValue: kr.target ?? 100,
        currentValue: kr.start ?? 0,
        unit: kr.unit ?? null,
        projectId: project?.id ?? null,
      });
    }
    const created = momentAt(-seed.start + 2, 10.5);
    await setRowTimes('goals', goal.id, created);
    await stampOrgAllSince(this.orgId, marker, created);
    const krId = (name: string) => latest.keyResults.find((kr) => kr.name === name)?.id;
    for (const checkIn of seed.checkIns ?? []) {
      const checkMarker = await dbClock();
      await checkInGoal(this.ctx(checkIn.by), goal.id, {
        health: checkIn.health,
        note: this.mentions(checkIn.note),
        keyResults: Object.entries(checkIn.values ?? {}).flatMap(([name, value]) => {
          const id = krId(name);
          return id ? [{ id, currentValue: value }] : [];
        }),
      });
      await stampOrgAllSince(this.orgId, checkMarker, momentAt(checkIn.daysAgo, 16.75));
    }
    // Final values (in case the last check-in didn't touch every key result).
    const finalMarker = await dbClock();
    for (const kr of seed.keyResults ?? []) {
      const id = krId(kr.name);
      if (id && kr.kind !== 'project' && kr.current !== undefined) await updateKeyResult(owner, id, { currentValue: kr.current });
    }
    await stampOrgAllSince(this.orgId, finalMarker, momentAt(Math.max(0, (seed.checkIns?.at(-1)?.daysAgo ?? 3) - 0), 17.4));
    await db.execute(sql`update pm.goals set health = ${seed.health} where id = ${goal.id}`);
  }

  // --- Personal state ---------------------------------------------------------------------------

  private async buildPersonalState(): Promise<void> {
    for (const [handle, keys] of Object.entries(this.spec.favorites)) {
      for (const key of keys) {
        const project = this.projects.get(key);
        if (project) await setFavorite(this.ctx(handle), 'project', project.id, true);
      }
    }
    const me = this.ctx(this.spec.me);
    for (const [index, key] of this.spec.recents.entries()) {
      const project = this.projects.get(key);
      if (!project) continue;
      await recordVisit(me, 'project', project.id);
      const hoursAgo = (this.spec.recents.length - index) * 5;
      await db.execute(sql`update pm.recents set visited_at = now() - make_interval(hours => ${hoursAgo}) where user_id = ${me.userId} and entity_id = ${project.id}`);
    }
    if (this.spec.runningTimer) {
      const project = this.projects.get(this.spec.runningTimer.project);
      const task = project?.tasks.find((t) => t.title === this.spec.runningTimer?.task);
      if (task) {
        const entry = await startTimer(me, task.id);
        await db.execute(sql`update pm.time_entries set started_at = now() - make_interval(mins => ${this.spec.runningTimer.minutesAgo}) where id = ${entry.id}`);
      } else this.warn(`running timer task "${this.spec.runningTimer.task}" not found`);
    }
  }

  /** Old notifications read (and a few archived); recent ones stay unread, at most a dozen each. */
  private async settleInbox(): Promise<void> {
    await db.execute(sql`update pm.notifications set read_at = created_at + interval '2 hours'
      where org_id = ${this.orgId} and read_at is null and created_at < now() - interval '3 days'`);
    await db.execute(sql`
      update pm.notifications n set read_at = n.created_at + interval '1 hour'
      from (
        select id, row_number() over (partition by user_id order by created_at desc) as rn
        from pm.notifications where org_id = ${this.orgId} and read_at is null
      ) ranked
      where ranked.id = n.id and ranked.rn > 12`);
    await db.execute(sql`update pm.notifications set archived_at = read_at + interval '1 day'
      where org_id = ${this.orgId} and kind = 'project' and created_at < now() - interval '20 days'`);
    const counts = await db.execute<{ unread: number; total: number }>(sql`
      select count(*) filter (where read_at is null and archived_at is null)::int as unread, count(*)::int as total
      from pm.notifications where org_id = ${this.orgId} and user_id = ${this.ctx(this.spec.me).userId}`);
    log(`seed:${this.spec.slug} - inbox for ${this.spec.people[this.spec.me]}: ${counts.rows[0]?.unread ?? 0} unread of ${counts.rows[0]?.total ?? 0}`);
    await db.execute(sql`update pm.automations a set last_run_at = (select max(r.created_at) from pm.automation_runs r where r.automation_id = a.id)
      where a.org_id = ${this.orgId}`);
    await db.execute(sql`update pm.forms f set updated_at = coalesce((select max(fs.created_at) from pm.form_submissions fs where fs.form_id = f.id), f.updated_at)
      where f.org_id = ${this.orgId}`);
    // The project overview uses tasks.updated_at for "recently updated"; keep it ≤ now.
    await db.execute(sql`update pm.tasks set updated_at = least(updated_at, now()) where org_id = ${this.orgId}`);
  }
}
