import type { Severity } from '#shared/types'

export type Variation = Severity | 'neutral' | 'primary' | 'success' | 'agent' | 'merged'

export const VARIATIONS: Variation[] = [
  'neutral',
  'info',
  'primary',
  'success',
  'agent',
  'merged',
  'warning',
  'error',
]

export const tone = (variation: Variation) => `t-tone-${variation}`
