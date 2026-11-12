'use client';
import type { ComponentType } from 'react';
import type { ViewType } from '@/server/services/contracts/dto';
import { CalendarView } from './calendar/calendar-view';
import { ChartView } from './chart/chart-view';
import { FilesView } from './files/files-view';
import { FormView } from './form/form-view';
import { KanbanView } from './kanban/kanban-view';
import { TimelineView } from './timeline/timeline-view';
import type { BoardViewProps } from './types';

const COMPONENTS: Partial<Record<ViewType, ComponentType<BoardViewProps>>> = {
  kanban: KanbanView,
  calendar: CalendarView,
  timeline: TimelineView,
  chart: ChartView,
  form: FormView,
  files: FilesView,
};

export function hasBoardViewComponent(type: ViewType): boolean {
  return type in COMPONENTS;
}

/** Renders the component for `view.type`; `null` for types owned elsewhere (table, dashboard). */
export function BoardView(props: BoardViewProps) {
  const Component = COMPONENTS[props.view.type];
  return Component ? <Component key={props.view.id} {...props} /> : null;
}
