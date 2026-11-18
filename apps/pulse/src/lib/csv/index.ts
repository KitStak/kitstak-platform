/**
 * CSV in and out for every Pulse stream, with nothing else installed (docs/pulse/SPEC.md
 * section 7). Pure TypeScript that runs in the browser and on the server.
 *
 * - `parse`     reads CSV text: quotes, line breaks in cells, BOM, CRLF, comma, semicolon or tab
 * - `write`     writes CSV text: CRLF, BOM, quoting and the formula guard
 * - `coerce`    reads one cell into a date, money, a number, hours, a percent, yes or no, a choice
 * - `headers`   maps the headers of a file to stream columns by name, alias and fuzzy match
 * - `streams`   the declarative definition of every stream, and the typed record of a row
 * - `read`      the whole import pipeline, with plain language problems for every row
 * - `template`  templates, the "how to fill this in" file and round trip safe exports
 */
export * from './parse';
export * from './write';
export * from './coerce';
export * from './headers';
export * from './streams';
export * from './read';
export * from './template';
