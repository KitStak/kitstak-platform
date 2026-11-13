'use client';
/**
 * Commands for the tasks selected in a view (List, Table), shown at the top of the ⌘/Ctrl+K
 * palette as "3 selected tasks": set status, priority, assignee, due date, delete. The view that
 * owns the selection registers them while something is selected:
 *
 *   useRegisterSelectionCommands(selection.count ? `${n} selected tasks` : null, commands);
 */
import { useEffect } from 'react';
import { create } from 'zustand';

export interface SelectionCommand {
  readonly id: string;
  readonly label: string;
  readonly keywords?: readonly string[];
  readonly run: () => void;
  readonly danger?: boolean;
}

interface SelectionCommandsState {
  readonly heading: string | null;
  readonly commands: readonly SelectionCommand[];
}

export const useSelectionCommands = create<SelectionCommandsState>(() => ({ heading: null, commands: [] }));

export function useRegisterSelectionCommands(heading: string | null, commands: readonly SelectionCommand[]): void {
  useEffect(() => {
    if (!heading) return undefined;
    useSelectionCommands.setState({ heading, commands });
    return () => {
      if (useSelectionCommands.getState().commands === commands) useSelectionCommands.setState({ heading: null, commands: [] });
    };
  }, [heading, commands]);
}
