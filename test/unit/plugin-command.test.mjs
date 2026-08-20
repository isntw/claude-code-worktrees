import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { withHome } from '../helpers/home.mjs'
import { importLib } from '../helpers/tslib.mjs'

const plugin = await importLib('plugin')
const requirements = await importLib('requirements')

const CLAUDE_MIN = '2.1.229'

const withRoot = async (root, work) => {
  const previous = process.env.CCWT_ROOT
  process.env.CCWT_ROOT = root
  try {
    return await work()
  } finally {
    if (previous === undefined) delete process.env.CCWT_ROOT
    else process.env.CCWT_ROOT = previous
  }
}

test('the command names the launcher of the ccwt that is running, not the working directory', async () => {
  await withRoot('/opt/ccwt', () => {
    const command = plugin.pluginCommand()
    assert.ok(command.includes('/opt/ccwt/bin/ccwt.mjs'), command)
    assert.ok(command.endsWith('--plugin-path'), command)
    assert.ok(command.startsWith(process.execPath), command)
  })
})

test('a command Claude Code would accept is reported usable', async () => {
  await withRoot('/opt/ccwt', () => {
    assert.equal(plugin.unusable(plugin.pluginCommand()), null)
  })
})

test('a command longer than Claude Code allows is refused with its length', () => {
  const said = plugin.unusable(`node ${'a'.repeat(600)} --plugin-path`)
  assert.ok(said, 'expected a refusal')
  assert.match(said, /over the 500 allowed/)
})

test('a command that is not printable ASCII is refused, since an accented path is the usual cause', () => {
  assert.match(plugin.unusable('node /Users/renée/ccwt/bin/ccwt.mjs --plugin-path'), /printable ASCII/)
})

test('a run of four spaces is refused, because it is what makes a command unreviewable', () => {
  assert.match(plugin.unusable('node    /opt/ccwt/bin/ccwt.mjs --plugin-path'), /four or more spaces/)
})

test('the Claude Code floor is read the way the version gate reads it', () => {
  assert.equal(requirements.parseVersion('2.1.237 (Claude Code)'), '2.1.237')
  assert.equal(requirements.below('2.1.237', CLAUDE_MIN), false)
  assert.equal(requirements.below('2.1.229', CLAUDE_MIN), false)
  assert.equal(requirements.below('2.1.228', CLAUDE_MIN), true)
  assert.equal(requirements.below('2.1.4', CLAUDE_MIN), true)
  assert.equal(requirements.below('2.2.0', CLAUDE_MIN), false)
})

test('the commands ccwt says it will run never include an update, because Claude Code owns that now', () => {
  const said = plugin.commands()
  assert.equal(said.length, 3)
  assert.ok(
    said.every((line) => !line.includes('plugin update')),
    said.join('\n'),
  )
  assert.match(said[2], /plugin install ccwt@ccwt --scope user -y/)
})

test('materialise writes a marketplace naming the command, and copies no plugin', async () => {
  await withHome(async (home) => {
    await withRoot(process.cwd(), async () => {
      await plugin.materialise()

      const target = join(home, 'plugin')
      const written = JSON.parse(
        readFileSync(join(target, '.claude-plugin', 'marketplace.json'), 'utf8'),
      )

      const entry = written.plugins.find((candidate) => candidate.name === 'ccwt')
      assert.equal(entry.source.source, 'command')
      assert.equal(entry.source.command, plugin.pluginCommand())

      const template = JSON.parse(
        readFileSync(join(process.cwd(), '.claude-plugin', 'marketplace.json'), 'utf8'),
      )
      assert.equal(written.name, template.name)
      assert.equal(entry.description, template.plugins[0].description)

      assert.equal(
        existsSync(join(target, 'plugin')),
        false,
        'the plugin must not be copied — Claude Code fetches it through the command',
      )
    })
  })
})
