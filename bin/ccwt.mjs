#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const LOOPBACK = ['127.0.0.1', 'localhost', '::1']

const STOP_WAIT_MS = 15_000

const COMMANDS = ['start', 'stop', 'update', 'help']

const WORKTREE_COMMANDS = ['ls', 'up', 'down', 'logs', 'open', 'path', 'repair']

if (WORKTREE_COMMANDS.includes(process.argv[2])) {
  const { run } = await import('./cli.mjs')
  process.exit(await run(process.argv.slice(2)))
}

const { values, positionals, tokens } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    host: { type: 'string', default: '127.0.0.1' },
    dev: { type: 'boolean', default: false },
    detach: { type: 'boolean', default: false },
    open: { type: 'boolean', default: true },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
    'plugin-path': { type: 'boolean', default: false },
    'mod-path': { type: 'boolean', default: false },
  },
  allowNegative: true,
  allowPositionals: true,
  tokens: true,
})

const [command, ...extra] = positionals

if ((command !== undefined && !COMMANDS.includes(command)) || extra.length > 0) {
  process.stderr.write(`\n  Unknown command: ${positionals.join(' ')}\n  Run \`ccwt --help\` for what ccwt takes.\n\n`)
  process.exit(1)
}

if (command === 'start') values.detach = true

if (values.help || command === 'help') {
  const { USAGE } = await import('./cli.mjs')
  process.stdout.write(`
  ccwt — manage git worktrees as running environments

  Usage
    ccwt [options]          run in the foreground
    ccwt start [options]    run in the background and give the terminal back
    ccwt stop               stop the ccwt that is running, and the services it supervises
    ccwt update             pull, build, and restart ccwt and the services that were running
    ccwt help               show this
${USAGE}
  Options
    -p, --port <number>   port to listen on            (default 4600)
        --host <host>     host to bind                 (default 127.0.0.1)
        --dev             run the Nuxt dev server instead of the built one
        --detach          run in the background and give the terminal back
        --no-open         do not open a browser
    -h, --help            show this
    -v, --version         show the version
        --plugin-path     print the Claude Code plugin directory and exit
        --mod-path        print the Claude Code mod directory and exit

  The port is also settable in Settings, which saves it to ~/.ccwt/config.json.
  A flag here wins over what is saved there. The host is a flag only: ccwt binds
  127.0.0.1 unless told otherwise, and only ever loopback.

`)
  process.exit(0)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = process.env.CCWT_HOME || join(homedir(), '.ccwt')
const runtimeFile = join(dir, 'runtime.json')
const configFile = join(dir, 'config.json')

const tilde = (path) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path)

const readJson = (path) =>
  readFile(path, 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null)

if (values['plugin-path']) {
  process.stdout.write(`${join(root, 'plugin')}\n`)
  process.exit(0)
}

if (values['mod-path']) {
  process.stdout.write(`${join(root, 'mod')}\n`)
  process.exit(0)
}

if (values.version) {
  const own = await readJson(join(root, 'package.json'))
  process.stdout.write(`${own?.version ?? '0.0.0'}\n`)
  process.exit(0)
}

const VERSION = (await readJson(join(root, 'package.json')))?.version ?? '0.0.0'

const TONES = { success: '92;185;141', alarm: '255;92;66' }

const MARK = { light: '237;235;229', accent: '217;119;87' }

const styled = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

const paint = (text, rgb) => (styled() ? `\u001b[38;2;${rgb}m${text}\u001b[0m` : text)

const faint = (text) => (styled() ? `\u001b[2m${text}\u001b[0m` : text)

const WORDMARK = [
  ' ██████╗  ██████╗ ██╗    ██╗████████╗',
  '██╔════╝ ██╔════╝ ██║    ██║╚══██╔══╝',
  '██║      ██║      ██║ █╗ ██║   ██║   ',
  '██║      ██║      ██║███╗██║   ██║   ',
  '╚██████╗ ╚██████╗ ╚███╔███╔╝   ██║   ',
  ' ╚═════╝  ╚═════╝  ╚══╝╚══╝    ╚═╝   ',
]

const label = (text) => (styled() ? `\u001b[38;2;110;107;100m${text}\u001b[0m` : text)

const row = (key, value) => `  ${label(key.padEnd(4))}  ${value}\n`

const dot = (tone) => paint('●', TONES[tone])

const link = (target) =>
  styled() ? `\u001b]8;;${target}\u001b\\\u001b[4m${target}\u001b[0m\u001b]8;;\u001b\\` : target

