import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CcwtConfig } from '../../shared/types'
import { isIgnored } from './git'
import { containedDir } from './provision'

export async function worktreesExposed(
  rootPath: string,
  config: CcwtConfig | null,
): Promise<string | null> {
  const rel = config && containedDir(rootPath, config)
  if (!rel) return null

  return (await isIgnored(rootPath, `${rel}/`)) ? null : rel
}

export async function ignoreWorktrees(
  rootPath: string,
  config: CcwtConfig | null,
): Promise<void> {
  const rel = config && containedDir(rootPath, config)
  if (!rel) throw new Error('Worktrees do not land inside this repository, so nothing needs ignoring.')
  if (await isIgnored(rootPath, `${rel}/`)) throw new Error('Git already ignores the worktrees directory.')

  const path = join(rootPath, '.gitignore')
  const current = await readFile(path, 'utf8').catch(() => '')
  const padded = current && !current.endsWith('\n') ? `${current}\n` : current

  await writeFile(path, `${padded}${rel}/\n`)
}
