import { embeddedPgPaths, startEmbeddedPostgres, EMBEDDED_PG_PORT } from '../src/server/db/embedded';

async function main(): Promise<void> {
  const paths = embeddedPgPaths();
  const result = await startEmbeddedPostgres(paths);
  if (result.initialised) process.stdout.write(`Initialised new cluster in ${paths.dataDir}\n`);
  process.stdout.write(
    result.alreadyRunning
      ? `Embedded Postgres already running on port ${EMBEDDED_PG_PORT}\n`
      : `Embedded Postgres started on port ${EMBEDDED_PG_PORT} (log: ${paths.logFile})\n`,
  );
  if (result.databaseCreated) process.stdout.write('Created database "kitstak"\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`db:start failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
