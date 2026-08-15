export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type DependencyStrategy = 'auto' | 'install' | 'hardlink' | 'copy' | 'none'

export type WorktreeOrigin = 'manual' | 'ccwt' | 'claude'

export type ServiceKind = 'command' | 'stack'

export type LockState = 'live' | 'gone' | 'unknown'

export type ServiceState = 'stopped' | 'starting' | 'running' | 'crashed'

export type Severity = 'info' | 'warning' | 'error'

export interface Diagnostic {
  code: string
  severity: Severity
  message: string
  hint?: string
}

export interface ServiceConfig {
  name: string
  kind?: ServiceKind
  cwd: string
  command: string
  portRange: [number, number]
  ports?: Record<string, [number, number]>
  env?: Record<string, string>
  dependsOn?: string[]
  postStart?: string[]
  stopCommand?: string
  removeCommand?: string
}

export interface WriteEntry {
  path: string
  content: string
}

export interface ProvisionConfig {
  dependencies: DependencyStrategy
  copy: string[]
  link: string[]
  write: WriteEntry[]
  postCreate: string[]
  postRemove: string[]
}

export interface ClaudeConfig {
  ownWorktreeCreation: boolean
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
  extra?: Record<string, number>
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
  issues: Diagnostic[]
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

export type GitReport = Record<string, GitStatus>

export type PullState = 'open' | 'draft' | 'merged' | 'closed'

export type MergeState =
  | 'clean'
  | 'blocked'
  | 'dirty'
  | 'behind'
  | 'unstable'
  | 'draft'
  | 'unknown'

export interface PullRequest {
  number: number
  title: string
  url: string
  state: PullState
  baseRef: string
  headSha: string
}

export interface ForgeStatus {
  at: string | null
  pulls: Record<string, PullRequest>
  issues: Diagnostic[]
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'

export interface Mergeability {
  number: number
  state: MergeState
  headSha: string
  reason: string
}

export interface MergeOutcome {
  merged: boolean
  sha: string | null
  message: string
}

export interface ForgeSession {
  login: string | null
  scopes: string[]
  canMerge: boolean
  configured: boolean
}

export interface DeviceCode {
  handle: string
  userCode: string
  verificationUri: string
  expiresAt: string
  interval: number
}

export type DeviceOutcome =
  | { state: 'pending'; interval: number }
  | { state: 'done'; session: ForgeSession }
  | { state: 'failed'; message: string }

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

export interface PortClaim {
  projectId: string
  projectName: string
  worktreeId: string
  worktreeName: string
  service: string
  state: ServiceState
  url: string | null
}

export interface PortRow {
  port: number
  claims: PortClaim[]
}

export interface OverviewRow {
  projectId: string
  projectName: string
  worktree: Worktree
}

export interface OverviewProject {
  id: string
  name: string
  rootPath: string
  packageManager: PackageManager | null
  defaultBranch: string | null
  worktrees: number
  live: number
  errors: number
  readable: boolean
}

export interface OverviewIssue extends Diagnostic {
  projectId: string
  projectName: string
  worktree: string | null
}

export interface OverviewTotals {
  projects: number
  worktrees: number
  services: number
  running: number
  starting: number
  crashed: number
  errors: number
  ports: number
}

export interface Overview {
  at: string
  totals: OverviewTotals
  projects: OverviewProject[]
  rows: OverviewRow[]
  ports: PortRow[]
  issues: OverviewIssue[]
}

export type ToolState = 'present' | 'missing' | 'outdated'

export interface ToolCheck {
  name: string
  required: boolean
  state: ToolState
  version: string | null
  minimum: string | null
  purpose: string
  install: string
}

export type SocketMessage =
  | { type: 'log'; line: LogLine }
  | { type: 'service'; worktreeId: string; status: ServiceStatus }
  | { type: 'worktrees'; projectId: string }