const banner = [
  ...WORDMARK.map((line, index) => {
    const drawn = `  ${paint(line.slice(0, 18), MARK.light)}${paint(line.slice(18), MARK.accent)}`
    return index === 0 ? `${drawn}  ${faint(`v${VERSION}`)}` : drawn
  }),
  faint('  worktrees as running environments'),
].join('\n')

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
const savedPort = Number.isInteger(saved.port) ? saved.port : null

const host = values.host
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

const answering = async () =>
  Boolean(running) && alive(running.pid) && !(await isFree(running.port, running.host ?? '127.0.0.1'))

if (command === 'update') {
  const self = fileURLToPath(import.meta.url)
  const live = join(root, '.output')
  const next = join(root, '.output.next')
  const prev = join(root, '.output.prev')

  const step = (text) => process.stdout.write(`\n  ${faint('->')} ${text}\n`)
  const fail = (text) => {
    process.stderr.write(`\n  ${dot('alarm')} ${text}\n\n`)
    process.exit(1)
  }
  const run = (cmd, args, env = {}) =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
      child.once('error', () => resolve(1))
      child.once('exit', (code) => resolve(code ?? 1))
    })
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

  const api = async (at, method, path) => {
    const where = at.host === '::1' ? '[::1]' : (at.host ?? '127.0.0.1')
    const res = await fetch(`http://${where}:${at.port}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-ccwt-token': at.token },
      body: method === 'POST' ? '{}' : undefined,
    })
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`)
    return res.json()
  }

  if (!existsSync(join(root, '.git'))) {
    fail(`${tilde(root)} is not a git checkout, so there is nothing to pull. Reinstall ccwt to update it.`)
  }

  const before = git('rev-parse', 'HEAD')
  step('pulling')
  if (await run('git', ['pull', '--ff-only'])) fail('git pull failed. Nothing was changed.')
  const after = git('rev-parse', 'HEAD')
  const changed = before === after ? [] : git('diff', '--name-only', before, after).split('\n')

  const nuxt = join(root, 'node_modules/nuxt/bin/nuxt.mjs')
  if (changed.includes('package-lock.json') || !existsSync(nuxt)) {
    step('installing dependencies')
    if (await run('npm', ['install'])) fail('npm install failed. The running ccwt was not touched.')
  }

  step('building')
  rmSync(join(root, '.nuxt'), { recursive: true, force: true })
  rmSync(next, { recursive: true, force: true })
  if (await run(process.execPath, [nuxt, 'build'], { CCWT_OUTPUT_DIR: next })) {
    rmSync(next, { recursive: true, force: true })
    fail('The build failed. The running ccwt was not touched.')
  }

  const was = (await answering()) ? running : null
  const services = []

  if (was) {
    try {
      for (const project of await api(was, 'GET', '/projects')) {
        for (const worktree of await api(was, 'GET', `/projects/${project.id}/worktrees`)) {
          for (const service of worktree.services ?? []) {
            if (service.state !== 'running' && service.state !== 'starting') continue
            services.push({ project: project.id, worktree: worktree.id, name: service.name, label: `${worktree.name}/${service.name}` })
          }
        }
      }
    } catch (cause) {
      process.stdout.write(`  could not list the running services (${cause.message}); they stop with ccwt and are not restarted\n`)
    }

    step(`stopping ${services.length} service${services.length === 1 ? '' : 's'}`)
    for (const key of new Set(services.map((one) => `${one.project}/worktrees/${one.worktree}`))) {
      await api(was, 'POST', `/projects/${key}/services/stop`).catch((cause) => {
        process.stdout.write(`  ${key}: ${cause.message}\n`)
      })
    }

    if (await run(process.execPath, [self, 'stop'])) {
      fail(`ccwt did not stop. The new build is in ${tilde(next)}.`)
    }
  }

  rmSync(prev, { recursive: true, force: true })
  if (existsSync(live)) renameSync(live, prev)
  renameSync(next, live)

  if (!was) {
    rmSync(prev, { recursive: true, force: true })
    process.stdout.write(`\n  ${dot('success')} updated to ${after.slice(0, 7)}. ccwt was not running; \`ccwt start\` starts it.\n\n`)
    process.exit(0)
  }

  const start = () =>
    run(process.execPath, [self, 'start', '--port', String(was.port), '--host', was.host ?? '127.0.0.1', '--no-open'])

  if (await start()) {
    rmSync(live, { recursive: true, force: true })
    if (existsSync(prev)) renameSync(prev, live)
    await start()
    fail('The new build did not start, so the previous one was put back.')
  }
  rmSync(prev, { recursive: true, force: true })

  const now = await readJson(runtimeFile)
  for (let tries = 0; tries < 50; tries += 1) {
    if (await api(now, 'GET', '/projects').then(() => true, () => false)) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  if (services.length) step(`starting ${services.length} service${services.length === 1 ? '' : 's'} again`)
  let failed = 0
  for (const one of services) {
    const path = `/projects/${one.project}/worktrees/${one.worktree}/services/${encodeURIComponent(one.name)}/start`
    const outcome = await api(now, 'POST', path).then(
      () => 'started',
      (cause) => {
        failed += 1
        return cause.message
      },
    )
    process.stdout.write(`  ${one.label}: ${outcome}\n`)
  }

  process.stdout.write(
    `\n  ${dot(failed ? 'alarm' : 'success')} updated ${before.slice(0, 7)} -> ${after.slice(0, 7)}${failed ? `, ${failed} service${failed === 1 ? '' : 's'} did not start` : ''}\n\n`,
  )
  process.exit(failed ? 1 : 0)
}

