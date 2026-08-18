#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
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

const free = await new Promise((resolve) => {
  const probe = createServer()
  probe.once('error', () => resolve(false))
  probe.once('listening', () => probe.close(() => resolve(true)))
  probe.listen(port, host)
})

if (!free) {
  process.stderr.write(`\n  Port ${port} is already in use.\n  Another ccwt may be running — try \`ccwt --port ${port + 1}\`.\n\n`)
  process.exit(1)
}

const token = randomBytes(32).toString('hex')
const dir = join(homedir(), '.ccwt')
const root = dirname(dirname(fileURLToPath(import.meta.url)))

await mkdir(dir, { recursive: true, mode: 0o700 })
await writeFile(join(dir, 'token'), token, { mode: 0o600 })
await writeFile(
  join(dir, 'server.json'),
  JSON.stringify({ host, port, pid: process.pid, startedAt: new Date().toISOString() }),
  { mode: 0o600 },
)

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
