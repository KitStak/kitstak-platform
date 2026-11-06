import { embeddedPgPaths, isInitialised, isRunning, EMBEDDED_PG_PORT } from '../src/server/db/embedded';

async function main(): Promise<void> {
  const paths = embeddedPgPaths();
  const running = await isRunning(paths);
  process.stdout.write(
    `initialised: ${isInitialised(paths)}\nrunning: ${running}\nport: ${EMBEDDED_PG_PORT}\ndataDir: ${paths.dataDir}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`db:status failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
