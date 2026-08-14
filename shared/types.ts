export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type DependencyStrategy = 'auto' | 'install' | 'hardlink' | 'copy' | 'none'

export type WorktreeOrigin = 'manual' | 'ccwt' | 'claude'

export type LockState = 'live' | 'gone' | 'unknown'

export type ServiceState = 'stopped' | 'starting' | 'running' | 'crashed'

export type AgentState = 'idle' | 'running' | 'waiting' | 'done'

export type Severity = 'info' | 'warning' | 'error'

export interface Diagnostic {
  code: string
  severity: Severity
  message: string
  hint?: string
}

export interface ServiceConfig {
  name: string
  cwd: string
  command: string
  portRange: [number, number]
  env?: Record<string, string>
  dependsOn?: string[]
  postStart?: string[]
  stopCommand?: string
}

export interface ProvisionConfig {
  dependencies: DependencyStrategy
  copy: string[]
  link: string[]
  postCreate: string[]
  postRemove: string[]
}

export interface ClaudeConfig {
  trackSessions: boolean
  ownWorktreeCreation: boolean
  launchCommand: string
}

export interface CcwtConfig {
  worktreesDir: string
  packageManager: PackageManager | 'auto'
  provision: ProvisionConfig
  services: ServiceConfig[]
  claude: ClaudeConfig
}

export interface Project {
  id: string
  name: string
  rootPath: string
  packageManager: PackageManager | null
  defaultBranch: string | null
  config: CcwtConfig | null
  configPath: string | null
  addedAt: string
  setup: Setup
  issues: Diagnostic[]
}

export interface ServiceStatus {
  name: string
  state: ServiceState
  port: number | null
  url: string | null
  pid: number | null
  startedAt: string | null
  exitCode: number | null
  reachable: boolean | null
  taken?: boolean
}

export interface AgentStatus {
  state: AgentState
  sessionId: string | null
  subagents: number
  updatedAt: string | null
}

export interface Worktree {
  id: string
  projectId: string
  name: string
  path: string
  root: boolean
  branch: string | null
  head: string | null
  origin: WorktreeOrigin
  detached: boolean
  bare: boolean
  locked: boolean
  lockReason: string | null
  lockState: LockState | null
  prunable: boolean
  provisioned: boolean
  services: ServiceStatus[]
  agent: AgentStatus
  issues: Diagnostic[]
}

export interface LogLine {
  worktreeId: string
  service: string
  stream: 'stdout' | 'stderr'
  at: string
  text: string
}

export type PortMode = 'allocated' | 'fixed' | 'none'

export interface SetupNote {
  tone: 'good' | 'info' | 'caution'
  title: string
  body: string
  snippet?: string
}

export interface Setup {
  portMode: PortMode
  headline: string
  notes: SetupNote[]
}

export type ConfigSourceKind = 'ccwt' | 'project' | 'detected'

export interface ConfigView {
  source: ConfigSourceKind
  path: string | null
  text: string
  config: CcwtConfig
  issues: { path: string; message: string }[]
  detected: boolean
}

export interface DirEntry {
  name: string
  path: string
  repo: boolean
  branch: string | null
  known: boolean
  noise: boolean
  hidden: boolean
}

export interface DirListing {
  path: string
  parent: string | null
  home: string
  entries: DirEntry[]
  truncated: boolean
}

export interface ProbeResult {
  path: string | null
  problem: string | null
  known: boolean
  branch: string | null
}

export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'Notification'
  | 'SubagentStart'
  | 'SubagentStop'

export interface HookPayload {
  hook_event_name: HookEvent
  session_id: string
  cwd: string
  matcher?: string
  message?: string
}

export type SocketMessage =
  | { type: 'log'; line: LogLine }
  | { type: 'service'; worktreeId: string; status: ServiceStatus }
  | { type: 'agent'; worktreeId: string; status: AgentStatus }
  | { type: 'worktrees'; projectId: string }