if (command === 'stop') {
  if (!(await answering())) {
    process.stdout.write(`\n  ${dot('alarm')} ccwt is not running\n\n`)
    process.exit(0)
  }

  process.kill(running.pid, 'SIGTERM')

  const deadline = Date.now() + STOP_WAIT_MS
  while (alive(running.pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  if (alive(running.pid)) {
    process.stderr.write(
      `\n  ${dot('alarm')} ccwt did not stop\n\n${row('pid', String(running.pid))}${row('kill', `kill -9 ${running.pid}`)}\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`\n  ${dot('success')} stopped\n\n${row('url', `http://localhost:${running.port}/`)}${row('pid', String(running.pid))}\n`)
  process.exit(0)
}

if (await answering()) {
  process.stderr.write(
    `\n  ccwt is already running on http://localhost:${running.port} (pid ${running.pid}).\n  One ccwt per machine: a second would supervise the same worktrees\n  and hand out the same ports. Open that one, or stop it first.\n\n`,
  )
  process.exit(1)
}

if (!(await isFree(port, host))) {
  process.stderr.write(`\n  Port ${port} is already in use by something else.\n  Try \`ccwt --port ${port + 1}\`, or set another one in Settings.\n\n`)
  process.exit(1)
}

if (values.detach) {
  const logDir = join(dir, 'logs')
  const logFile = join(logDir, 'ccwt.log')

  await mkdir(logDir, { recursive: true, mode: 0o700 })

  const sink = openSync(logFile, 'a')
  const dropped = new Set(
    tokens
      .filter((token) => token.kind === 'positional' || (token.kind === 'option' && token.name === 'detach'))
      .map((token) => token.index),
  )
  const args = process.argv.slice(2).filter((_, index) => !dropped.has(index))

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', sink, sink],
    env: process.env,
  })

  let died = null
  child.once('exit', (code) => {
    died = code ?? 1
  })

  await new Promise((resolve) => setTimeout(resolve, 750))
  closeSync(sink)

  if (died !== null) {
    process.stderr.write(
      `\n${banner}\n\n  ${dot('alarm')} could not start\n\n${row('code', String(died))}${row('logs', tilde(logFile))}\n`,
    )
    process.exit(1)
  }

  child.unref()

  process.stdout.write(
    `\n${banner}\n\n  ${dot('success')} running in the background\n\n${row('url', link(`http://localhost:${port}/`))}${row('pid', String(child.pid))}${row('logs', tilde(logFile))}${row('stop', 'ccwt stop')}\n`,
  )
  process.exit(0)
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

const url = `http://localhost:${port}/`

if (values.dev) {
  startNuxtDev(port, host)
  process.stdout.write(
    `\n${banner}\n\n  ${dot('success')} listening\n\n${row('url', link(url))}\n${faint('  Its handshake is written, so Claude Code can reach it.')}\n\n`,
  )
} else {
  const server = join(root, '.output/server/index.mjs')

  await import(server).catch((cause) => {
    process.stderr.write(`\n  Could not start the server from ${server}\n  ${cause.message}\n\n  Run \`npm run build\` first, or \`npm run dev\` to run from source.\n\n`)
    process.exit(1)
  })

  process.stdout.write(
    `\n${banner}\n\n  ${dot('success')} listening\n\n${row('url', link(url))}\n${faint('  Open it in any browser.')}\n\n`,
  )
}

if (values.open) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
}
