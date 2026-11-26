'use client';
/**
 * "Track in Pulse" (spec 7.2, `trackProgram`): makes the program job that holds the program's
 * labor, materials and fees. When Pulse matched the program's customer to a client, one click is
 * enough; otherwise this asks which client the program works for.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Repeat2 } from 'lucide-react';
import { Tag } from '@kitstak/ui/dashboard';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { useServerAction } from '@/lib/hooks/use-action';
import type { ProgramNotTrackedDTO } from '@/lib/program-types';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { ClientDTO } from '@/lib/types';
import { trackProgramAction } from '@/server/actions/programs';

export function TrackProgramDialog({ program, clients, onClose }: { readonly program: ProgramNotTrackedDTO | null; readonly clients: readonly ClientDTO[]; readonly onClose: () => void }) {
  return (
    <Dialog open={program !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {program ? <TrackBody key={program.programId} program={program} clients={clients} onClose={onClose} /> : null}
    </Dialog>
  );
}

function TrackBody({ program, clients, onClose }: { readonly program: ProgramNotTrackedDTO; readonly clients: readonly ClientDTO[]; readonly onClose: () => void }) {
  const router = useRouter();
  const [clientId, setClientId] = useState<string | null>(program.matchedClient?.id ?? null);
  const track = useServerAction(trackProgramAction, {
    invalidate: [qk.programsRoot(), qk.jobsRoot()],
    successMessage: (data) => `${data.key} is tracked in Pulse on ${data.jobNumber}.`,
    errorTitle: `Could not track ${program.key}`,
  });
  const submit = async () => {
    if (!clientId) return;
    const done = await track.run({ programId: program.programId, clientId });
    if (!done) return;
    onClose();
    router.push(routes.program(done.key));
  };
  const options = clients.filter((client) => client.status === 'active').map((client) => ({ value: client.id, label: client.name, keywords: client.code ? [client.code] : undefined }));
  return (
    <DialogContent size="md" data-testid="track-program-dialog">
      <DialogHeader
        title={`Track ${program.key} in Pulse`}
        description={`Pulse makes one job to hold the labor, materials and fees of ${program.name}. The plan and prices stay in Projects.`}
        icon={<Repeat2 aria-hidden className="size-5 text-icon" />}
      />
      <DialogBody className="flex flex-col gap-4 pb-4">
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-sunken px-3 py-2.5 text-sm">
          <Tag>{program.key}</Tag>
          <span className="min-w-0 truncate font-medium text-fg">{program.name}</span>
          <span className="ml-auto shrink-0 text-fg-muted">Counts {program.unit.plural}</span>
        </div>
        {program.matchedClient ? (
          <p className="text-sm text-fg-secondary">
            The job goes on <span className="font-medium text-fg">{program.matchedClient.name}</span>, the client that matches this program’s customer.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="track-client" className="text-xs font-medium text-fg-secondary">
              Client
            </label>
            <Combobox id="track-client" aria-label="Client" value={clientId} onValueChange={setClientId} options={options} placeholder="Pick the client" searchPlaceholder="Search clients" emptyMessage="No client has that name" invalid={Boolean(track.fieldErrors.clientId)} />
            <p className={track.fieldErrors.clientId ? 'text-xs text-danger-text' : 'text-xs text-fg-muted'}>{track.fieldErrors.clientId ?? `Pick the client ${program.key} works for. Its target margin is used for this program.`}</p>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} loading={track.pending} disabled={!clientId} data-testid="track-program-submit">
          Track in Pulse
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
