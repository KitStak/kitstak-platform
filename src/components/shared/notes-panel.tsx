"use client";

/**
 * Notes panel (`GET/POST/DELETE /api/notes`): newest-first list with author and time,
 * a 0 / 1000 composer (Ctrl+Enter posts), and delete for the author.
 */
import * as React from "react";
import { MessageSquareText, Trash2 } from "lucide-react";
import { useFormat } from "@/lib/format";
import { useApiMutation, useApiQuery } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonText } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DisabledReason } from "@/components/ui/tooltip";
import { noteSchema, parseList, type Note } from "./contracts";

export const NOTE_MAX = 1000;
export const notesQueryKey = (entityType: string, entityId: string) => ["notes", entityType, entityId] as const;

export function NotesPanel({ entityType, entityId, canEdit = true }: { readonly entityType: string; readonly entityId: string; readonly canEdit?: boolean }) {
  const fmt = useFormat();
  const me = useMe();
  const key = notesQueryKey(entityType, entityId);
  // One retry only: the "could not be loaded · Retry" state shows within seconds on a 5xx.
  const query = useApiQuery<unknown>(key, "/api/notes", { query: { entityType, entityId }, retry: 1 });
  const notes = [...parseList(noteSchema, query.data?.data)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [body, setBody] = React.useState("");
  const [deleting, setDeleting] = React.useState<Note | null>(null);
  const add = useApiMutation<string, unknown>({
    path: "/api/notes",
    method: "POST",
    body: (text) => ({ entityType, entityId, body: text }),
    invalidate: [key],
    successMessage: "Note added",
    onSuccess: () => setBody(""),
  });
  const remove = useApiMutation<Note, unknown>({
    path: (n) => `/api/notes?id=${encodeURIComponent(n.id)}`,
    method: "DELETE",
    body: () => undefined,
    invalidate: [key],
    successMessage: "Note deleted",
  });
  const trimmed = body.trim();
  const reason = add.isPending ? "Saving…" : !trimmed ? "Write a note first" : trimmed.length > NOTE_MAX ? `At most ${NOTE_MAX} characters` : null;
  const myId = me.data?.data.user.id;

  return (
    <section aria-label="Notes" className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <MessageSquareText className="h-3.5 w-3.5 text-secondary" aria-hidden />
        Notes {notes.length ? <span className="text-faint">({notes.length})</span> : null}
      </h3>
      {canEdit ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason) add.mutate(trimmed);
          }}
        >
          <Textarea
            value={body}
            maxLength={NOTE_MAX}
            showCount
            rows={3}
            placeholder="Add a note for your team"
            aria-label="New note"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !reason) add.mutate(trimmed);
            }}
          />
          <div className="flex justify-end">
            <DisabledReason reason={reason}>
              <Button type="submit" size="sm" variant="primary" disabled={Boolean(reason)}>
                Add Note
              </Button>
            </DisabledReason>
          </div>
        </form>
      ) : null}
      {query.isPending ? (
        <SkeletonText lines={3} />
      ) : query.error ? (
        <p className="text-[12px] text-danger">
          Notes could not be loaded.{" "}
          <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : notes.length === 0 ? (
        <p className="text-[12px] text-faint">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2.5">
              <Avatar name={n.userName ?? "System"} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[12px]">
                  <span className="font-semibold text-foreground">{n.userName ?? "System"}</span>
                  <span className="text-faint">{fmt.dateTime(n.createdAt)}</span>
                  {canEdit && n.userId && n.userId === myId ? (
                    <Button variant="ghost" size="icon-sm" className="ml-auto h-6 w-6" aria-label="Delete note" onClick={() => setDeleting(n)}>
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </Button>
                  ) : null}
                </p>
                <p className="whitespace-pre-wrap break-words text-[13px] text-body">{n.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this note?"
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting);
          setDeleting(null);
        }}
      />
    </section>
  );
}
