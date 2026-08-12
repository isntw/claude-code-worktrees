import { readState, writeState } from '../../lib/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const state = await readState()
  const next = state.projects.filter((project) => project.id !== id)

  if (next.length === state.projects.length) {
    throw createError({ statusCode: 404, statusMessage: 'No such project' })
  }

  await writeState({ ...state, projects: next })
  setResponseStatus(event, 204)
  return null
})
