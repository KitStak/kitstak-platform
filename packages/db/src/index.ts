/**
 * @kitstak/db — shared core schema and migrations.
 * Driver factories are subpath exports so importing the schema never pulls a driver:
 * `@kitstak/db/client-pg` (node-postgres, CRM style) and
 * `@kitstak/db/client-postgres-js` (postgres-js, prepare:false, WMS style).
 */
export * from './schema/index';
export * from './wms-tenants';
