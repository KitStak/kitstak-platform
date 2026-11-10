#!/usr/bin/env node
// Serialized, incremental typecheck shared by all parallel agents.
// Usage: node scripts/tc-queue.mjs [pathFilter ...]
//   pathFilter: only print diagnostics whose file path contains one of these substrings.
// Exit code: 0 when no (filtered) errors, 1 otherwise.
import { mkdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd()
const LOCK_DIR = join(ROOT, '.data', 'tc.lock')
const BUILD_INFO = join(ROOT, 'node_modules', '.cache', 'tsc-queue.tsbuildinfo')
const POLL_MS = 2000
const STALE_MS = 10 * 60 * 1000
const MAX_WAIT_MS = 30 * 60 * 1000

const filters = process.argv.slice(2).map((f) => f.replaceAll('\\', '/'))

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function acquireLock() {
  const started = Date.now()
  mkdirSync(join(ROOT, '.data'), { recursive: true })
  for (;;) {
    try {
      mkdirSync(LOCK_DIR)
      return
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      if (existsSync(LOCK_DIR) && Date.now() - statSync(LOCK_DIR).mtimeMs > STALE_MS) {
        rmSync(LOCK_DIR, { recursive: true, force: true })
        continue
      }
      if (Date.now() - started > MAX_WAIT_MS) {
        console.error('tc-queue: timed out waiting for typecheck lock')
        process.exit(2)
      }
      sleep(POLL_MS)
    }
  }
}

function releaseLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true })
}

acquireLock()
process.on('exit', releaseLock)
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true })
const tscBin = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const res = spawnSync(
  process.execPath,
  [tscBin, '--noEmit', '--pretty', 'false', '--incremental', '--tsBuildInfoFile', BUILD_INFO],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: STALE_MS - 60_000 },
)

if (res.error) {
  console.error(`tc-queue: tsc failed to run: ${res.error.message}`)
  process.exit(2)
}

const lines = `${res.stdout}${res.stderr}`.split(/\r?\n/).filter(Boolean)
const errors = lines.filter((l) => /error TS\d+/.test(l))
const shown = filters.length
  ? errors.filter((l) => {
      const file = l.split('(')[0].replaceAll('\\', '/')
      return filters.some((f) => file.includes(f))
    })
  : errors

for (const line of shown) console.log(line)
console.log(`tc-queue: ${shown.length} error(s)${filters.length ? ` in [${filters.join(', ')}]` : ''}; ${errors.length} total in project`)
process.exit(shown.length ? 1 : 0)
