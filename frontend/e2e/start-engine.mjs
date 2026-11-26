// Starts the reference engine for end-to-end tests with an isolated, freshly emptied data directory.
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const engineDir = resolve(here, '../../engine')
const dataDir = resolve(here, '../test-results/engine-data')
rmSync(dataDir, { recursive: true, force: true })

const port = process.env.E2E_ENGINE_PORT ?? '8765'
const child = spawn('python', ['-m', 'uvicorn', 'engine.main:app', '--host', '127.0.0.1', '--port', port], {
  cwd: engineDir,
  env: { ...process.env, ENGINE_DATA_DIR: dataDir, ENGINE_TEST_HOOKS: '1' },
  stdio: 'inherit',
})
const stop = () => child.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => process.exit(code ?? 0))
