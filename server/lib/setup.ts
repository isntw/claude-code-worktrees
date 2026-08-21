import type { Recipe, Service, Setup, SetupNote, Severity } from '../../shared/types'
import { isStack, variesPerWorktree } from '../../shared/compose'
import { envKey } from './env'
import type { HardcodedAddress } from './inspect'
import { findHardcodedAddresses } from './inspect'
import { noteRecipe } from './lint'

interface Allocation {
  label: string
  variable: string | null
  service: Service
  range: [number, number]
}

const allocationsOf = (service: Service): Allocation[] => [
  { label: service.name, variable: null, service, range: service.portRange },
  ...Object.entries(service.ports ?? {}).map(([variable, range]) => ({
    label: `${service.name}.${variable}`,
    variable,
    service,
    range,
  })),
]

const allocations = (recipe: Recipe): Allocation[] => recipe.services.flatMap(allocationsOf)

const isPinned = (range: [number, number]): boolean => range[0] === range[1]

const stacksOf = (recipe: Recipe): Service[] =>
  recipe.services.filter((service) => isStack(service.kind, service.command))

const sharedContainers = (recipe: Recipe): Service[] =>
  stacksOf(recipe).filter((service) => {
    const name = service.env?.COMPOSE_PROJECT_NAME
    return name === undefined || !variesPerWorktree(name)
  })

