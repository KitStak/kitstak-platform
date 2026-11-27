/**
 * Record search for the command palette and `/search`, on a throwaway organization. Skipped when no database answers.
 *
 *  - A job is found by its number, its name, its client's name and product words, and every word must match.
 *  - Clients, job types and extra services are found by name, with a short subtitle and a link to the record.
 *  - The client whose name is typed comes first, ahead of that client's jobs.
 *  - Results never cross into another organization, and never carry money.
 *  - Without money, a client opens its job list and job types and extra services are left out.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import {
  createClient,
  createJob,
  createJobType,
  createVasService,
  searchAll,
  setMemberRole,
} from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('searchAll', () => {
  let org: TestOrg;
  let other: TestOrg;
  let owner: DomainContext;
  let supervisor: DomainContext;
  let viewer: DomainContext;
  let clientId: string;
  let jobNumber: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-search');
    other = await createTestOrg('pulse-search-other');
    owner = await org.member('owner', 'Search Owner');
    supervisor = await org.member('member', 'Search Supervisor');
    viewer = await org.member('member', 'Search Viewer');
    await setMemberRole(owner, supervisor.userId, { role: 'supervisor' });
    await setMemberRole(owner, viewer.userId, { role: 'viewer' });
    const otherOwner = await other.member('owner', 'Other Owner');

    clientId = (await createClient(owner, { name: 'Orchard Pet Supply', code: 'ORCH' })).id;
    const second = (await createClient(owner, { name: 'Harbor Roast Collective', code: 'HARB' })).id;
    const job = await createJob(owner, {
      name: 'Orchard chew toy 3-pack',
      clientId,
      status: 'active',
      unitPrice: '1.0000',
    });
    jobNumber = job.number;
    await createJob(owner, {
      name: 'Holiday gift box',
      clientId: second,
      status: 'planned',
      unitPrice: '2.0000',
    });
    await createJobType(owner, { name: 'Gift box build' });
    await createVasService(owner, { name: 'Gift wrap' });

    const foreign = (await createClient(otherOwner, { name: 'Orchard Pet Supply' })).id;
    await createJob(otherOwner, { name: 'Other org chew toy', clientId: foreign, status: 'active' });
  }, 60_000);

  afterAll(async () => {
    await org?.destroy();
    await other?.destroy();
  });

  it('finds a job by its number, with the client and status in the subtitle', async () => {
    const hits = await searchAll(owner, jobNumber);
    const hit = hits.find((entry) => entry.type === 'job');
    expect(hit).toMatchObject({
      title: `${jobNumber} Orchard chew toy 3-pack`,
      subtitle: 'Orchard Pet Supply, Active',
      href: `/jobs/${jobNumber}`,
    });
    expect(hits[0]?.type).toBe('job');
  });

  it('finds a job by product words, by client name, and needs every word to match', async () => {
    expect(
      (await searchAll(owner, 'chew toy')).filter((hit) => hit.type === 'job').map((hit) => hit.title),
    ).toEqual([`${jobNumber} Orchard chew toy 3-pack`]);
    expect(
      (await searchAll(owner, 'harbor')).some(
        (hit) => hit.type === 'job' && hit.title.endsWith('Holiday gift box'),
      ),
    ).toBe(true);
    expect((await searchAll(owner, 'toy pet')).some((hit) => hit.type === 'job')).toBe(true);
    expect(await searchAll(owner, 'chew zebra')).toEqual([]);
  });

  it('puts the client whose name was typed first, and links to the client page', async () => {
    const hits = await searchAll(owner, 'orchard pet supply');
    expect(hits[0]).toMatchObject({
      type: 'client',
      id: clientId,
      title: 'Orchard Pet Supply',
      href: `/clients/${clientId}`,
    });
    expect(hits[0]?.subtitle).toBe('ORCH, 1 open job');
  });

  it('puts a client ahead of its jobs when only part of the client name was typed', async () => {
    const hits = await searchAll(owner, 'orchard');
    expect(hits[0]).toMatchObject({ type: 'client', id: clientId });
    expect(hits.some((hit) => hit.type === 'job')).toBe(true);
  });

  it('finds job types and extra services by name', async () => {
    const hits = await searchAll(owner, 'gift');
    const types = new Set(hits.map((hit) => hit.type));
    expect(types).toEqual(new Set(['job', 'jobType', 'service']));
    expect(hits.find((hit) => hit.type === 'jobType')?.href).toMatch(/^\/profit\?jobType=/);
    expect(hits.find((hit) => hit.type === 'service')?.href).toMatch(/^\/services\//);
  });

  it('stays inside the organization and never carries money', async () => {
    const hits = await searchAll(viewer, 'chew');
    expect(hits.map((hit) => hit.title)).toEqual([`${jobNumber} Orchard chew toy 3-pack`]);
    for (const hit of hits)
      expect(Object.keys(hit).sort()).toEqual(['href', 'id', 'subtitle', 'title', 'type']);
  });

  it('sends people without money from a client to its job list, and leaves out job types and extra services', async () => {
    for (const who of [supervisor, viewer]) {
      const hits = await searchAll(who, 'orchard pet supply');
      expect(hits[0]).toMatchObject({ type: 'client', href: '/jobs?tab=all&q=Orchard+Pet+Supply' });
      expect((await searchAll(who, 'gift')).map((hit) => hit.type)).toEqual(['job']);
    }
  });

  it('treats LIKE wildcards as plain text and ignores a blank query', async () => {
    expect(await searchAll(owner, '%')).toEqual([]);
    expect(await searchAll(owner, '   ')).toEqual([]);
  });
});
