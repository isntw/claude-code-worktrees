export type ServiceState = 'stopped' | 'starting' | 'running' | 'crashed'

export type Service = {
  name: string
  state: ServiceState
  port: number | null
  url: string | null
  startedAt: string | null
  exitCode: number | null
  reachable: boolean | null
  taken?: boolean
}

export type Diagnostic = {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export type Repairing = { label: string; done: number; total: number }

export type Worktree = {
  id: string
  name: string
  path: string
  root: boolean
  branch: string | null
  origin: 'manual' | 'ccwt' | 'claude'
  locked: boolean
  lockReason: string | null
  provisioned: boolean
  repairing: Repairing | null
  services: Service[]
  issues: Diagnostic[]
}

export type Pull = {
  number: number
  title: string
  url: string
  state: 'open' | 'draft' | 'merged' | 'closed'
}

export type LogLine = {
  service: string
  stream: 'stdout' | 'stderr'
  at: string
  text: string
}

export type View =
  | { kind: 'offline' }
  | { kind: 'outside' }
  | {
      kind: 'here'
      projectId: string
      projectName: string
      dashboard: string
      hereId: string
      rows: Worktree[]
      others: Worktree[]
      pulls: Record<string, Pull>
    }

declare module 'claude-code' {
  interface PluginState {
    'ccwt-mod': {
      view: View | null
      tracked: string[]
      focus: string | null
      selected: string | null
      logs: LogLine[]
      busy: string | null
    }
  }
}
