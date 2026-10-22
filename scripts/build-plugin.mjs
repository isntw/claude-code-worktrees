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

const manifest = await read('plugin/.claude-plugin/plugin.json')
if (manifest.version !== version) {
  const { $schema, name, version: _was, ...rest } = manifest
  await writeFile(
    join(root, 'plugin', '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ $schema, name, version, ...rest }, null, 2)}\n`,
  )
}

const esbuild = (entries, flags) =>
  spawnSync(
    join(root, 'node_modules', '.bin', 'esbuild'),
    [
      ...entries,
      '--bundle',
      '--platform=node',
      '--target=node24',
      '--format=esm',
      ...flags,
      `--define:VERSION=${JSON.stringify(version)}`,
      '--log-level=warning',
    ],
    { cwd: root, stdio: 'inherit' },
  ).status ?? 1

process.exit(
  esbuild(['plugin/src/mcp/server.ts', 'plugin/src/hooks/ccwt.ts'], [
    '--outdir=plugin',
    '--outbase=plugin/src',
    '--out-extension:.js=.mjs',
    '--banner:js=#!/usr/bin/env node',
  ]) || esbuild(['cli/ccwt.ts'], ['--outfile=bin/cli.mjs']),
)
