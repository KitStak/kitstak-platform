'use client';

/** Renders whichever board-level dialog is open (share, duplicate, move, settings). */
import type { BoardDto, ColumnDto, UserSummaryDto, ViewDto } from '@/server/services/contracts/dto';
import type { BoardCommands } from '../hooks/use-board-commands';
import { BoardSettingsDialog, DuplicateBoardDialog, MoveBoardDialog } from './board-dialogs';
import { ShareDialog } from './share-dialog';

export type BoardDialog = 'share' | 'duplicate' | 'move' | 'settings';

export interface BoardDialogsHostProps {
  readonly dialog: BoardDialog | null;
  readonly onClose: () => void;
  readonly board: BoardDto;
  readonly users: readonly UserSummaryDto[];
  readonly commands: BoardCommands;
  readonly views: readonly ViewDto[];
  readonly columns: readonly ColumnDto[];
  readonly onSetDefaultView: (viewId: string) => void;
}

export function BoardDialogsHost({ dialog, onClose, board, users, commands, views, columns, onSetDefaultView }: BoardDialogsHostProps) {
  const openChange = (name: BoardDialog) => (open: boolean) => {
    if (!open && dialog === name) onClose();
  };
  return (
    <>
      <ShareDialog open={dialog === 'share'} onOpenChange={openChange('share')} board={board} users={users} />
      <DuplicateBoardDialog open={dialog === 'duplicate'} onOpenChange={openChange('duplicate')} board={board} commands={commands} />
      <MoveBoardDialog open={dialog === 'move'} onOpenChange={openChange('move')} board={board} commands={commands} />
      <BoardSettingsDialog
        open={dialog === 'settings'}
        onOpenChange={openChange('settings')}
        board={board}
        commands={commands}
        views={views}
        columns={columns}
        onSetDefaultView={onSetDefaultView}
      />
    </>
  );
}
