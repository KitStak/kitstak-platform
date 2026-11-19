/**
 * The look alike client guard on every path where a person types a client name, on a throwaway
 * organization. Skipped when no database answers.
 *
 *  - The new job wizard (createJob), Settings (createClient) and the calculator (scenario to job)
 *    refuse a name close to a client you have, unless the caller says it is a new client.
 *  - Imports, sync, seed and sample data call the same functions without the guard and still work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { createClient, listClients, updateClient } from './catalog';
import { createJob } from './jobs';

const ready = await databaseReady();
const GUARD = { guardLookAlike: true } as const;

describe.skipIf(!ready)('look alike client guard', () => {
  let org: TestOrg;
  let owner: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('pulse-client-guard');
    owner = await org.member('owner', 'Olive Owner');
    await createClient(owner, { name: 'Harbor Roast Collective' }, GUARD);
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  const names = async () => (await listClients(owner, {})).map((client) => client.name).sort();

  it('createClient (Settings) refuses a close name until the caller confirms a new client', async () => {
    await expect(createClient(owner, { name: 'Harbr Roast Collective' }, GUARD)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('looks like Harbor Roast Collective'),
      fields: { name: expect.any(String), clientLookAlike: 'Harbor Roast Collective' },
    });
    expect(await names()).toEqual(['Harbor Roast Collective']);
    const made = await createClient(owner, { name: 'Harbr Roast Collective', confirmNew: true }, GUARD);
    expect(made.name).toBe('Harbr Roast Collective');
    // A name close to nothing needs no flag.
    expect((await createClient(owner, { name: 'Summit Supply' }, GUARD)).name).toBe('Summit Supply');
  });

  it('createJob (the wizard) refuses a typed close name, takes the exact name, and makes the client on a clear yes', async () => {
    await expect(createJob(owner, { name: 'Wizard job', clientName: 'Harbor Roast Collectiv' }, GUARD)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('looks like'),
      fields: { clientId: expect.any(String), clientName: expect.any(String) },
    });
    expect(await names()).not.toContain('Harbor Roast Collectiv');
    const same = await createJob(owner, { name: 'Same client job', clientName: 'harbor roast collective' }, GUARD);
    expect(same.clientName).toBe('Harbor Roast Collective');
    const made = await createJob(owner, { name: 'New client job', clientName: 'Harbor Roast Collectiv', createClient: true }, GUARD);
    expect(made.clientName).toBe('Harbor Roast Collectiv');
  });

  it('updateClient (a rename in Settings) asks the same way, and leaves other edits and small fixes alone', async () => {
    const summit = (await listClients(owner, {})).find((client) => client.name === 'Summit Supply') ?? (await createClient(owner, { name: 'Summit Supply' }, GUARD));
    // A new name close to another client is refused, and nothing is saved.
    await expect(updateClient(owner, summit.id, { name: 'Harbor Roast' }, summit.version, GUARD)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('Harbor Roast looks like'),
      fields: { name: expect.any(String), clientLookAlike: expect.stringContaining('Harbor Roast Collective') },
    });
    expect(await names()).toContain('Summit Supply');
    // The exact name of another client is never taken, even with a yes.
    await expect(updateClient(owner, summit.id, { name: 'harbor roast collective', confirmNew: true }, summit.version, GUARD)).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('already have a client called') });
    // Other edits with the same name, and a fix of its own name, go through with no question.
    const edited = await updateClient(owner, summit.id, { name: 'Summit Supply', notes: 'Pays on time' }, summit.version, GUARD);
    expect(edited.notes).toBe('Pays on time');
    const fixed = await updateClient(owner, summit.id, { name: 'Summit Supply Co' }, edited.version, GUARD);
    expect(fixed.name).toBe('Summit Supply Co');
    // A clear yes renames it.
    const renamed = await updateClient(owner, summit.id, { name: 'Harbor Roast', confirmNew: true }, fixed.version, GUARD);
    expect(renamed.name).toBe('Harbor Roast');
    // Callers with no guard (no person typing) are not asked.
    const back = await updateClient(owner, summit.id, { name: 'Harbor Roasters' }, renamed.version);
    expect(back.name).toBe('Harbor Roasters');
    await updateClient(owner, summit.id, { name: 'Summit Supply' }, back.version);
  });

  it('imports, sync, seed and sample data call without the guard and are not refused', async () => {
    const before = (await names()).length;
    const seeded = await createClient(owner, { name: 'Summit Supply Co', isSample: true });
    expect(seeded.name).toBe('Summit Supply Co');
    const job = await createJob(owner, { name: 'Synced job', clientName: 'Summit Suply' });
    expect(job.clientName).toBe('Summit Suply');
    expect((await names()).length).toBe(before + 2);
  });
});
