import type { Project, Recipe, RecipeCheck, RecipeView } from '../../shared/types'
import type { RecipeIssue } from '../../shared/recipe-schema'
import { RECIPE_REVISION, parseRecipe } from '../../shared/recipe-schema'
import { suggestRecipe } from './detect'
import { noteRecipe } from './lint'
import { findRecord, updateRecord } from './store'

const MAX_BYTES = 256 * 1024

export function serialise(recipe: Recipe): string {
  return `${JSON.stringify(recipe, null, 2)}\n`
}

export async function readRecipe(project: Project): Promise<RecipeView> {
  const record = await findRecord(project.id)

  if (record?.recipe) {
    const stored = parseRecipe(record.recipe)
    const stale = (record.recipeRevision ?? 0) < RECIPE_REVISION

    if (stored.ok) {
      return {
        source: 'ccwt',
        text: serialise(stored.recipe),
        recipe: stored.recipe,
        issues: [],
        detected: false,
        stale,
      }
    }

    return {
      source: 'ccwt',
      text: serialise(record.recipe),
      recipe: await suggestRecipe(project.rootPath),
      issues: stored.issues,
      detected: false,
      stale,
    }
  }

  const suggested = await suggestRecipe(project.rootPath)

  return {
    source: 'detected',
    text: serialise(suggested),
    recipe: suggested,
    issues: [],
    detected: true,
    stale: false,
  }
}

export function checkRecipe(text: string): RecipeCheck {
  if (text.length > MAX_BYTES) {
    return {
      ok: false,
      issues: [
        {
          path: '(root)',
          message: `A recipe over ${Math.round(MAX_BYTES / 1024)} KB is not something ccwt keeps.`,
        },
      ],
      notes: [],
    }
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    return { ok: false, issues: [{ path: '(root)', message: (cause as Error).message }], notes: [] }
  }

  const parsed = parseRecipe(value)
  if (!parsed.ok) return { ok: false, issues: parsed.issues, notes: [] }

  return { ok: true, issues: [], notes: noteRecipe(parsed.recipe) }
}

export class RecipeInvalid extends Error {
  readonly issues: RecipeIssue[]

  constructor(issues: RecipeIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'RecipeInvalid'
    this.issues = issues
  }
}

export async function writeRecipe(project: Project, text: string): Promise<RecipeView> {
  if (text.length > MAX_BYTES) {
    throw new Error(`A recipe over ${Math.round(MAX_BYTES / 1024)} KB is not something ccwt keeps.`)
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new RecipeInvalid([{ path: '(root)', message: (cause as Error).message }])
  }

  const parsed = parseRecipe(value)
  if (!parsed.ok) throw new RecipeInvalid(parsed.issues)

  if (!(await updateRecord(project.id, { recipe: parsed.recipe, recipeRevision: RECIPE_REVISION }))) {
    throw new Error('No such project.')
  }

  return readRecipe(project)
}

export async function resetRecipe(project: Project): Promise<RecipeView> {
  await updateRecord(project.id, { recipe: undefined, recipeRevision: undefined })
  return readRecipe(project)
}
