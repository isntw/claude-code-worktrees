import type { PullState } from '#shared/types'
import type { Variation } from './variation'

export const PULL: Record<PullState, { label: string; variation: Variation; hint: string }> = {
  open: { label: 'open', variation: 'live', hint: 'Its pull request is open' },
  draft: { label: 'draft', variation: 'warning', hint: 'Its pull request is still a draft' },
  merged: { label: 'merged', variation: 'success', hint: 'Its pull request was merged' },
  closed: {
    label: 'closed',
    variation: 'neutral',
    hint: 'Its pull request was closed without merging',
  },
}
