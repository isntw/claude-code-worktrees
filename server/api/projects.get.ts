import { readState } from '../lib/store'

export default defineEventHandler(async () => {
  const state = await readState()
  return state.projects
})
