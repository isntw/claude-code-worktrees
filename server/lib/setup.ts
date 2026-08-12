import type { CcwtConfig, Setup, SetupNote } from '../../shared/types'
import { ENV_FILE, envKey } from './envfile'
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

  const { addresses } = await findHardcodedAddresses(rootPath)
  const ours = new Set(config.services.flatMap((service) => service.portRange))
  const crossService = addresses.filter((address) => !ours.has(address.port))

  if (crossService.length === 0) {
    return {
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
