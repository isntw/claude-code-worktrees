import { listRecords } from '~~/server/lib/store'

export default defineEventHandler(async () => {
  const records = await listRecords()

  return {
    version: 1,
    projects: records.map((record) => ({
      id: record.id,
      rootPath: record.rootPath,
      addedAt: record.addedAt,
      recipe: record.recipe,
      recipeRevision: record.recipeRevision,
    })),
  }
})
