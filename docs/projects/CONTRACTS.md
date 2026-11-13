# KitStak Projects — team contracts

Foundation is in place: runnable app (`apps/projects`, port 3400), `pm` schema migrated, full domain
layer, server actions, `/api/v1` routes, design system, shell, and a real (minimal) page for every route.
Each team extends its own folders. When you need something outside your folders, add it in a backwards
compatible way and mention it in your report.

## 1. Folder ownership

| Team | Owns |
| --- | --- |
| **foundation** | `src/server/{auth,db,env,session,entitlements,errors,sanitize,page}.ts`, `src/server/domain/*`, `src/server/actions/*`, `src/server/http/*`, `src/app/api/v1/*`, `src/components/{ui,pm,layout}`, `src/features/shell`, `src/lib/*` (except `nl-parse.ts`), `drizzle/*` |
| **views-a** | `src/features/board`, `src/features/list`, `src/features/table`, `src/features/views` (filter bar, saved views, pickers, bulk bar) |
| **views-b** | `src/features/timeline`, `src/features/calendar`, `src/features/workload` |
| **task** | `src/features/task` (drawer + full page, comments, subtasks, deps, attachments, time, activity) |
| **nav** | `src/features/{home,my-work,inbox,search,command,quick-add}`, `src/lib/nl-parse.ts`, keyboard shortcuts (`src/features/shell/use-shell-hotkeys.ts` + `shortcuts-dialog.tsx` list may be extended) |
| **portfolio** | `src/features/projects` (directory, create wizard, project frame, overview/files/activity/settings tabs), `src/features/goals`, `src/features/dashboards` |
| **studio** | `src/features/{automations,templates,forms,settings,onboarding}` |
| **integrations** | `apps/crm`, `apps/wms`, `apps/portal`, `packages/ui/src/app-switcher`, `apps/projects/src/server/integrations`, `src/features/integrations` |
| **seed** | `apps/projects/src/server/db/seed` (keep `context.ts` helpers; `minimal.ts` may be replaced) |

