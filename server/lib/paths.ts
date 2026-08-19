import { homedir } from 'node:os'
import { join } from 'node:path'

export function stateDir(): string {
  return process.env.CCWT_HOME || join(homedir(), '.ccwt')
}

export function databasePath(): string {
  return join(stateDir(), 'ccwt.db')
}

export function runtimePath(): string {
  return join(stateDir(), 'runtime.json')
}

export function logsDir(): string {
  return join(stateDir(), 'logs')
}

export function fileKey(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'service'
}
