export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

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

export interface Service {
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

export interface Provision {
  copy: string[]
  link: string[]
  write: WriteEntry[]
  postCreate: string[]
  postRemove: string[]
}

export interface ClaudeOptions {
  ownWorktreeCreation: boolean
}

export interface Recipe {
  worktreesDir: string
  provision: Provision
  services: Service[]
  claude: ClaudeOptions
}

export interface Project {
  id: string
  name: string
  rootPath: string
  packageManager: PackageManager | null
  defaultBranch: string | null
  recipe: Recipe | null
  addedAt: string
  setup: Setup
  issues: Diagnostic[]
}

export interface PortHold {
  worktreeId: string
  worktree: string
  service: string
  same: boolean
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
  movable?: boolean
  heldBy?: PortHold | null
  extra?: Record<string, number>
}

export interface ServiceHolder {
  worktreeId: string
  worktree: string
  project: string
  service: string
  state: ServiceState
  pid: number | null
  startedAt: string | null
}

export interface ForeignHolder {
  pid: number
  name: string
  command: string
  cwd: string | null
  user: string | null
}

export interface PortHolders {
  port: number
  free: boolean
  ours: ServiceHolder[]
  foreign: ForeignHolder[]
  why: string | null
}

export interface FreeRequest {
  pids: number[]
  services: { worktreeId: string; service: string }[]
}

export interface FreeOutcome {
  port: number
  freed: boolean
  stopped: string[]
  signalled: number[]
  refused: { pid: number; why: string }[]
  why: string | null
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
  lockedAt: string | null
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

export interface RemoveOutcome {
  branch: string | null
  branchDeleted: boolean
  branchIssue: string | null
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

export type LoopbackHost = '127.0.0.1' | 'localhost' | '::1'

export interface Address {
  port: number
}

export interface LiveAddress {
  host: LoopbackHost
  port: number
}

export interface AddressView {
  saved: Address
  live: LiveAddress | null
  pending: boolean
}

export type RecipeSourceKind = 'ccwt' | 'detected'

export interface RecipeNote {
  path: string
  severity: Severity
  message: string
  hint?: string
}

export interface RecipeCheck {
  ok: boolean
  issues: { path: string; message: string }[]
  notes: RecipeNote[]
}

export interface RecipeView {
  source: RecipeSourceKind
  text: string
  recipe: Recipe
  issues: { path: string; message: string }[]
  detected: boolean
  stale: boolean
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
  pull: PullRequest | null
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
  signedIn: boolean
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

export type PluginState = 'unavailable' | 'absent' | 'installed' | 'disabled'

export interface PluginCapability {
  name: string
  title: string
  blurb: string
}

export interface PluginHook {
  event: string
  matcher: string | null
  blurb: string
}

export interface PluginSkill {
  name: string
  blurb: string
}

export interface PluginParts {
  marketplace: string
  id: string
  hooks: PluginHook[]
  servers: string[]
  tools: string[]
  skills: PluginSkill[]
}

export interface PluginReport {
  state: PluginState
  installed: string | null
  shipped: string
  scope: string | null
  installedAt: string | null
  source: string
  commands: string[]
  capabilities: PluginCapability[]
  parts: PluginParts
  issues: Diagnostic[]
}

export type SocketMessage =
  | { type: 'log'; line: LogLine }
  | { type: 'service'; worktreeId: string; status: ServiceStatus }
  | { type: 'worktrees'; projectId: string }
  | { type: 'pulls'; projectId: string; status: ForgeStatus }
