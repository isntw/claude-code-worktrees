#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))

const { version } = await read('package.json')
if (typeof version !== 'string' || !version) {
  process.stderr.write('package.json declares no version, so the plugin cannot be stamped.\n')
  process.exit(1)
}

const manifestPath = join(root, 'plugin', '.claude-plugin', 'plugin.json')
const manifest = await read('plugin/.claude-plugin/plugin.json')

if (manifest.version !== version) {
  const { name, version: _was, ...rest } = manifest
  await writeFile(manifestPath, `${JSON.stringify({ name, version, ...rest }, null, 2)}\n`)
}

const result = spawnSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [
    'plugin/src/mcp/server.ts',
    'plugin/src/hooks/ccwt.ts',
    '--bundle',
    '--platform=node',
    '--target=node24',
    '--format=esm',
    '--outdir=plugin',
    '--outbase=plugin/src',
    '--out-extension:.js=.mjs',
    '--banner:js=#!/usr/bin/env node',
    `--define:VERSION=${JSON.stringify(version)}`,
    '--log-level=warning',
  ],
  { cwd: root, stdio: 'inherit' },
)

process.exit(result.status ?? 1)
