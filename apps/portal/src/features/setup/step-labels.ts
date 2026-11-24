/**
 * The words on the two fold rows of the setup guide. PURE.
 *
 * The header counts the quick start: "2 of 5 done". Each row says what it hides in terms a person
 * can check against that header (review round 4: "5 steps" above "Show all steps (7 more)" read as
 * a mistake, because 7 mixed the 4 folded quick start rows with 3 steps for later).
 */

/**
 * Phones: the quick start rows other than the open one. With 5 steps and one open, 4 are hidden:
 * "Show the other 4 steps".
 */
export function otherStepsLabel(hidden: number): string {
  return hidden === 1 ? 'Show the other step' : `Show the other ${hidden} steps`;
}

/** The steps the quick start leaves out. They do not count toward the header, and the row says so. */
export function moreStepsLabel(count: number): string {
  return count === 1 ? 'Show 1 more step for later' : `Show ${count} more steps for later`;
}
