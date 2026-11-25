/**
 * Set while a person reads the last screen of the welcome wizard (the plan) with their answers
 * already saved. The welcome page then shows the wizard again instead of sending them to the
 * launcher. Scoped to /welcome, gone after 30 minutes, and cleared by "Looks good" and "Skip for
 * now". Read on the server in `app/(app)/welcome/page.tsx`, written in the browser by the wizard.
 */
export const READING_PLAN_COOKIE = 'kitstak.welcome-plan';
