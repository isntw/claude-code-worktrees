#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const LOOPBACK = ['127.0.0.1', 'localhost', '::1']

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    host: { type: 'string' },
    dev: { type: 'boolean', default: false },
    open: { type: 'boolean', default: true },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
    'plugin-path': { type: 'boolean', default: false },
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
        --dev             run the Nuxt dev server instead of the built one
        --no-open         do not open a browser
    -h, --help            show this
    -v, --version         show the version
        --plugin-path     print the Claude Code plugin directory and exit

  The port and host are also settable in Settings, which saves them to
  ~/.ccwt/config.json. A flag here wins over what is saved there.

`)
  process.exit(0)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = process.env.CCWT_HOME || join(homedir(), '.ccwt')
const runtimeFile = join(dir, 'runtime.json')
const configFile = join(dir, 'config.json')

const readJson = (path) =>
  readFile(path, 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null)

if (values['plugin-path']) {
  process.stdout.write(`${join(root, 'plugin')}\n`)
  process.exit(0)
}

if (values.version) {
  const own = await readJson(join(root, 'package.json'))
  process.stdout.write(`${own?.version ?? '0.0.0'}\n`)
  process.exit(0)
}

function startNuxtDev(at, on) {
  const nuxt = join(root, 'node_modules/nuxt/bin/nuxt.mjs')

  if (!existsSync(nuxt)) {
    process.stderr.write(`\n  --dev runs ccwt from source and needs its dev dependencies.\n  ${nuxt} is not there. Clone the repository and run \`npm install\`.\n\n`)
    process.exit(1)
  }

  const child = spawn(
    process.execPath,
    [nuxt, 'dev', '--port', String(at), '--host', on],
    { cwd: root, stdio: 'inherit', env: process.env },
  )

  const relay = (signal) => () => child.kill(signal)
  process.once('SIGINT', relay('SIGINT'))
  process.once('SIGTERM', relay('SIGTERM'))

  child.once('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))

  return child
}

const saved = (await readJson(configFile)) ?? {}
const savedHost = LOOPBACK.includes(saved.host) ? saved.host : null
const savedPort = Number.isInteger(saved.port) ? saved.port : null

const host = values.host ?? savedHost ?? '127.0.0.1'
const port = Number.parseInt(values.port ?? String(savedPort ?? (values.dev ? 5600 : 4600)), 10)

if (!LOOPBACK.includes(host)) {
  process.stderr.write(`\n  Refusing to bind ${host}. ccwt runs git and spawns processes;\n  it is localhost only by design.\n\n`)
  process.exit(1)
}

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

const running = await readJson(runtimeFile)

if (running && alive(running.pid) && !(await isFree(running.port, running.host ?? '127.0.0.1'))) {
  const at = running.host === '::1' ? '[::1]' : (running.host ?? '127.0.0.1')
  process.stderr.write(
    `\n  ccwt is already running on http://${at}:${running.port} (pid ${running.pid}).\n  One ccwt per machine: a second would supervise the same worktrees\n  and hand out the same ports. Open that one, or stop it first.\n\n`,
  )
  process.exit(1)
}

if (!(await isFree(port, host))) {
  process.stderr.write(`\n  Port ${port} is already in use by something else.\n  Try \`ccwt --port ${port + 1}\`, or set another one in Settings.\n\n`)
  process.exit(1)
}

const token = randomBytes(32).toString('hex')

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

const url = `http://${host === '::1' ? '[::1]' : host}:${port}/`

if (values.dev) {
  startNuxtDev(port, host)
  process.stdout.write(`\n  ccwt listening on ${url}\n  Its handshake is written, so Claude Code can reach it.\n\n`)
} else {
  const server = join(root, '.output/server/index.mjs')

  await import(server).catch((cause) => {
    process.stderr.write(`\n  Could not start the server from ${server}\n  ${cause.message}\n\n  Run \`npm run build\` first, or \`npm run dev\` to run from source.\n\n`)
    process.exit(1)
  })

  process.stdout.write(`\n  ccwt listening on ${url}\n  Open it in any browser.\n\n`)
}

if (values.open) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
}
