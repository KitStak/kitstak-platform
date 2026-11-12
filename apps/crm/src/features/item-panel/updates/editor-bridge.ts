/**
 * Bridge between Tiptap's long-lived plugin callbacks and React: holds the latest props
 * (synced in an effect) and the @mention popup state as a tiny external store.
 */
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { UserSummaryDto } from '@/server/services/contracts/dto';

export interface MentionView {
  readonly items: readonly UserSummaryDto[];
  readonly rect: DOMRect | null;
  readonly index: number;
  readonly command: (user: UserSummaryDto) => void;
}

export interface EditorHandlers {
  submit?: () => void;
  change?: (doc: unknown) => void;
  files?: (files: File[]) => void;
  escape?: () => boolean;
}

export interface EditorBridge {
  readonly users: () => readonly UserSummaryDto[];
  readonly handlers: () => EditorHandlers;
  /** Called from an effect with the latest props. */
  readonly sync: (users: readonly UserSummaryDto[], handlers: EditorHandlers) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getMention: () => MentionView | null;
  readonly setMention: (next: MentionView | null) => void;
  readonly open: (props: SuggestionProps<UserSummaryDto, { id: string; label: string }>) => void;
  readonly keydown: (props: SuggestionKeyDownProps) => boolean;
}

export function createEditorBridge(): EditorBridge {
  let mention: MentionView | null = null;
  let users: readonly UserSummaryDto[] = [];
  let handlers: EditorHandlers = {};
  const listeners = new Set<() => void>();
  const setMention = (next: MentionView | null) => {
    mention = next;
    for (const listener of listeners) listener();
  };
  return {
    users: () => users,
    handlers: () => handlers,
    sync: (nextUsers, nextHandlers) => {
      users = nextUsers;
      handlers = nextHandlers;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getMention: () => mention,
    setMention,
    open: (props) => {
      const index = mention && mention.items === props.items ? mention.index : 0;
      setMention({
        items: props.items,
        rect: props.clientRect?.() ?? null,
        index: Math.min(index, Math.max(0, props.items.length - 1)),
        command: (user) => props.command({ id: user.id, label: user.name }),
      });
    },
    keydown: ({ event }) => {
      const current = mention;
      if (!current) return false;
      if (event.key === 'Escape') {
        setMention(null);
        return true;
      }
      if (current.items.length === 0) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setMention({ ...current, index: (current.index + delta + current.items.length) % current.items.length });
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const user = current.items[current.index];
        if (user) current.command(user);
        return true;
      }
      return false;
    },
  };
}
