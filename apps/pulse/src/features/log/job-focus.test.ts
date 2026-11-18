import { describe, expect, it } from 'vitest';
import { focusNote, type FocusJob } from './job-focus';

const job = (patch: Partial<FocusJob> = {}): FocusJob => ({ ref: 'J-1024', id: 'id-1', number: 'J-1024', name: 'Pilot kits', status: 'planned', siteId: 's1', siteName: 'Main', startDate: '2026-11-25', ...patch });
const day = { date: '2026-11-18', siteId: 's1' };

describe('focusNote', () => {
  it('offers to start a planned job for a manager', () => {
    const note = focusNote(job(), day, true);
    expect(note.action).toBe('start');
    expect(note.text).toContain('J-1024, Pilot kits, is planned');
  });

  it('tells someone who cannot manage jobs to ask a manager', () => {
    const note = focusNote(job({ status: 'on_hold' }), day, false);
    expect(note.action).toBe('none');
    expect(note.text).toContain('Ask a manager');
  });

  it('points a completed job at the job page', () => {
    expect(focusNote(job({ status: 'completed' }), day, true).action).toBe('open_job');
  });

  it('sends a job from another site to that site', () => {
    const note = focusNote(job({ siteId: 's2', siteName: 'North' }), day, true);
    expect(note).toMatchObject({ action: 'go_to_site', actionLabel: 'Go to North' });
  });

  it('explains an active job whose start day has not come', () => {
    expect(focusNote(job({ status: 'active' }), day, true)).toMatchObject({ action: 'start', actionLabel: 'Start it today' });
    expect(focusNote(job({ status: 'active' }), day, false)).toMatchObject({ action: 'go_to_start', actionLabel: 'Go to Nov 25' });
  });

  it('says plainly when no job has that number', () => {
    const note = focusNote({ ref: 'WO999', id: null, number: null, name: null, status: null, siteId: null, siteName: null, startDate: null }, day, true);
    expect(note).toMatchObject({ action: 'none', text: 'Pulse has no job called WO999. Check the number, or find the job on the Jobs page.' });
  });
});