function columns(rows: string[][]): string {
  const width = (at: number) => Math.max(...rows.map((row) => (row[at] ?? '').length))
  const widths = rows.map((row) => row.length).reduce((most, next) => Math.max(most, next), 0)

  return rows
    .map((row) =>
      row
        .map((cell, at) => (at === row.length - 1 && at === widths - 1 ? cell : cell.padEnd(width(at))))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}

function fileNotes(recipe: Recipe): SetupNote[] {
  const { copy, link, write, postCreate, postRemove } = recipe.provision
  const notes: SetupNote[] = []

  const placed: [string, string][] = [
    ...copy.map((path): [string, string] => [path, 'copied']),
    ...link.map((path): [string, string] => [path, 'hardlinked']),
    ...write.map((entry): [string, string] => [entry.path, 'written']),
  ]

  if (placed.length) {
    notes.push({
      topic: 'files',
      tone: 'good',
      title: placed.length === 1 ? 'One thing is placed' : `${placed.length} things are placed`,
      body: link.length ? 'A hardlink is the same inode as the root checkout.' : undefined,
      snippet: columns(placed),
    })
  }

  if (postCreate.length) {
    notes.push({
      topic: 'files',
      tone: 'good',
      title: postCreate.length === 1 ? 'One command runs once' : `${postCreate.length} commands run once`,
      body: 'Only in a worktree ccwt created, and a failure does not stop creation.',
      snippet: postCreate.join('\n'),
    })
  }

  if (postRemove.length) {
    notes.push({
      topic: 'files',
      tone: 'info',
      title: 'Something runs on the way out',
      body: 'Nothing on the way out can block a removal.',
      snippet: postRemove.join('\n'),
    })
  }

  return notes
}

function nothingRuns(recipe: Recipe): SetupNote[] {
  return [
    ...fileNotes(recipe),
    {
      topic: 'services',
      tone: 'info',
      title: 'Nothing keeps running',
      body: 'This recipe places its files and runs what it says on creation. Add a service — a command and a port range — to have something serving afterwards.',
    },
  ]
}

function markersFor(service: Service): string {
  const marks: string[] = []
  if (isStack(service.kind, service.command)) marks.push('stack')
  if (service.dependsOn?.length) marks.push(`after ${service.dependsOn.join(', ')}`)

  return marks.join(', ')
}

function serviceNotes(recipe: Recipe): SetupNote[] {
  const spread = allocations(recipe)
  const fixed = spread.filter((one) => isPinned(one.range))

  return [
    {
      topic: 'services',
      tone: 'good',
      title: recipe.services.length === 1 ? 'One service' : `${recipe.services.length} services`,
      body:
        fixed.length === spread.length
          ? undefined
          : fixed.length
            ? 'A range gets a free port per worktree, remembered; a pinned one is the port it says.'
            : 'ccwt picks a free port for each, per worktree, and remembers it.',
      snippet: columns(
        spread.map((one) => [
          one.label,
          isPinned(one.range) ? `pinned ${one.range[0]}` : `any free ${one.range[0]}-${one.range[1]}`,
          one.variable === null ? markersFor(one.service) : '',
        ]),
      ),
    },
  ]
}

function ownerOf(recipe: Recipe, port: number): string {
  const holds = allocations(recipe).find((one) => port >= one.range[0] && port <= one.range[1])

  return holds?.service.name ?? recipe.services[0]?.name ?? 'server'
}

const MAX_ADDRESSES = 3

interface Concurrency {
  pinned: Allocation[]
  shared: Service[]
  addresses: HardcodedAddress[]
  configurable: boolean
}

function togetherNotes(recipe: Recipe, { pinned, shared, addresses, configurable }: Concurrency): SetupNote[] {
  const notes: SetupNote[] = []

  if (pinned.length) {
    notes.push({
      topic: 'together',
      tone: 'caution',
      title: pinned.length === 1 ? 'One port is pinned' : `${pinned.length} ports are pinned`,
      body: 'One worktree can hold it at a time, and ccwt says so rather than starting into a collision.',
      snippet: columns(pinned.map((one): [string, string] => [one.label, String(one.range[0])])),
    })
  }

  if (addresses.length) {
    const first = addresses[0]!

    notes.push({
      topic: 'together',
      tone: 'caution',
      title:
        addresses.length === 1
          ? 'One address is fixed in the project'
          : `${addresses.length} addresses are fixed in the project`,
      body: `The port is written into the file, so every worktree points at the same place.`,
      snippet: addresses
        .slice(0, MAX_ADDRESSES)
        .map((address) => `${address.file}:${address.line}  ${address.text}`)
        .join('\n'),
    })

    notes.push({
      topic: 'together',
      tone: 'info',
      title: 'Optional — to run worktrees at the same time',
      body: configurable
        ? 'Let it fall back to the environment, as another line in these files already does.'
        : 'Let it fall back to the environment instead — ccwt provides the value.',
      snippet: `- 'http://127.0.0.1:${first.port}'\n+ process.env.${envKey('CCWT_URL', ownerOf(recipe, first.port))} ?? 'http://127.0.0.1:${first.port}'`,
    })
  }

  if (!pinned.length && !addresses.length && !shared.length) {
    notes.push({
      topic: 'together',
      tone: 'good',
      title: 'Two worktrees can serve at once',
      body: 'Every port is picked per worktree, and nothing ccwt reads names a fixed one.',
    })
  }

  return notes
}

const TONE: Record<Severity, SetupNote['tone']> = {
  info: 'info',
  warning: 'caution',
  error: 'caution',
}

const problemNotes = (recipe: Recipe): SetupNote[] =>
  noteRecipe(recipe).map((note) => ({
    topic: 'problems',
    tone: TONE[note.severity],
    title: note.path,
    body: note.hint ? `${note.message} ${note.hint}` : note.message,
  }))

function headlineFor({ pinned, shared, addresses }: Concurrency, problems: number): string {
  if (shared.length) {
    return shared.length === 1
      ? `One worktree at a time — a second would share \`${shared[0]!.name}\`’s containers.`
      : 'One worktree at a time — a second would share the same containers.'
  }

  if (pinned.length) {
    return `Works as-is — one worktree at a time, because ${pinned.length === 1 ? 'a port is' : 'some ports are'} pinned.`
  }

  if (addresses.length) return 'Works as-is — but run one worktree at a time.'

  return problems ? 'Worktrees run side by side.' : 'Nothing to configure — worktrees run side by side.'
}

export async function describeSetup(rootPath: string, recipe: Recipe | null): Promise<Setup> {
  if (!recipe) {
    return { portMode: 'none', headline: 'No recipe yet.', notes: [] }
  }

  if (recipe.services.length === 0) {
    return {
      portMode: 'none',
      headline: 'A recipe with no services.',
      notes: [...nothingRuns(recipe), ...problemNotes(recipe)],
    }
  }

  const found = await findHardcodedAddresses(rootPath)
  const pinned = allocations(recipe).filter((one) => isPinned(one.range))
  const ours = new Set(pinned.map((one) => one.range[0]))

  const concurrency: Concurrency = {
    pinned,
    shared: sharedContainers(recipe),
    addresses: found.addresses.filter((address) => !ours.has(address.port)),
    configurable: found.configurable,
  }

  const problems = problemNotes(recipe)

  const notes = [
    ...fileNotes(recipe),
    ...serviceNotes(recipe),
    ...togetherNotes(recipe, concurrency),
    ...problems,
  ]

  const alone = pinned.length || concurrency.addresses.length || concurrency.shared.length

  return {
    portMode: alone ? 'fixed' : 'allocated',
    headline: headlineFor(concurrency, problems.length),
    notes,
  }
}
