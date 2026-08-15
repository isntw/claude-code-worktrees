import type { AgentStatus, HookPayload } from '../../shared/types'
import { stub } from './stub'

export const TRACKED_HOOKS = [
  'SessionStart',
  'SessionEnd',
  'Notification',
  'SubagentStart',
  'SubagentStop',
] as const

export function installHooks(_rootPath: string): Promise<void> {
  return stub('installHooks', 4)
}

export function removeHooks(_rootPath: string): Promise<void> {
  return stub('removeHooks', 4)
}

export function hooksInstalled(_rootPath: string): Promise<boolean> {
  return stub('hooksInstalled', 4)
}

export function applyHook(_payload: HookPayload): AgentStatus | null {
  return stub('applyHook', 4)
}

export function agentStatus(_worktreePath: string): AgentStatus {
  return stub('agentStatus', 4)
}

export function launchSession(_worktreePath: string, _command: string): Promise<void> {
  return stub('launchSession', 2)
}
