import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function makeHome() {
  return mkdtempSync(join(tmpdir(), 'ccwt-test-'))
}

export function dropHome(home) {
  rmSync(home, { recursive: true, force: true })
}

export async function withHome(work) {
  const home = makeHome()
  const previous = process.env.CCWT_HOME
  process.env.CCWT_HOME = home

  try {
    return await work(home)
  } finally {
    if (previous === undefined) delete process.env.CCWT_HOME
    else process.env.CCWT_HOME = previous
    dropHome(home)
  }
}

export function writeJson(home, name, value) {
  const path = join(home, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
  return path
}

export const LEGACY_PROJECTS = {
  version: 1,
  projects: [
    {
      id: 'aaa111',
      rootPath: '/repo/alpha',
      addedAt: '2026-01-01T00:00:00.000Z',
      config: {
        worktreesDir: '.claude/worktrees',
        provision: { copy: [], link: ['node_modules'], write: [], postCreate: [], postRemove: [] },
        services: [{ name: 'dev', cwd: '.', command: 'npm run dev', portRange: [5200, 5299] }],
        claude: { ownWorktreeCreation: false },
      },
      recipeRevision: 3,
    },
    { id: 'bbb222', rootPath: '/repo/beta', addedAt: '2026-01-02T00:00:00.000Z' },
  ],
}

export const LEGACY_CREDENTIAL = {
  token: 'gho_fake',
  login: 'isntw',
  scopes: ['repo'],
  savedAt: '2026-01-01T00:00:00.000Z',
  refreshToken: null,
  expiresAt: null,
}

export const LEGACY_SESSION = {
  at: '2026-01-01T00:00:00.000Z',
  rows: { 'alpha/dev': { port: 5276, up: true } },
  title: 'alpha',
}
