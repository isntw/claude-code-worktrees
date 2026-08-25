import type { Recipe, RecipeNote, Service } from '../../shared/types'
import { COMPOSE, STACK_PROJECT_NAME, isStack, variesPerWorktree } from '../../shared/compose'
import { ALWAYS_PER_WORKTREE } from './provision'

const PORT_TOKEN = '{{port}}'

function portSites(service: Service): string[] {
  const sites = service.command.includes(PORT_TOKEN) ? ['command'] : []

  for (const [name, value] of Object.entries(service.env ?? {})) {
    if (value.includes(PORT_TOKEN)) sites.push(`env.${name}`)
  }

  return sites
}

function stackNotes(service: Service, where: string): RecipeNote[] {
  const notes: RecipeNote[] = []
  const name = service.env?.COMPOSE_PROJECT_NAME

  if (name === undefined) {
    notes.push({
      path: `${where}.env.COMPOSE_PROJECT_NAME`,
      severity: 'warning',
      message: 'A container stack with no COMPOSE_PROJECT_NAME shares container names with every other worktree.',
      hint: `Set it to something that varies per worktree — \`${STACK_PROJECT_NAME}\`.`,
    })
  } else if (!variesPerWorktree(name)) {
    notes.push({
      path: `${where}.env.COMPOSE_PROJECT_NAME`,
      severity: 'warning',
      message: `\`${name}\` is the same in every worktree, so two worktrees would fight over the same containers.`,
      hint: `Include {{slug}}, {{branch}} or {{worktreePath}} — \`${STACK_PROJECT_NAME}\`.`,
    })
  }

  if (!service.stopCommand) {
    notes.push({
      path: `${where}.stopCommand`,
      severity: 'warning',
      message: 'Killing the process group leaves the containers up.',
      hint: 'Give the stack a `stopCommand` that brings it down.',
    })
  }

  return notes
}

function serviceNotes(service: Service, index: number): RecipeNote[] {
  const where = `services.${index}`
  const notes: RecipeNote[] = []

  if (isStack(service.kind, service.command)) {
    notes.push(...stackNotes(service, where))
  } else if (COMPOSE.test(service.command) && service.kind !== 'stack') {
    notes.push({
      path: `${where}.kind`,
      severity: 'info',
      message: 'This command drives compose but the service is not marked as a stack.',
      hint: 'Set `kind` to "stack" so ccwt reports it as one.',
    })
  }

  const sites = portSites(service)

  if (!sites.length) {
    const pinned = service.portRange[0] === service.portRange[1]
    notes.push({
      path: `${where}.command`,
      severity: pinned ? 'info' : 'warning',
      message: `ccwt allocates a port for \`${service.name}\` but nothing passes it on, so the service will not hear about it.`,
      hint: `Put ${PORT_TOKEN} in the command, or map it to a variable under \`env\`.`,
    })
  } else if (sites.length > 1) {
    notes.push({
      path: `${where}.env`,
      severity: 'warning',
      message: `The port reaches \`${service.name}\` ${sites.length} ways — ${sites.join(', ')}. Set it once.`,
      hint: 'A second copy is not free: a port-picking library reads a variable like `PORT` as the preferred port for any socket it allocates, so a sidecar can take the port the app was given.',
    })
  }

  return notes
}

function provisionNotes(recipe: Recipe): RecipeNote[] {
  const notes: RecipeNote[] = []

  recipe.provision.link.forEach((entry, index) => {
    if ((ALWAYS_PER_WORKTREE as readonly string[]).includes(entry)) {
      notes.push({
        path: `provision.link.${index}`,
        severity: 'warning',
        message: `\`${entry}\` is always per-worktree, so linking it is refused at provision time.`,
        hint: 'Drop it from `link`; ccwt leaves build caches to each worktree.',
      })
    }

    if (/^\.env(\.|$)/.test(entry)) {
      notes.push({
        path: `provision.link.${index}`,
        severity: 'info',
        message: `\`${entry}\` is hardlinked, which is the same inode — editing it in a worktree edits the root checkout.`,
        hint: 'Move it to `copy` unless every worktree is meant to share one file.',
      })
    }
  })

  const installs = recipe.provision.postCreate.length > 0
  if (!recipe.provision.link.length && !recipe.provision.copy.length && !installs) {
    notes.push({
      path: 'provision',
      severity: 'info',
      message: 'This recipe places no files and runs nothing, so a new worktree gets a bare checkout.',
      hint: 'Name what a worktree needs under `copy`, `link` or `postCreate`.',
    })
  }

  return notes
}

function primaryNotes(recipe: Recipe): RecipeNote[] {
  const withPort = recipe.services.filter((service) => service.portRange.length === 2)
  const [first] = withPort

  if (withPort.length < 2 || !first) return []
  if (withPort.some((service) => service.primary)) return []

  return [
    {
      path: 'services',
      severity: 'info',
      message: `No service is marked primary, so a worktree reports \`${first.name}\` — the first one listed — as its port.`,
      hint: 'Mark the one somebody opens in a browser as `primary`.',
    },
  ]
}

export function noteRecipe(recipe: Recipe): RecipeNote[] {
  return [
    ...recipe.services.flatMap(serviceNotes),
    ...primaryNotes(recipe),
    ...provisionNotes(recipe),
  ]
}
