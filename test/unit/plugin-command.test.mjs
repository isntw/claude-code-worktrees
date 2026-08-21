import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

const withConfig = async (dir, work) => {
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = dir
  try {
    return await work()
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
}

const withSession = async (inside, work) => {
  const previous = process.env.CLAUDECODE
  const child = process.env.CLAUDE_CODE_CHILD_SESSION
  if (inside) process.env.CLAUDECODE = '1'
  else {
    delete process.env.CLAUDECODE
    delete process.env.CLAUDE_CODE_CHILD_SESSION
  }
  try {
    return await work()
  } finally {
    if (previous === undefined) delete process.env.CLAUDECODE
    else process.env.CLAUDECODE = previous
    if (child === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION
    else process.env.CLAUDE_CODE_CHILD_SESSION = child
  }
}

const tree = () => {
  const root = mkdtempSync(join(tmpdir(), 'ccwt-hash-'))
  mkdirSync(join(root, 'nested', '.git'), { recursive: true })
  mkdirSync(join(root, '.git'), { recursive: true })
  writeFileSync(join(root, 'a.txt'), 'alpha\n')
  writeFileSync(join(root, 'empty.txt'), '')
  writeFileSync(join(root, 'nested', 'b.txt'), 'beta\n')
  writeFileSync(join(root, 'nested', '.git', 'keep'), 'kept\n')
  writeFileSync(join(root, '.git', 'ignored'), 'ignored\n')
  symlinkSync('a.txt', join(root, 'link'))
  return root
}

const consentFile = (dir, command) => {
  mkdirSync(join(dir, 'plugins'), { recursive: true })
  writeFileSync(
    join(dir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'ccwt@ccwt': [{ scope: 'user', version: 'aaaaaaaaaaaa', sourceCommand: command }],
      },
    }),
  )
}

