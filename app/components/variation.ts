import type { Severity } from '#shared/types'

export type Variation = Severity | 'neutral' | 'primary' | 'success' | 'agent'

export type BadgeVariation = Variation | 'selected' | 'merged'
