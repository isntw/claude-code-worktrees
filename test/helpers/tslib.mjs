import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

let staged

function rewrite(path) {
  const source = readFileSync(path, 'utf8')

  const fixed = source.replace(
    /(\bfrom\s+|\bimport\s*\()(['"])(\.\.?\/[^'"]*?)\2/g,
    (whole, lead, quote, target) =>
      /\.(ts|mjs|js|json)$/.test(target) ? whole : `${lead}${quote}${target}.ts${quote}`,
  )

  if (fixed !== source) writeFileSync(path, fixed)
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path)
      continue
    }
    if (path.endsWith('.ts')) rewrite(path)
  }
}

function stage() {
  if (staged) return staged

  const dir = join(root, '.tslib', String(process.pid))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  cpSync(join(root, 'server'), join(dir, 'server'), { recursive: true })
  cpSync(join(root, 'shared'), join(dir, 'shared'), { recursive: true })
  walk(join(dir, 'server'))
  walk(join(dir, 'shared'))

  process.once('exit', () => rmSync(dir, { recursive: true, force: true }))

  staged = dir
  return dir
}

export async function importLib(name) {
  const target = join(stage(), 'server', 'lib', `${name}.ts`)
  return import(pathToFileURL(target).href)
}

export function sourceOf(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}
