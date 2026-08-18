import type { PullState } from '#shared/types'
import type { BadgeVariation } from './variation'

export const PULL: Record<PullState, { label: string; variation: BadgeVariation; hint: string }> = {
  open: { label: 'open', variation: 'success', hint: 'Its pull request is open' },
  draft: { label: 'draft', variation: 'neutral', hint: 'Its pull request is still a draft' },
  merged: { label: 'merged', variation: 'merged', hint: 'Its pull request was merged' },
  closed: {
    label: 'closed',
    variation: 'error',
    hint: 'Its pull request was closed without merging',
  },
}
