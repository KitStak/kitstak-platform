/**
 * The hand-written feature claims on /projects (src/components/projects/projects-content.ts), each
 * checked against the Projects app's source. If the app drops a feature, this fails and the copy
 * must change with it. Counts and lists are not here: those are generated (scripts/sync-projects.ts).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectsSrc = path.resolve(__dirname, '../../../projects/src');
const hasProjectsApp = existsSync(projectsSrc);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Claim on the page → evidence that must exist in apps/projects/src (non-test code). */
const CLAIMS: readonly { readonly claim: string; readonly evidence: RegExp }[] = [
  { claim: 'Table view exports to CSV', evidence: /text\/csv|\.csv['"`]/ },
  { claim: 'Board columns have work-in-progress limits', evidence: /wipLimit/ },
  { claim: 'Recurring tasks', evidence: /recurr/i },
  { claim: 'Command palette', evidence: /CommandPalette|command-palette/ },
  { claim: 'j and k move through a list', evidence: /['"]j['"]/ },
  { claim: 'Cycles roll unfinished tasks forward', evidence: /rollover|roll over|carry ?over|unfinished/i },
  { claim: 'Triage: accept, decline, snooze, merge', evidence: /snooze/i },
  { claim: 'Goals with key results and check-ins', evidence: /check-ins|checkIn/ },
  { claim: 'Time tracking with a timer', evidence: /startTimer|timer/i },
  { claim: 'Project health', evidence: /on_track/ },
  { claim: 'Public intake forms', evidence: /submissions/ },
  { claim: 'Dashboards: burn-up, velocity, cycle time', evidence: /burn[-_ ]?up/i },
  { claim: 'Guests see only what they are added to', evidence: /guest/i },
  { claim: 'Automation run history', evidence: /automation_runs|automationRuns|\/runs/ },
  { claim: 'Customer 360 on a project', evidence: /customer-360|customer360/i },
];

describe.runIf(hasProjectsApp)('/projects claims are backed by the Projects app', () => {
  const corpus = hasProjectsApp ? sourceFiles(projectsSrc).map((file) => readFileSync(file, 'utf8')).join('\n') : '';

  it.each(CLAIMS)('$claim', ({ evidence }) => {
    expect(corpus).toMatch(evidence);
  });
});
