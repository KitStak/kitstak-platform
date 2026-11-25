/**
 * Exact money math for Pulse (docs/pulse/SPEC.md 4.2). Moved to the shared engine so Projects
 * and Pulse compute program money with the same code (docs/programs/SPEC.md 3.1); this file
 * re-exports it so every Pulse import keeps working.
 */
export * from '@kitstak/programs-engine/money';
