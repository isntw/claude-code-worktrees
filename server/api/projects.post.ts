import { detectDefaultBranch, detectPackageManager } from '../lib/detect'
import { repoRoot } from '../lib/git'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ rootPath?: string }>(event)
  const rootPath = body?.rootPath?.trim()

  if (!rootPath) {
    throw createError({ statusCode: 400, statusMessage: 'rootPath is required' })
  }

  return guard(async () => {
    const root = await repoRoot(rootPath)
    if (!root) {
      throw createError({ statusCode: 400, statusMessage: 'Not a git repository' })
    }

    await detectPackageManager(root)
    await detectDefaultBranch(root)
  })
})
