import type { Recipe, Setup, SetupNote } from '../../shared/types'
import { envKey } from './env'

import { findHardcodedAddresses } from './inspect'

export async function describeSetup(rootPath: string, recipe: Recipe | null): Promise<Setup> {
  const notes: SetupNote[] = []

  if (!recipe) {
    return {
      portMode: 'none',
      headline: 'No recipe yet.',
      notes: [
        {
          tone: 'info',
          title: 'Nothing is assumed about this project',
          body: 'ccwt reads nothing out of the repository and guesses nothing. Until a recipe says what a worktree of it needs, there is nothing to place and nothing to start.',
        },
        {
          tone: 'info',
          title: 'Write one, or ask Claude to',
          body: 'The recipe page takes it field by field. A session with the ccwt plugin can read the project and write it for you.',
        },
      ],
    }
  }

  const names = recipe.services.map((service) => service.name)

  if (names.length === 0) {
    return {
      portMode: 'none',
      headline: 'A recipe with no services.',
      notes: [
        {
          tone: 'info',
          title: 'Worktrees still work',
          body: 'ccwt places the files this recipe names and runs what it says on creation. It just has nothing to keep running afterwards.',
        },
        {
          tone: 'info',
          title: 'To get a dev server',
          body: 'Add a service to the recipe: the command to run, and the port range to run it on.',
        },
      ],
    }
  }

  const pinned = recipe.services.filter(
    (service) => service.portRange[0] === service.portRange[1],
  )

  notes.push({
    tone: 'good',
    title: names.length === 1 ? 'One service' : `${names.length} services`,
    body:
      pinned.length === recipe.services.length
        ? `Each worktree runs ${names.map((name) => `\`${name}\``).join(' and ')}, on the port you pinned it to.`
        : `Each worktree runs ${names.map((name) => `\`${name}\``).join(' and ')}. ccwt picks a free port per service, per worktree, and remembers it.`,
  })

  if (pinned.length) {
    notes.push({
      tone: 'caution',
      title: pinned.length === 1 ? 'One service is pinned to a single port' : 'Some services are pinned to a single port',
      body: `A pinned service has one port to use, so only one worktree can run it at a time. ccwt still watches that port: when something else is already listening there, the card says so instead of letting you start into a collision.`,
      snippet: pinned.map((service) => `${service.name}  port ${service.portRange[0]}`).join('\n'),
    })
  }

  notes.push({
    tone: 'info',
    title: 'How a worktree learns its ports',
    body: `Every service is started with its own port in \`PORT\`, and with every service's port and URL beside it — so one service can reach another without either of them hard-coding a number.`,
    snippet: names
      .map((name) => `${envKey('CCWT_URL', name)}=http://localhost:…`)
      .join('\n'),
  })

  const { addresses } = await findHardcodedAddresses(rootPath)
  const ours = new Set(recipe.services.flatMap((service) => service.portRange))
  const crossService = addresses.filter((address) => !ours.has(address.port))

  if (crossService.length === 0) {
    return pinned.length
      ? {
          portMode: 'fixed',
          headline: `Works as-is — one worktree at a time, because ${pinned.length === 1 ? 'a service is' : 'some services are'} pinned to a single port.`,
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
