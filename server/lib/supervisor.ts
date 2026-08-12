import type { LogLine, ServiceConfig, ServiceStatus } from '../../shared/types'
import { stub } from './stub'

export type Listener = (line: LogLine) => void

export function start(
  _worktreeId: string,
  _worktreePath: string,
  _service: ServiceConfig,
  _port: number,
): Promise<ServiceStatus> {
  return stub('supervisor.start', 1)
}

export function stop(_worktreeId: string, _service: string): Promise<ServiceStatus> {
  return stub('supervisor.stop', 1)
}

export function status(_worktreeId: string, _service: string): ServiceStatus | null {
  return stub('supervisor.status', 1)
}

export function scrollback(_worktreeId: string, _service: string): LogLine[] {
  return stub('supervisor.scrollback', 1)
}

export function subscribe(_listener: Listener): () => void {
  return stub('supervisor.subscribe', 1)
}

export function stopAll(): Promise<void> {
  return stub('supervisor.stopAll', 1)
}