test('the content hash is the one Claude Code records as the version of a command-sourced plugin', async () => {
  const root = tree()
  try {
    assert.equal(await plugin.contentHash(root), 'df38a973e38d')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a .git at the top of the producer directory is not hashed, but one nested inside it is', async () => {
  const root = tree()
  try {
    const before = await plugin.contentHash(root)

    writeFileSync(join(root, '.git', 'ignored'), 'something else entirely\n')
    assert.equal(await plugin.contentHash(root), before, 'the top-level .git must not count')

    writeFileSync(join(root, 'nested', '.git', 'keep'), 'something else entirely\n')
    assert.notEqual(await plugin.contentHash(root), before, 'a nested .git must count')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a directory that cannot be read hashes to nothing rather than throwing', async () => {
  assert.equal(await plugin.contentHash(join(tmpdir(), 'ccwt-nothing-here-at-all')), null)
})

test('the available version carries the manifest version when the plugin declares one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccwt-root-'))
  try {
    mkdirSync(join(root, 'plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(join(root, 'plugin', 'marker'), 'one\n')

    writeFileSync(join(root, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ccwt' }))
    const bare = await withRoot(root, () => plugin.availableVersion())
    assert.match(bare, /^[0-9a-f]{12}$/)

    writeFileSync(
      join(root, 'plugin', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'ccwt', version: '9.9.9' }),
    )
    const named = await withRoot(root, () => plugin.availableVersion())
    assert.match(named, /^9\.9\.9-[0-9a-f]{12}$/)
    assert.notEqual(named.slice(6), bare, 'the manifest is hashed too, so the hash moves with it')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an installed version that is not what the source would produce is outdated, not installed', () => {
  const found = { id: 'ccwt@ccwt', version: '52cf4cda628b' }

  assert.equal(plugin.stateOf(found, '52cf4cda628b'), 'installed')
  assert.equal(plugin.stateOf(found, '1ab8e81d8848'), 'outdated')
  assert.equal(plugin.stateOf(null, '1ab8e81d8848'), 'absent')
  assert.equal(plugin.stateOf({ ...found, enabled: false }, '1ab8e81d8848'), 'disabled')
})

test('a source whose hash cannot be taken never makes an installed plugin look stale', () => {
  assert.equal(plugin.stateOf({ id: 'ccwt@ccwt', version: '52cf4cda628b' }, null), 'installed')
  assert.equal(plugin.stateOf({ id: 'ccwt@ccwt' }, '52cf4cda628b'), 'installed')
})

test('approval reads the command Claude Code recorded, which is the only record of consent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-claude-'))
  try {
    await withRoot('/opt/ccwt', async () => {
      await withConfig(dir, async () => {
        const none = await plugin.approval()
        assert.equal(none.accepted, null)
        assert.equal(none.granted, false)

        consentFile(dir, plugin.pluginCommand())
        const same = await plugin.approval()
        assert.equal(same.accepted, plugin.pluginCommand())
        assert.equal(same.granted, true)

        consentFile(dir, 'node /somewhere/else/bin/ccwt.mjs --plugin-path')
        const moved = await plugin.approval()
        assert.equal(moved.accepted, 'node /somewhere/else/bin/ccwt.mjs --plugin-path')
        assert.equal(moved.granted, false)
      })
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ccwt can only accept the command for you when it is not itself inside a Claude Code session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-claude-'))
  try {
    await withConfig(dir, async () => {
      assert.equal((await withSession(true, () => plugin.approval())).askable, false)
      assert.equal((await withSession(false, () => plugin.approval())).askable, true)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreviewed command ccwt cannot accept is reported before anything is run', () => {
  const never = plugin.issuesFor({
    state: 'absent',
    version: '2.1.238',
    consent: { command: 'node /opt/ccwt/bin/ccwt.mjs --plugin-path', accepted: null, granted: false, askable: false },
    installed: null,
    available: 'aaaaaaaaaaaa',
  })

  assert.equal(never.length, 1)
  assert.equal(never[0].code, 'plugin.needs-approval')
  assert.match(never[0].message, /never been shown/)
  assert.match(never[0].hint, /claude plugin install ccwt@ccwt --scope user -y/)

  const changed = plugin.issuesFor({
    state: 'installed',
    version: '2.1.238',
    consent: {
      command: 'node /opt/ccwt/bin/ccwt.mjs --plugin-path',
      accepted: 'node /old/ccwt/bin/ccwt.mjs --plugin-path',
      granted: false,
      askable: false,
    },
    installed: 'aaaaaaaaaaaa',
    available: 'aaaaaaaaaaaa',
  })

  assert.equal(changed[0].code, 'plugin.needs-approval')
  assert.match(changed[0].message, /accepted a different command/)
  assert.match(changed[0].message, /\/old\/ccwt\/bin\/ccwt\.mjs/)
  assert.match(changed[0].hint, /claude plugin update ccwt@ccwt/)
})

test('a command ccwt can accept itself is not reported as needing approval', () => {
  const said = plugin.issuesFor({
    state: 'absent',
    version: '2.1.238',
    consent: { command: 'node /opt/ccwt/bin/ccwt.mjs --plugin-path', accepted: null, granted: false, askable: true },
    installed: null,
    available: 'aaaaaaaaaaaa',
  })

  assert.deepEqual(said, [])
})

test('a stale install says which hash is installed and which one it would be handed', () => {
  const said = plugin.issuesFor({
    state: 'outdated',
    version: '2.1.238',
    consent: { command: 'node /opt/ccwt/bin/ccwt.mjs --plugin-path', accepted: 'node /opt/ccwt/bin/ccwt.mjs --plugin-path', granted: true, askable: true },
    installed: '52cf4cda628b',
    available: '1ab8e81d8848',
  })

  assert.equal(said.length, 1)
  assert.equal(said[0].code, 'plugin.outdated')
  assert.equal(said[0].severity, 'info')
  assert.match(said[0].message, /52cf4cda628b/)
  assert.match(said[0].message, /1ab8e81d8848/)
})

test('an approval that is still owed outranks a stale install, because the refresh needs it first', () => {
  const said = plugin.issuesFor({
    state: 'outdated',
    version: '2.1.238',
    consent: { command: 'node /opt/ccwt/bin/ccwt.mjs --plugin-path', accepted: 'node /old/ccwt/bin/ccwt.mjs --plugin-path', granted: false, askable: false },
    installed: '52cf4cda628b',
    available: '1ab8e81d8848',
  })

  assert.equal(said[0].code, 'plugin.needs-approval')
})

test('the parts on show name the copy Claude Code installed, not the one ccwt ships', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccwt-installed-'))
  try {
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    mkdirSync(join(dir, 'skills', 'made-up-skill'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'made-up-skill', 'SKILL.md'), '---\nname: made-up-skill\n---\n')
    writeFileSync(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'ccwt', mcpServers: { ccwt: {} } }),
    )

    await withRoot(process.cwd(), async () => {
      const shipped = await plugin.parts(null)
      assert.equal(shipped.origin, 'shipped')
      assert.equal(shipped.from, join(process.cwd(), 'plugin'))

      const there = await plugin.parts({ id: 'ccwt@ccwt', installPath: dir })
      assert.equal(there.origin, 'installed')
      assert.equal(there.from, dir)
      assert.deepEqual(
        there.skills.map((skill) => skill.name),
        ['made-up-skill'],
        'the skills listed must be the installed ones, whatever ccwt ships',
      )

      const gone = await plugin.parts({ id: 'ccwt@ccwt', installPath: join(dir, 'not-there') })
      assert.equal(gone.origin, 'shipped', 'an install path that is gone falls back, and says so')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
