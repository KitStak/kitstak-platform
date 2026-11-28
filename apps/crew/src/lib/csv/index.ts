/**
 * CSV in and out for Crew (docs/crew/SPEC.md section 7), the Pulse engine copied with its tests.
 * Pure TypeScript that runs in the browser and on the server.
 *
 * - `parse`    reads CSV text: quotes, line breaks in cells, BOM, CRLF, comma, semicolon or tab
 * - `write`    writes CSV text: CRLF, BOM, quoting and the formula guard
 * - `coerce`   reads one cell into a date, a number, yes or no, a choice, an email
 * - `headers`  maps the headers of a file to stream columns by name, alias and fuzzy match
 * - `people`   the People stream (columns, help, and the reader of one row)
 */
export * from './parse';
export * from './write';
export * from './coerce';
export * from './headers';
export * from './people';
