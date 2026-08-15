import type { Severity } from '#shared/types'

export type Variation = Severity | 'neutral' | 'success' | 'live'

export type BadgeVariation = Variation | 'selected' | 'merged'
