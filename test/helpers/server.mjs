import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dropHome, makeHome } from './home.mjs'

const OUTPUT = fileURLToPath(new URL('../../.output/server/index.mjs', import.meta.url))
const TOKEN = 'test-token'
const BOOT_MS = 15_000

export const built = () => existsSync(OUTPUT)

export const NO_BUILD = 'needs `npm run build` first'

function freePort() {
  return new Promise((done) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

async function answers(port) {
  const deadline = Date.now() + BOOT_MS

  while (Date.now() < deadline) {
    const reached = await fetch(`http://127.0.0.1:${port}/api/requirements`, {
      headers: { Host: `127.0.0.1:${port}`, 'x-ccwt-token': TOKEN },
    }).catch(() => null)

    if (reached) return true
    await new Promise((done) => setTimeout(done, 200))
  }

  return false
}

export async function withServer(work, seed) {
  const home = makeHome()
  if (seed) seed(home)

  const port = await freePort()

  const child = spawn(process.execPath, [OUTPUT], {
    env: {
      ...process.env,
      CCWT_HOME: home,
      NITRO_PORT: String(port),
      NITRO_HOST: '127.0.0.1',
      PORT: String(port),
      HOST: '127.0.0.1',
      NUXT_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let log = ''
  child.stdout.on('data', (chunk) => (log += chunk))
  child.stderr.on('data', (chunk) => (log += chunk))

  const call = async (method, path, body) => {
    const headers = { Host: `127.0.0.1:${port}`, 'x-ccwt-token': TOKEN }
    if (body !== undefined) headers['content-type'] = 'application/json'

    const answered = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    const text = await answered.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }

    return { status: answered.status, body: parsed }
  }

  const naked = (path) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { Host: `127.0.0.1:${port}` } })

  try {
    if (!(await answers(port))) throw new Error(`the server never answered:\n${log}`)
    return await work({ call, naked, home, port, token: TOKEN, log: () => log })
  } finally {
    child.kill('SIGKILL')
    dropHome(home)
  }
}
