/**
 * CSV in and out (docs/ledger/SPEC.md section 7), copied from Pulse's `src/lib/csv`. Pure
 * TypeScript that runs in the browser and on the server.
 *
 * - `parse`    reads CSV text: quotes, line breaks in cells, BOM, CRLF, comma, semicolon or tab
 * - `write`    writes CSV text: CRLF, BOM, quoting and the formula guard
 * - `headers`  maps the headers of a file to stream columns by name, alias and fuzzy match
 *
 * Ledger's streams (columns, QuickBooks header aliases, row checks) live in `src/server/csv`.
 */
export * from './parse';
export * from './write';
export * from './headers';
