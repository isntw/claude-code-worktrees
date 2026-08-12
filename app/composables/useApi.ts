import type {
  LogLine,
  Project,
  ServiceStatus,
  SocketMessage,
  Worktree,
} from '#shared/types'

type Init = Omit<RequestInit, 'body'> & { body?: unknown }

async function call<T>(path: string, init?: Init): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    ...init,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(payload?.message ?? `${response.status} ${response.statusText}`)
  }

  return payload as T
}

export function useApi() {
  return {
    listProjects: () => call<Project[]>('/projects'),
    getProject: (id: string) => call<Project>(`/projects/${id}`),
    addProject: (rootPath: string) =>
      call<Project>('/projects', { method: 'POST', body: { rootPath } }),
    removeProject: (id: string) => call<void>(`/projects/${id}`, { method: 'DELETE' }),

    listWorktrees: (projectId: string) => call<Worktree[]>(`/projects/${projectId}/worktrees`),
    createWorktree: (projectId: string, input: { name: string; branch: string; start: boolean }) =>
      call<Worktree>(`/projects/${projectId}/worktrees`, { method: 'POST', body: input }),
    removeWorktree: (projectId: string, worktreeId: string) =>
      call<void>(`/projects/${projectId}/worktrees/${worktreeId}`, { method: 'DELETE' }),
    adoptWorktree: (projectId: string, worktreeId: string) =>
      call<Worktree>(`/projects/${projectId}/worktrees/${worktreeId}/adopt`, { method: 'POST' }),

    startService: (worktreeId: string, service: string) =>
      call<ServiceStatus>(`/worktrees/${worktreeId}/services/${service}/start`, { method: 'POST' }),
    stopService: (worktreeId: string, service: string) =>
      call<ServiceStatus>(`/worktrees/${worktreeId}/services/${service}/stop`, { method: 'POST' }),
    logs: (worktreeId: string, service: string) =>
      call<LogLine[]>(`/worktrees/${worktreeId}/services/${service}/logs`),

    launchAgent: (worktreeId: string) =>
      call<void>(`/worktrees/${worktreeId}/agent/launch`, { method: 'POST' }),

    connect(onMessage: (message: SocketMessage) => void): () => void {
      const url = new URL('/_ws', window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

      const socket = new WebSocket(url)
      socket.addEventListener('message', (event) => {
        try {
          onMessage(JSON.parse(event.data) as SocketMessage)
        } catch {
          return
        }
      })

      return () => socket.close()
    },
  }
}
