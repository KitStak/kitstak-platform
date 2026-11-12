/** Drizzle relational-query definitions for domain tables (auth relations live in auth.ts). */
import { relations } from 'drizzle-orm';
import { user } from './auth';
import { folders, workspaceMembers, workspaces } from './workspaces';
import { boardMembers, boards, columns, groups, itemLinks, items, views } from './boards';
import { activityLog, files, notifications, updateReactions, updateReads, updates } from './collaboration';
import { dashboardWidgets, dashboards } from './dashboards';
import { automationRuns, automations } from './automations';

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  folders: many(folders),
  boards: many(boards),
  members: many(workspaceMembers),
  dashboards: many(dashboards),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
  user: one(user, { fields: [workspaceMembers.userId], references: [user.id] }),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [folders.workspaceId], references: [workspaces.id] }),
  parent: one(folders, { fields: [folders.parentId], references: [folders.id], relationName: 'folder_tree' }),
  children: many(folders, { relationName: 'folder_tree' }),
  boards: many(boards),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [boards.workspaceId], references: [workspaces.id] }),
  folder: one(folders, { fields: [boards.folderId], references: [folders.id] }),
  members: many(boardMembers),
  columns: many(columns),
  groups: many(groups),
  items: many(items),
  views: many(views),
  automations: many(automations),
}));

export const boardMembersRelations = relations(boardMembers, ({ one }) => ({
  board: one(boards, { fields: [boardMembers.boardId], references: [boards.id] }),
  user: one(user, { fields: [boardMembers.userId], references: [user.id] }),
}));

export const columnsRelations = relations(columns, ({ one }) => ({
  board: one(boards, { fields: [columns.boardId], references: [boards.id] }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  board: one(boards, { fields: [groups.boardId], references: [boards.id] }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  board: one(boards, { fields: [items.boardId], references: [boards.id] }),
  group: one(groups, { fields: [items.groupId], references: [groups.id] }),
  parent: one(items, { fields: [items.parentItemId], references: [items.id], relationName: 'subitems' }),
  subitems: many(items, { relationName: 'subitems' }),
  creator: one(user, { fields: [items.createdBy], references: [user.id] }),
  updates: many(updates),
  files: many(files),
  outgoingLinks: many(itemLinks, { relationName: 'link_from' }),
  incomingLinks: many(itemLinks, { relationName: 'link_to' }),
}));

export const itemLinksRelations = relations(itemLinks, ({ one }) => ({
  from: one(items, { fields: [itemLinks.fromItemId], references: [items.id], relationName: 'link_from' }),
  to: one(items, { fields: [itemLinks.toItemId], references: [items.id], relationName: 'link_to' }),
}));

export const viewsRelations = relations(views, ({ one }) => ({
  board: one(boards, { fields: [views.boardId], references: [boards.id] }),
}));

export const updatesRelations = relations(updates, ({ one, many }) => ({
  item: one(items, { fields: [updates.itemId], references: [items.id] }),
  author: one(user, { fields: [updates.authorId], references: [user.id] }),
  parent: one(updates, {
    fields: [updates.parentUpdateId],
    references: [updates.id],
    relationName: 'replies',
  }),
  replies: many(updates, { relationName: 'replies' }),
  reactions: many(updateReactions),
  reads: many(updateReads),
  files: many(files),
}));

export const updateReactionsRelations = relations(updateReactions, ({ one }) => ({
  update: one(updates, { fields: [updateReactions.updateId], references: [updates.id] }),
  user: one(user, { fields: [updateReactions.userId], references: [user.id] }),
}));

export const updateReadsRelations = relations(updateReads, ({ one }) => ({
  update: one(updates, { fields: [updateReads.updateId], references: [updates.id] }),
  user: one(user, { fields: [updateReads.userId], references: [user.id] }),
}));

export const filesRelations = relations(files, ({ one }) => ({
  item: one(items, { fields: [files.itemId], references: [items.id] }),
  update: one(updates, { fields: [files.updateId], references: [updates.id] }),
  uploader: one(user, { fields: [files.uploadedBy], references: [user.id] }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  item: one(items, { fields: [activityLog.itemId], references: [items.id] }),
  board: one(boards, { fields: [activityLog.boardId], references: [boards.id] }),
  actor: one(user, { fields: [activityLog.actorId], references: [user.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, { fields: [notifications.userId], references: [user.id], relationName: 'recipient' }),
  actor: one(user, { fields: [notifications.actorId], references: [user.id], relationName: 'actor' }),
  item: one(items, { fields: [notifications.itemId], references: [items.id] }),
  board: one(boards, { fields: [notifications.boardId], references: [boards.id] }),
}));

export const dashboardsRelations = relations(dashboards, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [dashboards.workspaceId], references: [workspaces.id] }),
  widgets: many(dashboardWidgets),
}));

export const dashboardWidgetsRelations = relations(dashboardWidgets, ({ one }) => ({
  dashboard: one(dashboards, { fields: [dashboardWidgets.dashboardId], references: [dashboards.id] }),
}));

export const automationsRelations = relations(automations, ({ one, many }) => ({
  board: one(boards, { fields: [automations.boardId], references: [boards.id] }),
  runs: many(automationRuns),
}));

export const automationRunsRelations = relations(automationRuns, ({ one }) => ({
  automation: one(automations, { fields: [automationRuns.automationId], references: [automations.id] }),
}));
