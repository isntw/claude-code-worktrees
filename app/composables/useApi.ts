import type {
  CcwtConfig,
  ConfigView,
  DeviceCode,
  DeviceOutcome,
  DirListing,
  ForgeSession,
  ForgeStatus,
  FreeOutcome,
  FreeRequest,
  GitReport,
  LogLine,
  MergeMethod,
  MergeOutcome,
  Mergeability,
  Overview,
  PluginReport,
  PortHolders,
  ProbeResult,
  Project,
  RemoveOutcome,
  ServiceStatus,
  SocketMessage,
  ToolCheck,
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
    throw new Error(payload?.message || payload?.statusMessage || `${response.status}`)
  }

  return payload as T
}

export function useApi() {
  const worktree = (projectId: string, worktreeId: string) =>
    `/projects/${projectId}/worktrees/${worktreeId}`

  return {
    getOverview: () => call<Overview>('/overview'),
    getRequirements: () => call<ToolCheck[]>('/requirements'),

    listProjects: () => call<Project[]>('/projects'),
    getProject: (id: string) => call<Project>(`/projects/${id}`),
    addProject: (rootPath: string) =>
      call<Project>('/projects', { method: 'POST', body: { rootPath } }),
    forgetProject: (id: string) => call<void>(`/projects/${id}`, { method: 'DELETE' }),

    listDir: (path?: string) =>
      call<DirListing>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),
    probePath: (path: string) =>
      call<ProbeResult>('/projects/probe', { method: 'POST', body: { path } }),

    getConfig: (projectId: string) => call<ConfigView>(`/projects/${projectId}/config`),
    saveConfig: (projectId: string, text: string) =>
      call<ConfigView>(`/projects/${projectId}/config`, { method: 'PUT', body: { text } }),
    resetConfig: (projectId: string) =>
      call<ConfigView>(`/projects/${projectId}/config`, { method: 'DELETE' }),
    suggestConfig: (projectId: string) =>
      call<{ config: CcwtConfig; text: string }>(`/projects/${projectId}/config/suggest`, {
        method: 'POST',
      }),

    getGit: (projectId: string) => call<GitReport>(`/projects/${projectId}/git`),
    getPulls: (projectId: string, force = false) =>
      call<ForgeStatus>(`/projects/${projectId}/pulls${force ? '?force=1' : ''}`),

    getPlugin: () => call<PluginReport>('/plugin'),
    installPlugin: () => call<PluginReport>('/plugin', { method: 'POST', body: {} }),
    enablePlugin: () =>
      call<PluginReport>('/plugin', { method: 'POST', body: { action: 'enable' } }),
    removePlugin: () => call<PluginReport>('/plugin', { method: 'DELETE' }),

    getForgeSession: () => call<ForgeSession>('/forge/session'),
    signOutForge: () => call<ForgeSession>('/forge/session', { method: 'DELETE' }),
    startForgeLogin: () => call<DeviceCode>('/forge/login', { method: 'POST' }),
    pollForgeLogin: (handle: string) =>
      call<DeviceOutcome>('/forge/poll', { method: 'POST', body: { handle } }),

    getMergeability: (projectId: string, number: number) =>
      call<Mergeability>(`/projects/${projectId}/pulls/${number}/mergeability`),
    mergePull: (projectId: string, number: number, method: MergeMethod, sha: string) =>
      call<MergeOutcome>(`/projects/${projectId}/pulls/${number}/merge`, {
        method: 'POST',
        body: { method, sha },
      }),

    listWorktrees: (projectId: string) => call<Worktree[]>(`/projects/${projectId}/worktrees`),
    createWorktree: (projectId: string, input: { name: string; branch: string; start: boolean }) =>
      call<Worktree>(`/projects/${projectId}/worktrees`, { method: 'POST', body: input }),
    removeWorktree: (projectId: string, worktreeId: string, alsoBranch = false) =>
      call<RemoveOutcome>(`${worktree(projectId, worktreeId)}?branch=${alsoBranch}`, {
        method: 'DELETE',
      }),
    lockWorktree: (projectId: string, worktreeId: string) =>
      call<Worktree>(`${worktree(projectId, worktreeId)}/lock`, { method: 'POST' }),
    unlockWorktree: (projectId: string, worktreeId: string) =>
      call<Worktree>(`${worktree(projectId, worktreeId)}/unlock`, { method: 'POST' }),

    startService: (projectId: string, worktreeId: string, service: string) =>
      call<ServiceStatus>(`${worktree(projectId, worktreeId)}/services/${service}/start`, {
        method: 'POST',
      }),
    provision: (projectId: string, worktreeId: string) =>
      call<Worktree>(`${worktree(projectId, worktreeId)}/provision`, { method: 'POST' }),
    startAll: (projectId: string, worktreeId: string) =>
      call<ServiceStatus[]>(`${worktree(projectId, worktreeId)}/services/start`, { method: 'POST' }),
    stopAll: (projectId: string, worktreeId: string) =>
      call<ServiceStatus[]>(`${worktree(projectId, worktreeId)}/services/stop`, { method: 'POST' }),
    stopService: (projectId: string, worktreeId: string, service: string) =>
      call<ServiceStatus>(`${worktree(projectId, worktreeId)}/services/${service}/stop`, {
        method: 'POST',
      }),
    portHolders: (port: number) => call<PortHolders>(`/ports/${port}`),
    freePort: (port: number, request: FreeRequest) =>
      call<FreeOutcome>(`/ports/${port}/free`, { method: 'POST', body: request }),

    logs: (projectId: string, worktreeId: string) =>
      call<LogLine[]>(`${worktree(projectId, worktreeId)}/logs`),
    clearLogs: (projectId: string, worktreeId: string) =>
      call<void>(`${worktree(projectId, worktreeId)}/logs`, { method: 'DELETE' }),

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
