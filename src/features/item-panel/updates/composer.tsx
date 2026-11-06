'use client';

/**
 * New-update composer. Starts as a one-line prompt and expands into the rich editor (same box,
 * no jump). Drafts autosave per item (this browser only); staged attachments upload with
 * progress after the update is created. Ctrl/⌘+Enter posts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { Avatar, Button, IconButton, Kbd, ProgressBar, cn, useModKey } from '@/components/ui';
import { useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { UserSummaryDto } from '@/server/services/contracts/dto';
import { formatBytes } from '../lib/format';
import { attachmentOnlyDoc, isDocEmpty, type RichDoc } from '../lib/rich-text';
import { uploadWithProgress } from '../hooks/use-upload-queue';
import { UpdateEditor, type UpdateEditorHandle } from './update-editor';

const DRAFT_PREFIX = 'kitstak.itemPanel.draft.';
const ACCEPT = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.json,.zip,video/mp4,audio/mpeg';

function readDraft(itemId: string): RichDoc | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + itemId);
    if (!raw) return null;
    const doc = JSON.parse(raw) as RichDoc;
    return doc && doc.type === 'doc' && !isDocEmpty(doc) ? doc : null;
  } catch {
    return null;
  }
}

function writeDraft(itemId: string, doc: RichDoc | null): void {
  try {
    if (!doc || isDocEmpty(doc)) window.localStorage.removeItem(DRAFT_PREFIX + itemId);
    else window.localStorage.setItem(DRAFT_PREFIX + itemId, JSON.stringify(doc));
  } catch {
    // Drafts are a convenience; storage may be unavailable.
  }
}

interface Staged {
  readonly id: string;
  readonly file: File;
  readonly progress: number | null;
  readonly error?: string;
}

export interface ComposerProps {
  readonly itemId: string;
  readonly boardId: string;
  readonly users: readonly UserSummaryDto[];
  readonly me: UserSummaryDto | null;
  readonly readOnly?: boolean;
  readonly post: (body: RichDoc) => Promise<{ id: string }>;
  /** Imperative focus request (empty-state CTA). */
  readonly focusSignal?: number;
}

