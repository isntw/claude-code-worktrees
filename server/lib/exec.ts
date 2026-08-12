import { spawn } from 'node:child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ExecOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export function exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
        }, options.timeoutMs)
      : null

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (cause) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(cause)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

export function git(cwd: string, args: string[]): Promise<ExecResult> {
  return exec('git', args, { cwd, timeoutMs: 60_000 })
}

export async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  const result = await git(cwd, args).catch(() => null)
  if (!result || result.code !== 0) return null
  return result.stdout.trim()
}

export function argv(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let has = false

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      has = true
      continue
    }
    if (char === ' ' || char === '\t') {
      if (has || current) out.push(current)
      current = ''
      has = false
      continue
    }
    current += char
  }

  if (has || current) out.push(current)
  return out
}
