import type { CcwtConfig, Setup, SetupNote } from '../../shared/types'
import { ENV_FILE, envKey } from './envfile'

import { findCompose, fixedPorts, isWorktreeReady, portVariables, runnableFromWorktree } from './compose'
import { findHardcodedAddresses } from './inspect'

export async function describeSetup(rootPath: string, config: CcwtConfig): Promise<Setup> {
  const notes: SetupNote[] = []
  const names = config.services.map((service) => service.name)

  if (names.length === 0) {
    return {
      portMode: 'none',
      headline: 'No dev server detected.',
      notes: [
        {
          tone: 'info',
          title: 'Worktrees still work',
          body: 'ccwt can create, provision and remove worktrees for this project. It just has nothing to run in them yet.',
        },
        {
          tone: 'info',
          title: 'To get a dev server',
          body: 'Add a `dev`, `start` or `serve` script to package.json, or describe the command yourself in the recipe.',
        },
      ],
    }
  }

  notes.push({
    tone: 'good',
    title: names.length === 1 ? 'One service' : `${names.length} services`,
    body: `Each worktree runs ${names.map((name) => `\`${name}\``).join(' and ')}. ccwt picks a free port per service, per worktree, and remembers it.`,
  })

  notes.push({
    tone: 'info',
    title: 'How a worktree learns its ports',
    body: `Every service is started with its port in the environment, and ccwt writes the same values into \`${ENV_FILE}\` inside the worktree — which Vite, Next and Nuxt read automatically.`,
    snippet: names
      .map((name) => `${envKey('CCWT_URL', name)}=http://localhost:…`)
      .join('\n'),
  })

  const compose = await findCompose(rootPath)
  const stack = compose[0]
  let composeFixed: string[] = []

  if (stack) {
    const KIND: Record<string, string> = {
      app: 'the app',
      database: 'a database',
      cache: 'a cache',
      proxy: 'a web server',
      support: 'a supporting service',
      other: '',
    }

    const lines = stack.services.map((service) => {
      const what = service.image ?? (service.built ? 'built here' : 'unknown image')
      const published = service.ports.length
        ? service.ports.map((port) => `${port.host}→${port.container}`).join(', ')
        : 'no published port'
      const role = KIND[service.kind]
      return `${service.name}  ${what}${role ? `  (${role})` : ''}  ${published}`
    })

    notes.push({
      tone: 'info',
      title: `${stack.file} runs ${stack.services.length} containers`,
      body: `ccwt starts the whole stack as one service and gives it a per-worktree project name, so containers, networks and volumes do not collide between worktrees.`,
      snippet: lines.join('\n'),
    })

    const variables = portVariables(stack)
    const fixed = fixedPorts(stack)
    const ready = isWorktreeReady(stack.file)
    composeFixed = fixed.map((entry) => `${entry.service} ${entry.host}`)

    if (variables.length) {
      notes.push({
        tone: 'good',
        title: 'Published ports come from the environment',
        body: `ccwt gives each worktree its own value for these and exports them when it starts the stack, so Compose substitutes them. Container-side ports are untouched, which is why \`DB_HOST=db\` and \`REDIS_HOST=redis\` keep working.`,
        snippet: variables.map((v) => `${v.name} → ${v.service}:${v.container}`).join('\n'),
      })
    }

    if (fixed.length) {
      notes.push({
        tone: 'caution',
        title: ready ? 'Some ports are still written into the file' : 'This compose file is not worktree-ready',
        body: `A published port written as a number is the same in every worktree, so two worktrees cannot run the stack at once. Give each one a variable with a default and ccwt will allocate it.`,
        snippet: fixed
          .map(
            (entry) =>
              `${entry.service}  "${entry.host}:…"  →  "\${${entry.service.toUpperCase()}_PORT:-${entry.host}}:…"`,
          )
          .join('\n'),
      })
    }

    for (const other of compose.filter((c) => c !== stack && !runnableFromWorktree(c))) {
      notes.push({
        tone: 'info',
        title: `${other.file} was skipped`,
        body: `It reaches into \`.worktrees/\`, so it is written to be started from the repository root with the worktree named in a variable. ccwt starts a stack from inside the worktree, where that path does not exist.`,
        snippet: other.rootOriented.join('\n'),
      })
    }

    if (!runnableFromWorktree(stack)) {
      notes.push({
        tone: 'caution',
        title: `${stack.file} is written to run from the repository root`,
        body: `It reaches into \`.worktrees/\`, so it expects to be started from the root with the worktree named in a variable. ccwt starts a stack from inside the worktree, where those paths do not exist. Commit a \`docker-compose.ccwt.yml\` whose paths are relative to the worktree itself and ccwt will prefer it.`,
        snippet: stack.rootOriented.join('\n'),
      })
    }

    if (stack.externalNetworks.length) {
      notes.push({
        tone: 'caution',
        title: 'The stack needs a network it does not create',
        body: `Compose refuses to start when an external network is missing. Create it once with \`docker network create <name>\` if a worktree fails to come up.`,
        snippet: stack.externalNetworks.join('\n'),
      })
    }
  }

  const { addresses } = await findHardcodedAddresses(rootPath)
  const ours = new Set(config.services.flatMap((service) => service.portRange))
  const crossService = addresses.filter((address) => !ours.has(address.port))

  if (crossService.length === 0) {
    return composeFixed.length
      ? {
          portMode: 'fixed',
          headline: `Works as-is — one worktree at a time, because ${composeFixed.length === 1 ? 'a published port is' : 'some published ports are'} fixed in the compose file.`,
          notes,
        }
      : {
          portMode: 'allocated',
          headline: 'Nothing to configure — worktrees run side by side.',
          notes,
        }
  }

  const first = crossService[0]!

  notes.push({
    tone: 'caution',
    title: 'One address is fixed in the project',
    body: `\`${first.file}\` line ${first.line} points at port ${first.port} directly. Because that value is written into the file, every worktree points at the same place — so only one worktree of this project can serve at a time.`,
    snippet: first.text,
  })

  notes.push({
    tone: 'info',
    title: 'Optional — to run worktrees at the same time',
    body: `Let that line fall back to the environment instead of a fixed number. ccwt already provides it. This is entirely optional; ccwt works without it.`,
    snippet: `- 'http://127.0.0.1:${first.port}'\n+ process.env.${envKey('CCWT_URL', names[0] ?? 'server')} ?? 'http://127.0.0.1:${first.port}'`,
  })

  return {
    portMode: 'fixed',
    headline: 'Works as-is — but run one worktree at a time.',
    notes,
  }
}
