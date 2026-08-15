import { readConfig } from '~~/server/lib/config'
import { ignoreWorktrees } from '~~/server/lib/gitignore'
import * as projects from '~~/server/lib/projects'

export default defineEventHandler(async (event) => {
  const project = await requireProject(event)

  return guard(async () => {
    await ignoreWorktrees(project.rootPath, project.config)
    return readConfig((await projects.find(project.id)) ?? project)
  })
})
