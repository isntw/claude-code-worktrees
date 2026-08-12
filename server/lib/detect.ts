import type { CcwtConfig, PackageManager } from '../../shared/types'
import { stub } from './stub'

export function detectPackageManager(_rootPath: string): Promise<PackageManager | null> {
  return stub('detectPackageManager', 1)
}

export function detectDevScript(_rootPath: string): Promise<string | null> {
  return stub('detectDevScript', 1)
}

export function detectDefaultBranch(_rootPath: string): Promise<string | null> {
  return stub('detectDefaultBranch', 1)
}

export function loadConfig(_rootPath: string): Promise<CcwtConfig | null> {
  return stub('loadConfig', 3)
}

export function suggestConfig(_rootPath: string): Promise<CcwtConfig> {
  return stub('suggestConfig', 3)
}
