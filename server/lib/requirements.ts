import type { ToolCheck, ToolState } from '../../shared/types'
import { exec } from './exec'

const PROBE_MS = 5_000

interface Probe {
  name: string
  required: boolean
  minimum: string | null
  purpose: string
  install: string
  running?: string
}

const TOOLS: Probe[] = [
  {
    name: 'git',
    required: true,
    minimum: '2.20',
    purpose:
      'Creates, lists and removes every worktree, and remembers each service port in worktree-scoped config. Version 2.20 is where that config landed.',
    install: 'https://git-scm.com/downloads',
  },
  {
    name: 'node',
    required: true,
    minimum: '24',
    purpose:
      'Runs ccwt itself, and reads the store through the built-in node:sqlite, which needs 24. This is the version ccwt is executing on, not whichever one is first on PATH.',
    install: 'https://nodejs.org',
    running: process.versions.node,
  },
]

function parseVersion(text: string): string | null {
  const line = text.split('\n', 1)[0] ?? ''
  const match = /\d+(?:\.\d+)+/.exec(line)
  return match ? match[0]! : null
}

function below(version: string, minimum: string): boolean {
  const left = version.split('.')
  const right = minimum.split('.')
  const depth = Math.max(left.length, right.length)

  for (let index = 0; index < depth; index += 1) {
    const a = Number.parseInt(left[index] ?? '0', 10)
    const b = Number.parseInt(right[index] ?? '0', 10)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    if (a !== b) return a < b
  }

  return false
}

function rate(version: string | null, minimum: string | null): ToolState {
  return version !== null && minimum !== null && below(version, minimum) ? 'outdated' : 'present'
}

async function probe({ running, ...rest }: Probe): Promise<ToolCheck> {
  if (running !== undefined) {
    return { ...rest, version: running, state: rate(running, rest.minimum) }
  }

  const result = await exec(rest.name, ['--version'], { timeoutMs: PROBE_MS }).catch(() => null)
  if (!result || result.code !== 0) return { ...rest, state: 'missing', version: null }

  const version = parseVersion(result.stdout || result.stderr)
  return { ...rest, version, state: rate(version, rest.minimum) }
}

export function check(): Promise<ToolCheck[]> {
  return Promise.all(TOOLS.map(probe))
}
