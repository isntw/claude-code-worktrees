import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BEGIN = '# >>> ccwt (generated — edits between these markers are replaced)'
const END = '# <<< ccwt'

export const ENV_FILE = '.env.local'

export function envKey(prefix: string, service: string): string {
  return `${prefix}_${service.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`
}

export function buildBlock(ports: Record<string, number>): string {
  const lines: string[] = [BEGIN]

  for (const [name, port] of Object.entries(ports).sort()) {
    lines.push(`${envKey('CCWT_PORT', name)}=${port}`)
    lines.push(`${envKey('CCWT_URL', name)}=http://localhost:${port}`)
  }

  lines.push(END, '')
  return lines.join('\n')
}

function strip(existing: string): string {
  const start = existing.indexOf(BEGIN)
  if (start === -1) return existing

  const end = existing.indexOf(END, start)
  if (end === -1) return existing.slice(0, start)

  return existing.slice(0, start) + existing.slice(end + END.length).replace(/^\n/, '')
}

export async function writeEnvBlock(
  worktreePath: string,
  ports: Record<string, number>,
): Promise<string> {
  const path = join(worktreePath, ENV_FILE)
  const existing = await readFile(path, 'utf8').catch(() => '')
  const kept = strip(existing).replace(/\s*$/, '')
  const block = buildBlock(ports)

  const next = kept ? `${kept}\n\n${block}` : block
  await writeFile(path, next, { mode: 0o600 })
  return path
}
