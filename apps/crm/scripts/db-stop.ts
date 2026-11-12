import { stopEmbeddedPostgres } from '../src/server/db/embedded';

stopEmbeddedPostgres()
  .then((wasRunning) => {
    process.stdout.write(wasRunning ? 'Embedded Postgres stopped\n' : 'Embedded Postgres was not running\n');
  })
  .catch((error: unknown) => {
    process.stderr.write(`db:stop failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