export function Composer({ itemId, boardId, users, me, readOnly, post, focusSignal }: ComposerProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const mod = useModKey();
  const editorRef = useRef<UpdateEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [initial] = useState<RichDoc | null>(() => (typeof window === 'undefined' ? null : readDraft(itemId)));
  const [expanded, setExpanded] = useState(initial !== null);
  const [empty, setEmpty] = useState(initial === null);
  const [seenSignal, setSeenSignal] = useState(focusSignal);
  if (focusSignal !== seenSignal) {
    setSeenSignal(focusSignal);
    setExpanded(true);
  }
  const [staged, setStaged] = useState<readonly Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (focusSignal) requestAnimationFrame(() => editorRef.current?.focus());
  }, [focusSignal]);

  const addFiles = useCallback((files: readonly File[]) => {
    if (files.length === 0) return;
    setExpanded(true);
    setStaged((list) => [
      ...list,
      ...files.map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, progress: null })),
    ]);
  }, []);

  const onChange = useCallback(
    (doc: RichDoc, isEmpty: boolean) => {
      setEmpty(isEmpty);
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => writeDraft(itemId, doc), 400);
    },
    [itemId],
  );

  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );

  const canPost = !busy && (!empty || staged.length > 0);

  const submit = useCallback(async () => {
    const handle = editorRef.current;
    if (!handle || busy) return;
    const doc = handle.getDoc();
    const files = staged;
    if (isDocEmpty(doc) && files.length === 0) return;
    setBusy(true);
    const body = isDocEmpty(doc) ? attachmentOnlyDoc(files.length) : doc;
    handle.clear();
    writeDraft(itemId, null);
    setEmpty(true);
    try {
      const update = await post(body);
      if (files.length > 0) {
        const results = await Promise.allSettled(
          files.map((entry) =>
            uploadWithProgress(orgId, itemId, entry.file, { updateId: update.id }, (progress) =>
              setStaged((list) => list.map((candidate) => (candidate.id === entry.id ? { ...candidate, progress } : candidate))),
            ).catch((error: unknown) => {
              setStaged((list) =>
                list.map((candidate) =>
                  candidate.id === entry.id ? { ...candidate, error: error instanceof Error ? error.message : 'Upload failed' } : candidate,
                ),
              );
              throw error;
            }),
          ),
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.itemUpdates(orgId, itemId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.itemFiles(orgId, itemId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.boardFiles(orgId, boardId) }),
        ]);
        setStaged((list) => list.filter((entry) => results[files.findIndex((file) => file.id === entry.id)]?.status === 'rejected'));
      }
      setExpanded(false);
    } catch {
      // Post failed: the mutation rolled back and toasted; put the text back so nothing is lost.
      handle.editor?.commands.setContent(body as never);
      writeDraft(itemId, body);
      setEmpty(false);
    } finally {
      setBusy(false);
    }
  }, [boardId, busy, itemId, orgId, post, queryClient, staged]);

  if (readOnly) {
    return (
      <p className="rounded-lg border border-dashed border-border-default bg-sunken px-4 py-3 text-sm text-fg-secondary">
        You have view-only access. You can read updates but not post them.
      </p>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="update-composer-collapsed"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => editorRef.current?.focus());
        }}
        onFocus={() => setExpanded(true)}
        className="flex h-11 w-full items-center gap-3 rounded-lg border border-border-input bg-panel px-3 text-left text-base text-fg-placeholder transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-out hover:border-border-input-hover hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {me ? <Avatar name={me.name} src={me.image} colorKey={me.id} size="sm" /> : null}
        <span className="truncate">Write an update and mention others with @</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <UpdateEditor
        ref={editorRef}
        testId="update-composer"
        label="Write an update"
        users={users}
        placeholder="Write an update and mention others with @"
        initialContent={initial}
        autoFocus
        minHeight={88}
        onChange={onChange}
        onSubmit={() => void submit()}
        onFiles={addFiles}
        onEscape={() => {
          if (editorRef.current?.isEmpty() && staged.length === 0) {
            setExpanded(false);
            return true;
          }
          return false;
        }}
        toolbarExtra={
          <>
            <IconButton
              size="sm"
              label="Attach files"
              icon={<Paperclip aria-hidden />}
              tooltipSide="top"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => fileInput.current?.click()}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
          </>
        }
        footer={
          staged.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 px-3 pb-2" aria-label="Attachments">
              {staged.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    'flex max-w-[240px] min-w-[160px] flex-col gap-1 rounded-md border bg-sunken px-2 py-1.5',
                    entry.error ? 'border-danger' : 'border-border-subtle',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Paperclip aria-hidden className="size-3.5 shrink-0 text-icon" />
                    <span className="min-w-0 flex-1 truncate text-sm" title={entry.file.name}>
                      {entry.file.name}
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted tabular-nums">{formatBytes(entry.file.size)}</span>
                    {entry.progress === null || entry.error ? (
                      <IconButton
                        size="xs"
                        label={`Remove ${entry.file.name}`}
                        icon={<X aria-hidden />}
                        onClick={() => setStaged((list) => list.filter((candidate) => candidate.id !== entry.id))}
                      />
                    ) : null}
                  </div>
                  {entry.error ? (
                    <p role="alert" className="text-xs text-danger-text">
                      {entry.error}
                    </p>
                  ) : entry.progress !== null ? (
                    <ProgressBar value={Math.round(entry.progress * 100)} size="sm" label={`Uploading ${entry.file.name}`} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null
        }
        actions={
          <>
            <span className="hidden items-center gap-1 text-xs text-fg-muted sm:inline-flex" aria-hidden>
              <Kbd>{mod}</Kbd>
              <Kbd>Enter</Kbd>
            </span>
            <Button size="sm" onClick={() => void submit()} disabled={!canPost} loading={busy} data-testid="post-update">
              Post
            </Button>
          </>
        }
      />
    </div>
  );
}
