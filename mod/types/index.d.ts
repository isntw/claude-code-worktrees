export type ServiceState = 'stopped' | 'starting' | 'running' | 'crashed'

export type Service = {
  name: string
  primary?: boolean
  state: ServiceState
  port: number | null
  url: string | null
  startedAt: string | null
  exitCode: number | null
  reachable: boolean | null
  taken?: boolean
  movable?: boolean
  heldBy?: { worktreeId: string; worktree: string; service: string; same: boolean } | null
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

export type Holder = {
  port: number
  free: boolean
  ours: { worktreeId: string; worktree: string; service: string }[]
  foreign: { pid: number; name: string; cwd: string | null }[]
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
      holders: Record<string, Holder>
    }

declare module 'claude-code' {
  interface PluginState {
    'ccwt-mod': {
      view: View | null
      tracked: string[]
      focus: string | null
      cursor: string | null
      everything: boolean
      selected: string | null
      logs: LogLine[]
      busy: string | null
    }
  }
}
