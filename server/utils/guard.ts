import type { H3Event } from 'h3'
import type { Project } from '../../shared/types'
import * as projects from '../lib/projects'
import { NotImplemented } from '../lib/stub'

export async function guard<T>(run: () => Promise<T> | T): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof NotImplemented) {
      throw createError({
        statusCode: 501,
        statusMessage: 'Not implemented',
        message: cause.message,
      })
    }

    if (cause instanceof Error && !('statusCode' in cause)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Failed',
        message: cause.message,
      })
    }

    throw cause
  }
}

export async function requireProject(event: H3Event): Promise<Project> {
  const id = getRouterParam(event, 'id')
  const project = id ? await projects.find(id) : null

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'No such project' })
  }

  return project
}