Shared files anyone may extend additively: `src/lib/types.ts`, `src/lib/query-keys.ts`, `src/lib/hooks/use-data.ts`,
`src/lib/constants.ts`, `src/server/domain/*` (add functions, don't change signatures), `src/server/actions/*` (add actions).
Schema changes: new migration `drizzle/0001_*.sql` + journal entry + Drizzle mirror; `0000_pm_init.sql` is applied and immutable.

## 2. How a route is wired

```
src/app/(app)/<route>/page.tsx      thin: imports XPage from '@/features/<area>' (index.ts)
src/features/<area>/<area>-page.tsx server component: pageContext() + domain reads → <XView initial... />
src/features/<area>/<area>-view.tsx 'use client': hooks (initialData = server data), actions, UI
```

- `pageContext(returnTo)` (`src/server/page.ts`) → `{ ctx: DomainContext, context: ProjectsContext }`; redirects to `/login?next=…` when signed out.
- The `(app)` layout already gates entitlement (in-app locked screen) and renders the shell.
- `/p/[key]/layout.tsx` loads `ProjectDetail` once; every tab uses `useCurrentProject()` from `@/features/projects/project-context` → `{ project, statuses, statusById, sectionById, labelById, capabilities }`.
- **Client components import client files by path** (`@/features/task/task-detail`), never a feature `index.ts` that also exports a server page (that would pull server code into the browser bundle).
- Add a route: create `src/app/(app)/<path>/page.tsx` + feature files, add a sidebar/palette entry if it is top-level (`src/features/shell/sidebar.tsx`, `src/features/command/command-palette.tsx`), add a builder to `src/lib/routes.ts`.

Routes: `/` · `/my-work` · `/inbox` · `/projects` · `/projects/new?template=&crmItem=&customer=&name=&space=` ·
`/p/[key]` (overview) · `/p/[key]/{board,list,table,timeline,calendar,workload,files,activity,settings}` ·
`/p/[key]/[number]` (task page) · `/goals` · `/dashboards` · `/automations` · `/templates` · `/settings` ·
`/forms/[token]` (public) · `/login` · `/no-workspace`. Any page + `?task=OPS-42` opens the task drawer.

## 3. Data model (pm schema)

Drizzle: `src/server/db/schema/*.ts` (barrel `@/server/db/schema`), SQL: `drizzle/0000_pm_init.sql`.
Tables: `spaces, projects (key, task_seq, status, health, crm_customer_id, crm_item_id, wms_ref, visibility),
project_members, statuses, sections, milestones, labels (project_id null = workspace), custom_fields,
tasks (number, position, parent_task_id, custom_fields jsonb, recurrence, generated tsvector search),
task_labels, task_dependencies (blocking → blocked), watchers, comments (markdown + mentions uuid[] + reactions),
attachments (db bytea or blob), activity (append-only, trigger-enforced), time_entries (one running timer per user),
notifications, goals, goal_key_results, goal_projects, saved_views, dashboards, automations, automation_runs,
templates, forms, form_submissions, integration_links, user_prefs, favorites, recents`. RLS enabled on all.

Conventions: uuid ids; `org_id` on every row; soft delete `deleted_at`; dates are `YYYY-MM-DD` strings; timestamps
ISO strings in DTOs; manual order = fractional rank strings (`src/lib/rank.ts`) — **always sort with
`COLLATE "C"`** in SQL or `compareRank` in JS. One `tasks.position` serves every grouping (board column, section, list).

## 4. Domain layer (`@/server/domain`, server-only)

Every function takes `ctx: DomainContext` first (`{ orgId, orgSlug, userId, userName, orgRole, actorKind }`),
checks permissions, writes in a transaction, logs activity, emits notifications and (tasks) runs automations after commit.
Errors are `DomainError(code, plainMessage, fields?)` from `@/server/errors` (`NOT_FOUND | FORBIDDEN | VALIDATION | CONFLICT | …`).

- **access**: `requireOrg(ctx, OrgAction)`, `requireProject(ctx, {id}|{key}, ProjectAction?) → {project, role, capabilities}`, `requireTask(ctx, taskId, action?)`, `visibleProjectsWhere(ctx)`, `roleForProject`.
- **projects**: `listProjects(ctx, {spaceId?, includeArchived?, status?, ids?, search?})`, `getProjectDetail(ctx, {key}|{id})`, `createProject`, `insertProject(tx, …)`, `updateProject(ctx, id, patch)`, `archiveProject(ctx, id, archived)`, `deleteProject` / `restoreProject`, `reorderProject`, `starProject`, `duplicateProject`, `listProjectMembers`, `addProjectMembers`, `updateProjectMemberRole`, `removeProjectMember`, `suggestKey`, `isProjectKeyAvailable`.
- **structure**: `createStatus/updateStatus/deleteStatus(ctx, id, moveToStatusId?)`, `createSection/updateSection/deleteSection`, `listLabels/createLabel/updateLabel/deleteLabel`, `listCustomFields/createCustomField/updateCustomField/deleteCustomField`, `createMilestone/updateMilestone/deleteMilestone`.
- **tasks**: `listProjectTasks(ctx, projectId, {includeCompleted?, includeSubtasks?})`, `listMyTasks(ctx, {scope: assigned|created|watching|all, includeCompleted?})`, `getTaskSummary`, `getTaskDetail`, `resolveTaskKey(ctx, 'OPS', 42)`, `createTask(ctx, CreateTaskInput)` (placement: `afterTaskId/beforeTaskId/at`), `createSubtask`, `updateTask(ctx, id, UpdateTaskInput)` (custom fields merge; null removes), `setTaskDone(ctx, id, done)`, `bulkUpdateTasks(ctx, ids, patch & {addLabelIds, removeLabelIds})`, `moveTask(ctx, id, {statusId?, sectionId?, parentTaskId?, afterTaskId?, beforeTaskId?, at?}) → {task, position}`, `moveTaskToProject`, `duplicateTask`, `deleteTasks(ctx, ids) → deletedIds` / `restoreTasks`, `listDeletedTasks`, `setTaskLabels`, `addTaskLabel`, `removeTaskLabel`, `addDependency` (cycle-checked), `removeDependency`, `listProjectDependencies`, `insertTask(tx, …)`.
- **task-queries**: `selectTaskSummaries(where, {limit?, orderBy?})`, `selectTaskSummary`, `selectTaskRefs`.
- **comments**: `listComments`, `addComment(ctx, {taskId, body, parentCommentId?, attachmentIds?})`, `editComment`, `deleteComment`, `restoreComment`, `toggleReaction(ctx, commentId, emoji)` (emojis: `REACTION_EMOJIS`).
- **attachments**: `uploadAttachment(ctx, {taskId?|projectId, name, contentType, bytes})`, `listTaskAttachments`, `listProjectAttachments`, `readAttachment`, `deleteAttachment`, `restoreAttachment`. Download URL: `/api/v1/attachments/<id>` (`?download=1`).
- **time**: `getRunningTimer`, `startTimer(ctx, taskId)` (stops any other), `stopTimer`, `addManualTime(ctx, {taskId, minutes, date?, note?, billable?})`, `updateTimeEntry`, `deleteTimeEntry`, `listTaskTime`, `myTimeByDay(ctx, from, to)`.
- **notifications**: `notify(tx, ctx, {recipients, kind, title, body?, url?, projectId?, taskId?, commentId?})`, `listNotifications(ctx, {filter, before})`, `unreadCount`, `markNotificationsRead(ctx, ids, read)`, `markAllNotificationsRead`, `archiveNotifications(ctx, ids, archived)`, watchers: `listWatcherIds`, `addWatchers(tx, ctx, taskId, ids)`, `setWatching`.
- **activity**: `logActivity(tx, ctx, entry|entries)`, `listProjectActivity`, `listTaskActivity`, `listMyActivity`. Verbs are listed at the top of `activity.ts`; render text with `describeActivity()` (`src/lib/activity-text.ts`).
- **goals**: `listGoals` (with rollups), `getGoal`, `listGoalsForProject`, `createGoal`, `updateGoal`, `deleteGoal`, `restoreGoal`, `addKeyResult`, `updateKeyResult`, `deleteKeyResult`, `linkGoalProject`.
- **views**: `listSavedViews(ctx, projectId|null)`, `createSavedView(ctx, {projectId, name, type, config, shared?, isDefault?})`, `updateSavedView`, `deleteSavedView`; dashboards `listDashboards/getDashboard/createDashboard/updateDashboard/deleteDashboard`.
- **automations**: `listAutomations(ctx, projectId?)`, `createAutomation/updateAutomation/deleteAutomation/restoreAutomation`, `listAutomationRuns`, `describeAutomationRule`, `runAutomationsForEvents` (called by tasks/comments). Pure engine: `src/server/automations/engine.ts` (`planAutomations`, `describeAutomation`, `MAX_AUTOMATION_DEPTH = 3`). Rule model: `src/lib/automation-types.ts`.
- **templates**: `listTemplates` (org + built-ins `builtin:<slug>`), `getTemplate`, `instantiateTemplate(ctx, id, {name, key?, spaceId?, startDate?, crmCustomerId?, includeTasks?, …})`, `instantiateTemplatePayload`, `templateFromProject`, `saveProjectAsTemplate`, `createTemplate/updateTemplate/deleteTemplate`. Built-ins: `templates-builtin.ts`. Payload: `src/lib/template-types.ts`.
- **forms**: `listForms`, `getForm`, `createForm/updateForm(…, {regenerateLink})/deleteForm`, `listFormSubmissions`, public `getPublicForm(token, viewerOrgIds)`, `submitForm({token, answers, submitterName?, submitterEmail?, viewer?})`. Field model: `src/lib/form-types.ts`.
- **links**: `listLinks(ctx, {taskId}|{projectId})`, `addLink(ctx, {taskId?|projectId?, targetType, targetId})` (resolves + caches title/status/url), `removeLink`, `refreshLinks`, `findLinkedWork(ctx, type, id)`, `countLinkedWork(ctx, type, ids)`.
- **people / prefs / spaces / search**: `listOrgPeople`, `getPeople`, `isOrgMember`, `filterOrgMembers`; `getUserPrefs`, `updateUserPrefs` (shallow merge; `notifications` toggles per kind), `listFavorites`, `setFavorite`, `recordVisit`, `listRecents`; `listSpaces/createSpace/updateSpace/deleteSpace`; `search(ctx, q)`.

Rules: always log activity in the same transaction as the write; never notify the actor; automation-run writes use
`actorKind: 'automation'`. Rich text (descriptions) is HTML sanitized on write by `sanitizeRichText` — render with
`<div className="ks-prose" dangerouslySetInnerHTML=…>`. Comments are markdown with mention tokens `@[Name](user:<uuid>)` (`src/lib/mentions.ts`).

## 5. Server actions (`@/server/actions/<file>`, `'use server'`)

All return `ActionResult<T> = {ok:true,data} | {ok:false,error:{code,message,fields?}}`, are zod-validated,
permission-checked by the domain, and `revalidatePath('/', 'layout')` on success (except chatty ones).
Call from clients with `useServerAction(action, {invalidate, successMessage, onSuccess})` (`src/lib/hooks/use-action.ts`)
or `unwrap()` inside React Query mutations. Task edits should use `useTaskMutations()` (optimistic, rollback, undo toasts).

- `tasks`: `createTaskAction`, `createSubtaskAction`, `updateTaskAction({taskId, patch})`, `setTaskDoneAction`, `bulkUpdateTasksAction`, `moveTaskAction`, `moveTaskToProjectAction`, `duplicateTaskAction`, `deleteTasksAction` / `restoreTasksAction`, `setTaskLabelsAction`, `toggleTaskLabelAction`, `addDependencyAction`, `removeDependencyAction`, `setWatchingAction`.
- `comments`: `addCommentAction`, `editCommentAction`, `deleteCommentAction`, `restoreCommentAction`, `toggleReactionAction`.
- `attachments`: `uploadAttachmentAction(formData: file + taskId|projectId)`, `deleteAttachmentAction`, `restoreAttachmentAction`.
- `time`: `startTimerAction`, `stopTimerAction`, `addManualTimeAction`, `updateTimeEntryAction`, `deleteTimeEntryAction`.
- `projects`: `createProjectAction` (blank or `templateId`), `updateProjectAction`, `archiveProjectAction`, `deleteProjectAction`, `restoreProjectAction`, `duplicateProjectAction`, `starProjectAction`, `reorderProjectAction`, `addProjectMembersAction`, `updateProjectMemberRoleAction`, `removeProjectMemberAction`, `saveProjectAsTemplateAction`, `suggestProjectKeyAction`.
- `structure`: `create/update/delete` × `Status|Section|Label|CustomField|Milestone` + `Action`.
- `spaces`, `notifications` (`markNotificationsReadAction`, `markAllNotificationsReadAction`, `archiveNotificationsAction`), `prefs` (`updatePrefsAction`, `setFavoriteAction`, `recordVisitAction`), `goals` (goal + key result + `linkGoalProjectAction`), `views` (saved views + dashboards), `automations` (+ `describeAutomationAction` live preview), `templates`, `forms` (+ public `submitFormAction`, rate limited, honeypot `website`), `links` (`addLinkAction`, `removeLinkAction`, `refreshLinksAction`).

## 6. JSON API (`/api/v1`, envelope `{data}` | `{error}`)

Auth = shared session cookie, active org only; writes require same-origin or a trusted sibling origin (CSRF guard).
Hooks for each in `src/lib/hooks/use-data.ts`; keys in `src/lib/query-keys.ts` (`qk.project(key)` prefix-invalidates all tabs).

`me` · `people` · `spaces` · `projects?space&archived&q` · `projects/[key]` (key or id) and `/tasks?completed&subtasks`, `/activity?before&verbs`, `/files`, `/views`, `/dependencies`, `/links`, `/automations`, `/forms`, `/goals`, `/trash` ·
`tasks/[id]` (uuid or `OPS-42`) and `/comments`, `/activity`, `/time`, `/attachments` · `my-tasks?scope&completed` ·
`notifications?filter&before` · `notifications/unread` · `search?q` · `goals` · `automations?projectId` · `automations/[id]/runs` ·
`templates` · `dashboards?projectId` · `forms?projectId` · `forms/[id]/submissions` · `labels?projectId` · `custom-fields?projectId` ·
`recents` · `time/running` · `integrations/status` · `integrations/search?type&q` · `attachments/[id]` (file).

**Cross-app (CORS with credentials for Portal/CRM/WMS origins):**
- `GET /api/v1/links?type=crm_item&id=<id>` → `{target, projects: ProjectSummary[], tasks: TaskSummary[]}`; `?ids=a,b,c` → `{counts: {[id]: {tasks, projects}}}`.
- `POST /api/v1/tasks` body `{project: key|id, title, description?, statusId?, priority?, assigneeId?, dueDate?, startDate?, labelIds?, link?: {targetType, targetId}}` → `{task, link, url}`.
- `GET /api/v1/notifications/unread` → `{count}`.
- Deep link to create a project from a deal: `/projects/new?template=builtin:client-onboarding&crmItem=<id>&customer=<coreCustomerId>&name=<text>`.

## 7. Integrations (`src/server/integrations`)

`integrationAvailability(ctx) → {crm, wms}` (entitlement + table detection; WMS only for org `WMS_PLATFORM_ORG_SLUG`,
default `kitstak`, because WMS tables are not org-scoped). `searchTargets(ctx, type, q)`, `resolveTargets(ctx, type, ids)`,
`availableTargetTypes(ctx)`. CRM: `searchCrmItems`, `getCrmItems`, `crmItemUrl` (reads `crm.items/boards/columns`; stage label from the
`stage|status|health` column). WMS: `searchWms`, `getWmsRecords`, `wmsUrl` for `wms_order` (shipment_orders → `/orders/<id>`),
`wms_work_order` (`/work-orders/<id>`), `wms_receipt` (purchase_orders → `/receiving/<id>`), `wms_count` (count_plans → `/counts/<id>`).
Customers: `searchCustomers`, `getCustomers` (`core.customers`). Everything fails soft (returns empty) — never crash a page.

## 8. UI building blocks

- `@/components/ui` (CRM design system): Button, IconButton, Input, Textarea, SearchInput, Field, Select, Combobox, Checkbox, Switch, Tooltip, Popover, DropdownMenu (use `onSelect`, not `asChild`, for links), ContextMenu, Dialog (+ WizardSteps, ConfirmDialog), Drawer/Sheet, Tabs, ToggleGroup, Avatar/AvatarGroup, Badge/CountBadge/Chip/StatusPill, `toast` (`toast.undo(msg, {onUndo})`), EmptyState + Illustration, Skeleton, ProgressBar, Kbd, ScrollArea, ColorPicker, DatePicker, **IsoDatePicker** (YYYY-MM-DD), **UserPicker** (single/multi), Breadcrumbs, Card, Table, PageHeader, Spinner, label colors (`labelColorStyle`, `LABEL_COLORS`).
- `@/components/pm`: StatusIcon, PriorityIcon, EntityIcon (+ `ENTITY_ICON_NAMES` picker list), LabelPill, DueDate, PersonAvatar (by user id), TaskRow (cross-project row), TaskCard (board card), BrandLoader.
- `@/components/layout/page`: `Page` (header + body; `width="default|narrow|full"`), `Panel`.
- Shell API: `useShell()` (user, org, orgRole, orgs, appUrls, modules, integrations, `can(orgAction)`); `useShellStore.getState().openQuickAdd({projectId, statusId, sectionId, assigneeId, dueDate, parentTaskId, text})`, `.openPalette(query?)`, `.openShortcuts()`; `useTaskDrawer()` → `{taskKey, openTask(key), closeTask()}` (`src/lib/hooks/use-task-drawer.ts`); `useHotkey(combo, fn, opts)`.
- Pure helpers in `src/lib`: `dates.ts`, `rank.ts`, `task-filters.ts` (applyFilters/sortTasks/groupTasks over the `view-config.ts` model), `rollups.ts`, `task-key.ts`, `mentions.ts`, `routes.ts`, `permissions.ts`, `activity-text.ts`, `constants.ts` (enums + friendly labels).
- Brand: Projects mark `ProjectsMark` (`@/features/shell/logo`), loader `/brand/kitstak-loader-projects.svg`.

## 9. Dev, test and screenshots

- Dev server per person: `NEXT_DIST_DIR=.next/<name> pnpm --filter kitstak-projects exec next dev -p <3401-3420>` (dist dirs must be inside `.next/`; `.next-<name>` is remapped). Trusted origins include localhost:3400-3420 in dev.
- Don't run `pnpm build` while dev servers are up (it rewrites `next-env.d.ts`); restart a dev server that starts reload-looping.
- Screenshots: `node scripts/shot.mjs --base http://localhost:3405 [--theme dark] [--width 390] [--user … --password …] /p/OPS/board`.
- Seeds run through the domain layer: `tsx --conditions=react-server` (see `package.json` `db:seed`), helpers in `src/server/db/seed/context.ts` (`seedContext(orgSlug, email)`, `orgMembers`).
- Unit tests: `src/**/*.test.ts` (Vitest, `server-only` stubbed).

## 10. View building blocks (`src/features/views`, owner views-a; reuse them, import by path)

- `useViewState(type)` (`use-view-state.ts`): filter bar + layout state for a project view. The URL is the source of truth
  (`?view=<savedViewId|all>&q&mine=1&assignee=me,none,<id>&status&priority&label=<id|none>&due=overdue|today|this_week|next_7_days|no_date&group&gfield&lane&sort=field:dir,custom.<id>:dir&done=hide&subtasks=1`),
  written with `history.replaceState(null, …)` (no reload, the `?task=` drawer param is kept). The last state per project + view
  is restored when the URL is bare. Returns `{quick, settings, visible(tasks), setQuick, setSettings, setColumns, views, activeView,
  dirty, saveAs, saveChanges, renameView, setDefaultView, deleteView, reset, clearFilters}`. Pure model + URL codec: `view-state.ts`
  (types `ManagedViewType = board|list|table`; extend that union to reuse it for timeline/calendar/workload).
- `<ViewToolbar view tasks shownCount totalCount controls={({iconOnly}) => …} controlsWidth>`: the 48px filter bar (saved views
  menu, search with Cmd/Ctrl+F, My tasks, Assignee/Status/Priority/Labels/Due, Save/Reset). `<DisplayMenu choices toggles>` for layout.
- Inline editors (`field-pickers.tsx`): `StatusPicker`, `PriorityPicker`, `AssigneePicker`, `DuePicker`, `LabelsPicker` (creates labels),
  each wraps a trigger element; `LazyPicker` mounts them on first use. `OptionList` (cmdk checklist).
- `useTaskOps()` = `useTaskMutations()` + `setLabels`, `applyMove(task, groupMove, neighbours?)` (one optimistic patch for
  status/section/lane field/labels/rank), `duplicate`, `copyLink`, `moveToProject`. `useGroupMeta(field, tasks, fieldId?)` gives group
  order, titles/icons, the move patch and create defaults for status/priority/section/assignee/label/custom-select groupings.
- `TaskMenuItems` (task right-click / "…" menu), `BulkBar` + `useSelection`, `LinkChips` + `useTaskLinksMap(projectKey)`.
- Data: `GET /api/v1/projects/[key]/task-links` → every task-level CRM/WMS link in the project (`useProjectTaskLinks`,
  `qk.projectTaskLinks`, domain `listProjectTaskLinks`). `ViewConfig.swimlane` now also accepts `'label'`.

## 11. Task detail (`src/features/task`, owner task; import client files by path)

- Open a task from anywhere: `useTaskDrawer().open(keyOrUuid)` (alias of `openTask`; `close()` = `closeTask`), or link with
  `?task=OPS-42` on any page. The shell mounts `<TaskDrawerHost />` (also exported as `TaskDrawerProvider`). Full page:
  `routes.task(key, n)` → `/p/OPS/42` (deep link to a comment: `#comment-<id>`).
- The drawer is non-modal (like CRM's item card): the page behind stays usable; clicking any element with
  `data-task-key="OPS-7"` swaps the drawer to that task instead of closing it; other outside clicks close it. Clicks inside
  Radix poppers, dialogs, toasts or any element marked `data-task-keep-open` never close it.
- ↑/↓ and j/k in the drawer walk the tasks **in the order the page renders `[data-task-key]` elements** (keep that attribute on
  every card/row you render; the drawer itself is marked `data-task-panel` and ignored). No list on the page → the project's
  top-level tasks by status, then rank. The full page uses j/k.
- `<TaskDetailView taskRef variant="drawer|page" initialData? onClose? onOpenTask? onDeleted?>` renders everything (title,
  properties incl. custom fields, autosaving description, subtasks, dependencies, CRM/WMS links, files, time, comments +
  history). Description is sanitized HTML from Tiptap (StarterKit headings/lists/code/quote/link + task lists), autosaved
  ~1s after typing, on blur, on ⌘S and when the drawer closes. Comments are markdown (`markdown.ts` / `MarkdownView`).
- Reusable: `TaskPickerList` (task search, this project first then everything), `MarkdownView`, `CommentComposer`
  (markdown + @mentions), `LocalTime` (hydration-safe relative time), `useTaskUploads(task)`.

## 12. Nav building blocks (owner nav; import by path)

- **Natural-language quick add**: `parseQuickAdd(text, {today, people, projects, labels, meId, ignore})` in `src/lib/nl-parse.ts`
  → `{title, dueDate, priority, assigneeId, projectId, labelIds, newLabels, tokens}` (dates: today/tomorrow/fri/next fri/in 3 days/
  dec 5/12/5/eow/eom…, `!high` `!p1` `!!!`, `@name`/`@me`, `#label`, `+KEY`). Open quick add prefilled with
  `useShellStore.getState().openQuickAdd({ text: 'Call Acme tomorrow !high', projectId, … })`.
- **Search page** `/search?q&type=all|tasks|comments|projects|people|goals&project=<id>&status=open|done&assignee=me|none|<id>`
  (`routes.search(q, type)`); with no `q` but an assignee/project it lists those tasks. API `GET /api/v1/search/full` (same params,
  returns `FullSearchResults`), domain `searchFull(ctx, q, options)`.
- **Inbox**: filters `all|unread|mentions|assigned|comments|due|archived` (API + domain `InboxFilter`). Due-today/overdue reminders
  (`due_soon`/`overdue`) are created lazily by `ensureDueReminders(ctx)` (called from `unreadCount`, throttled 10 min per person).
  Optimistic inbox actions: `useInboxActions()` (`src/features/inbox/use-inbox-actions.ts`); `<NotificationAvatar item>`.
  `qk.unread()` is now `['notifications','unread-count']` (it collided with the unread-filter list key).
- **My work** keeps its layout in the URL: `/my-work?scope=created|watching&group=project&sort=priority|project|updated|title&done=1&project=<id>`.
  `useCompleteTask()` (`src/features/my-work/use-complete-task.ts`) = optimistic done/reopen with Undo for cross-project lists.
- **Home** reads `prefs.home.gettingStartedDismissed`; `/?tour=1` (Help → Getting started) always shows the checklist.
- **Shortcuts**: `g` then `h m i s p g d a t` (home, my work, inbox, search, projects, goals, dashboards, automations, templates).

## 13. Portfolio (projects directory, wizard, overview/settings/files/activity, goals, dashboards; owner portfolio)

- **Status updates** (project health posts with history): `postProjectUpdate(ctx, projectId, {health, note?, status?})` /
  `postProjectUpdateAction`, history `listProjectUpdates` → `GET /api/v1/projects/[key]/updates` (`useProjectUpdates`,
  `qk.projectUpdates(key)`). Stored as append-only activity verb `project.update_posted` (after `{health, note, status}`,
  meta `{progress}`); also sets `projects.health` + `health_note` (first line of the note). No new table/migration.
- **Goal check-ins**: `checkInGoal(ctx, goalId, {health, note?, keyResults?: [{id, currentValue}], manualProgress?})` /
  `checkInGoalAction` → `{goal, checkIn}`; history `listGoalCheckIns` → `GET /api/v1/goals/[id]/check-ins`
  (`useGoalCheckIns`, `qk.goalCheckIns(id)`). Activity verb `goal.checked_in` (entityType `goal`).
- **Reports**: `getProjectReport(ctx, {key}|{id}, {weeks})`, `getPortfolioReport(ctx, {weeks, spaceId})` →
  `GET /api/v1/reports?project=KEY|&space=&weeks=4..26` (`useReport`, `qk.report(scope)`), DTO `ReportDTO`
  (`src/lib/types.ts`). Pure math + tests in `src/lib/report-math.ts` (burn-up/down, velocity, cycle time, workload,
  status distribution). Per-project reports page: `/dashboards?project=KEY` (linked from Overview + card menus).
- **Reusable UI** (import by path): `@/features/dashboards/charts` (`ProgressRing`, `DonutChart`, `LineChart`,
  `ColumnChart`, `StackedBars`, `ChartLegend`; SVG, token colors, keyboard + sr-only tables),
  `@/features/dashboards/report-panels` (KPI tiles and report panels taking a `ReportDTO`),
  `@/features/projects/health` (`HealthBadge`, `HealthIcon`), `@/features/projects/record-picker` (`RecordPicker` live
  search for any integration target type + `TARGET_ICONS`), `@/features/projects/appearance-picker` (color + icon).
- Activity text: `describeActivity` now covers `project.update_posted`, `goal.checked_in`, `status|section|label|field|
  milestone.*` and project field changes in plain language. `withoutUpdateEchoes(items)` (project-activity.tsx) hides
  the health/note field rows that a status update writes alongside its post.
- Wizard creates CRM/customer `integration_links` (project-level) after `createProjectAction`, so the Overview's
  "Linked records" and the siblings' linked-work panels see them. Prefill: `?template&crmItem&customer&name&space`.

## 14. Studio (automations, templates, forms, settings, onboarding; owner studio)

- **Automations model** (`src/lib/automation-types.ts`, additive): new triggers `due_date_approaching {days}`, `task_overdue`,
  `crm_stage_changed {toStage?}` (case-insensitive stage name), `wms_order_shipped`; condition field `project`; actions
  `move_to_project {projectId}` and `create_follow_up {title, dueInDays?, assignTo?: assignee|reporter|user|none, userId?, projectId?}`.
  Messages/comments/follow-up titles accept `{task} {project} {stage} {record}`. `SCHEDULED_TRIGGER_TYPES`, `WMS_SHIPPED_STATUSES`.
- **Engine/executor**: `TaskEvent` gained `due_soon | overdue | crm_stage_changed | wms_order_shipped` + `daysUntilDue`, `stage`,
  `previousStage`, `targetTitle`, `dedupeKey` (a rule runs once per task+key; stored in `automation_runs.detail.dedupe`).
  `DomainContext.automationChain` (optional): a rule never re-triggers itself (no "subtask created → add subtask" loops).
  Form submissions now run `task_created` automations.
- **Scheduled sweep** (`src/server/domain/automation-sweep.ts`): `sweepAutomations(ctx, {force})` (throttled 5 min/org) runs due-date
  and CRM/WMS triggers; `scheduleAutomationSweep(ctx)` runs it via `after()` and is called from `unreadCount` and the Automations page;
  `runLinkStatusAutomations(ctx, changes)` is called by `refreshLinks` when a linked record's cached status changes.
  Action `runScheduledAutomationsAction()` ("Check now").
- **Run history**: `listRecentAutomationRuns(ctx, {automationId?, status?, limit?})` → `GET /api/v1/automations/runs`
  (`AutomationRunRowDTO`, key `qk.automationRunHistory(id, status)`).
- **Deep links**: `/automations?tab=recipes|history&project=<id>&new=1&edit=<ruleId>`; `/templates?category=&preview=<id>&save=<projectId|1>`;
  `/forms?project=<id>&form=<id>&tab=questions|settings|share|responses&new=1` (`routes.forms(projectId?)`, `routes.form(id, tab?)`);
  `/settings?section=profile|appearance|workspace|integrations|shortcuts`. Sidebar + palette have a **Forms** entry.
- **Templates**: built-in `builtin:sales-handoff` (Sales deal handoff, CRM). `restoreTemplate` / `restoreTemplateAction` (undo delete).
  Reusable `<SaveAsTemplateDialog open onOpenChange projects defaultProjectId?>` (`@/features/templates/save-as-template-dialog`).
- **Forms**: `restoreForm` / `restoreFormAction`; `listFormSubmissions` rows now include `taskKey`, `taskTitle` (`FormSubmissionDTO`).
  Public form has a honeypot. `FormFieldControl` exported from `@/features/forms/public-form`.
- **Onboarding**: `OnboardingHost` is mounted in `app-shell.tsx` (welcome dialog once per person + 4-step spotlight tour, state in
  `prefs.onboarding {welcomeSeen, tourSeen, tourStep}` via `updateOnboardingAction`). Replay: Help → "Take the tour" or
  `useOnboardingStore.getState().startTour()`. Empty states: `<SampleProjectButton />` (`@/features/onboarding/sample-project-button`,
  calls `createSampleProjectAction` → `createSampleProject(ctx)`: Product launch template, first 4 dated tasks assigned to you).
- **Settings**: `integrationLinkSummary(ctx)` (link counts per target type) for the Integrations page; profile name uses
  `authClient.updateUser`, password `authClient.changePassword`.

## 15. Integrations (CRM / WMS / Portal bundle; owner integrations)

- **`@kitstak/pm-bridge`** (`packages/pm-bridge`): how CRM and WMS talk to Projects through the shared database, over the host
  app's own Drizzle executor (node-postgres, postgres-js, PGlite or a transaction). Mirrors Projects' permission rules
  (`permissions.ts`, keep in lockstep with `src/lib/permissions.ts`), task numbering, `COLLATE "C"` ranks, activity, watchers and
  `assigned` notifications. Reads fail soft (empty) when the pm schema is missing; writes throw `BridgeError(code, plainMessage, fields?)`.
  - Reads: `listLinkedWork(db, {orgId,userId}, targets[], {projectsUrl})` → `{projects (progress, health, owner, linkId), tasks (status,
    assignee, due, overdue, linkId, url), openTasks}` (projects also match `crm_item_id` / `crm_customer_id`), `countLinkedWork`,
    `listWritableProjects` (editor+ projects with statuses, recent first), `listOrgPeople`.
  - Writes: `createTaskFromExternal(db, actor, {projectId, title, description?, statusId?, priority?, assigneeId?, dueDate?, link, source})`,
    `linkProjectToRecord`, `removeLink`. Tested against the real DB in `src/bridge.db.test.ts` (rolled back).
  - Events: `emitRecordStatusChange(db, {orgId, source, target, status, previousStatus?, title?, url?, actorId?})` refreshes the cached
    status on every link to the record and, when tasks are linked and the status really changed, queues a `record_status_changed`
    row. Runs in a SAVEPOINT and never throws, so it's safe inside a CRM/WMS write transaction.
- **`pm.integration_events`** (`drizzle/0001_integration_events.sql`, Drizzle `integrationEvents`): the cross-app inbox
  (`record_status_changed`, `task_created`). Projects drains it in `src/server/integrations/events.ts`: `drainIntegrationEvents(ctx)`
  → `runLinkStatusAutomations` (crm_stage_changed / wms_order_shipped rules) + an `integration` inbox note to assignees of open linked
  tasks, and `task_created` automations for tasks made in CRM/WMS. Scheduled lazily from `unreadCount` (`scheduleIntegrationEvents`,
  15 s throttle per org) and by Vercel Cron `GET /api/v1/integrations/events` (`Authorization: Bearer $CRON_SECRET`, `apps/projects/vercel.json`). The same cron also runs `sweepAutomations(ctx, { force: true })` for every org with an enabled scheduled rule (`orgsWithScheduledAutomations()`), so due-soon/overdue/CRM-stage/WMS-shipped rules fire without anyone signed in.
  Rows are claimed by setting `processed_at` first (no double runs), retried up to 5 times, deleted 30 days after processing.
- **Emitters**: CRM `dispatchItemEvents` → `notifyProjectsOfStageChange` for status-type `stage|status|health` columns
  (`apps/crm/src/server/services/projects-bridge.ts`); WMS `recordUpdate` (change log) → `notifyProjectsOfStatusChange` for
  shipment orders, work orders, purchase orders (receipts) and count plans (`apps/wms/src/server/projects/bridge.ts`).
- **CRM item panel → "Projects" tab** (`apps/crm/src/features/item-panel/projects/*`, tab key `projects` in `PANEL_TABS`, so
  `?itemTab=projects` deep-links): linked projects (health, progress, due, owner) and tasks (live status, assignee, due), Create task
  (dialog: project, status, priority, assignee, due, notes), Start a project (Projects wizard prefilled `template=builtin:client-onboarding&crmItem&customer&name`),
  Link a project, Unlink. Only shown when the org has Projects and the pm schema exists. API: `GET|POST /api/v1/crm/items/:id/projects`,
  `POST /api/v1/crm/items/:id/projects/links`, `DELETE /api/v1/crm/items/:id/projects/links/:linkId`, `GET /api/v1/crm/projects/options`.
  Accounts also show work linked to their WMS customer (`crm.customer_links`).
- **WMS "Project tasks" card** (`apps/wms/src/components/projects/project-tasks-card.tsx`) on shipment order (rail) and work order
  (aside) pages: linked tasks + projects, Create task, Unlink. API: `GET|POST /api/orders/:id/project-tasks`,
  `GET|POST /api/work-orders/:id/project-tasks`, `DELETE …/project-tasks/:linkId`, `GET /api/project-tasks/options` (order or
  work-order view permission; acts for the platform org; hidden for users who aren't members of it).
- **Projects-side UI** (`src/features/integrations`, client components, import by path or the index):
  `RecordChip` (brand mark + title + status coloured by meaning, opens the record), `RecordStatus`, `SiblingAppMark`,
  `LinkRecordDialog({open, onOpenChange, owner: {taskId}|{projectId}, existing?, initialType?, onLinked?})` (kind chips for every
  connected record type + live search), `LinkedRecordsList({owner, links, canEdit, invalidate?, variant: 'rows'|'chips'})` (re-reads
  stale statuses once on mount), pure `statusTone(status)` / `TONE_COLOR` / `targetApp(type)` (tested).
- **Readers**: core customers follow the CRM rule: an org with no customers of its own also sees the platform registry
  (`registryOrgIds`). CRM board `kind` is an enum: compare with `b.kind::text`. Pass arrays to raw SQL with `sql.param(array)::type[]`.
- **App switcher** (`@kitstak/ui/app-switcher`): rows render the brand-pack marks inline (portal/crm/wms/projects). Every app passes
  `urls.projects` (`NEXT_PUBLIC_PROJECTS_URL`, default `http://localhost:3400`) and `entitled.projects`.
- **Portal**: Projects launcher tile (open tasks, due in 7 days, at risk; `to_regclass` guarded), app marks on tiles and billing rows,
  quick links New project / My work, palette entries Open Projects / My work, setup steps `projects_first_project`,
  `projects_assign_task`, `projects_connect` (detected from pm data; sample project excluded).
- **Deploy**: 4th Vercel project `projects` (Root Directory `apps/projects`); `deploy/push-env.mjs` needs `URL_PROJECTS` +
  `PROJECT_PROJECTS` in `deploy/secrets.env` (optional `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `WMS_PLATFORM_ORG_SLUG`). See docs/DEPLOYMENT.md.

## 16. Integrator notes

- `TASKS_DELETED_EVENT` (`@/lib/hooks/use-task-mutations`): `useTaskMutations().deleteTasks` fires it on `window` with `{ ids }` before deleting. An open task drawer or task page showing one of those tasks closes itself (page: goes to the project) instead of reloading a task that is gone. Any new delete path should go through `deleteTasks`.
- Page titles: the project layout sets `Project name · KitStak Projects` and a template, so tab pages only export `metadata = { title: 'Board' }` ("Board · Project · KitStak Projects"). The full task page title is `OPS-42 Task title · Project · KitStak Projects`.
- `formatRelative` counts calendar days (local) past the first 6 hours, so "yesterday" always agrees with day headings.
