import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CANDIDATES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vue.config.js',
  'nuxt.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'proxy.conf.json',
  'angular.json',
  'svelte.config.js',
  'webpack.config.js',
  'package.json',
]

const LOOPBACK = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})/g
const READS_ENV = /process\.env|import\.meta\.env|loadEnv/

export interface HardcodedAddress {
  file: string
  line: number
  port: number
  text: string
}

export interface Inspection {
  addresses: HardcodedAddress[]
  configurable: boolean
}

export async function findHardcodedAddresses(rootPath: string): Promise<Inspection> {
  const addresses: HardcodedAddress[] = []
  let configurable = false

  for (const name of CANDIDATES) {
    const raw = await readFile(join(rootPath, name), 'utf8').catch(() => null)
    if (raw === null) continue

    const lines = raw.split('\n')

    lines.forEach((line, index) => {
      if (line.trimStart().startsWith('//')) return

      LOOPBACK.lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = LOOPBACK.exec(line)) !== null) {
        const port = Number.parseInt(match[1]!, 10)
        if (!Number.isFinite(port)) continue

        if (READS_ENV.test(line)) {
          configurable = true
          continue
        }

        addresses.push({ file: name, line: index + 1, port, text: line.trim().slice(0, 160) })
      }
    })
  }

  return { addresses, configurable }
}
