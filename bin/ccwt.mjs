#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '4600' },
    host: { type: 'string', default: '127.0.0.1' },
    open: { type: 'boolean', default: true },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
  allowNegative: true,
})

if (values.help) {
  process.stdout.write(`
  ccwt — manage git worktrees as running environments

  Usage
    ccwt [options]

  Options
    -p, --port <number>   port to listen on            (default 4600)
        --host <host>     host to bind                 (default 127.0.0.1)
        --no-open         do not open a browser
    -h, --help            show this
    -v, --version         show the version

`)
  process.exit(0)
}

if (values.version) {
  process.stdout.write('0.1.0\n')
  process.exit(0)
}

const port = Number.parseInt(values.port, 10)
const host = values.host

if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  process.stderr.write(`\n  Refusing to bind ${host}. ccwt runs git and spawns processes;\n  it is localhost only by design.\n\n`)
  process.exit(1)
}

const dir = join(homedir(), '.ccwt')
const runtimeFile = join(dir, 'runtime.json')

const isFree = (at, on) =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(at, on)
  })

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return cause.code === 'EPERM'
  }
}

const running = await readFile(runtimeFile, 'utf8')
  .then((raw) => JSON.parse(raw))
  .catch(() => null)

if (running && alive(running.pid) && !(await isFree(running.port, running.host ?? '127.0.0.1'))) {
  const at = running.host === '::1' ? '[::1]' : (running.host ?? '127.0.0.1')
  process.stderr.write(
    `\n  ccwt is already running on http://${at}:${running.port} (pid ${running.pid}).\n  One ccwt per machine: a second would supervise the same worktrees\n  and hand out the same ports. Open that one, or stop it first.\n\n`,
  )
  process.exit(1)
}

if (!(await isFree(port, host))) {
  process.stderr.write(`\n  Port ${port} is already in use by something else.\n  Try \`ccwt --port ${port + 1}\`.\n\n`)
  process.exit(1)
}

const token = randomBytes(32).toString('hex')
const root = dirname(dirname(fileURLToPath(import.meta.url)))

await mkdir(dir, { recursive: true, mode: 0o700 })
await writeFile(
  runtimeFile,
  JSON.stringify({ host, port, pid: process.pid, token, startedAt: new Date().toISOString() }),
  { mode: 0o600 },
)

const release = () => {
  try {
    unlinkSync(runtimeFile)
  } catch {
    /* already gone */
  }
}

process.once('exit', release)

process.env.NITRO_PORT = String(port)
process.env.NITRO_HOST = host
process.env.PORT = String(port)
process.env.HOST = host
process.env.NUXT_TOKEN = token
process.env.CCWT_ROOT = root

const server = join(root, '.output/server/index.mjs')

await import(server).catch((cause) => {
  process.stderr.write(`\n  Could not start the server from ${server}\n  ${cause.message}\n\n  Run \`npm run build\` first.\n\n`)
  process.exit(1)
})

const url = `http://${host}:${port}/?t=${token}`
process.stdout.write(`\n  ccwt listening on http://${host}:${port}\n\n`)

if (values.open) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
}
