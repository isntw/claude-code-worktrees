import { ConfigConflict, ConfigInvalid, writeConfig } from '~~/server/lib/config'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)
  const body = await readBody<{ text?: string; mtimeMs?: number | null }>(event)

  if (typeof body?.text !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'text is required' })
  }

  try {
    return await writeConfig(project, { text: body.text, mtimeMs: body.mtimeMs ?? null })
  } catch (cause) {
    if (cause instanceof ConfigConflict) {
      throw createError({ statusCode: 409, statusMessage: 'Stale', message: cause.message })
    }
    if (cause instanceof ConfigInvalid) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Invalid recipe',
        message: cause.message,
        data: { issues: cause.issues },
      })
    }
    throw cause
  }
})
