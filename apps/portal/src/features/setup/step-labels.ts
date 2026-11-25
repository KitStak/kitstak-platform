/**
 * The words on the fold row of the setup guide. PURE.
 *
 * The header counts the quick start: "2 of 5 done". The row says what it hides in terms a person
 * can check against that header (review round 4: "5 steps" above "Show all steps (7 more)" read as
 * a mistake, because 7 mixed quick start rows with the steps for later).
 */

/** The steps the quick start leaves out. They do not count toward the header, and the row says so. */
export function moreStepsLabel(count: number): string {
  return count === 1 ? 'Show 1 more step for later' : `Show ${count} more steps for later`;
}
