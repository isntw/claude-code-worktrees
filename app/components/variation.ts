import type { Severity } from '#shared/types'

export type Variation = Severity | 'neutral' | 'success' | 'live' | 'agent'

export type BadgeVariation = Variation | 'selected' | 'merged'
