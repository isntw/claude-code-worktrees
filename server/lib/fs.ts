import { access, copyFile, lstat, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

export async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  )
}

export async function isSymlink(path: string): Promise<boolean> {
  return lstat(path).then(
    (info) => info.isSymbolicLink(),
    () => false,
  )
}

export async function readJsonSafe<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function copyInto(
  fromRoot: string,
  toRoot: string,
  relative: string,
): Promise<boolean> {
  const source = join(fromRoot, relative)
  if (!(await pathExists(source))) return false

  const target = join(toRoot, relative)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
  return true
}
