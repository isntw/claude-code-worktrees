<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'
import type { PortClaim, PortRow, ServiceState } from '#shared/types'
import type { Variation } from './variation'

defineProps<{ rows: PortRow[] }>()

const emit = defineEmits<{ pick: [claim: PortClaim] }>()

const SERVICE: Record<ServiceState, Variation> = {
  stopped: 'neutral',
  starting: 'info',
  running: 'success',
  crashed: 'error',
}

const live = (state: ServiceState) => state === 'running' || state === 'starting'

const claimHint = (claim: PortClaim) =>
  `${claim.service} in ${claim.projectName}/${claim.worktreeName} — ${claim.state}`
</script>

<template>
  <ul v-if="rows.length" class="flex flex-col">
    <li
      v-for="row in rows"
      :key="row.port"
      class="flex gap-3 border-b border-line px-3 py-2 last:border-b-0"
    >
      <span
        class="w-10 shrink-0 font-mono text-xs font-semibold tabular-nums"
        :class="row.claims.some((claim) => live(claim.state)) ? 'text-ink' : 'text-faint'"
        >{{ row.port }}</span
      >

      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div
          v-for="claim in row.claims"
          :key="claim.worktreeId + claim.service"
          class="flex items-center gap-1.5"
        >
          <StateDot :variation="SERVICE[claim.state]" :beating="claim.state === 'starting'" />
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 text-left"
            :title="claimHint(claim)"
            @click="emit('pick', claim)"
          >
            <span class="shrink-0 font-mono text-[0.6875rem] text-dim">{{ claim.service }}</span>
            <span class="truncate font-mono text-[0.625rem] text-faint"
              >{{ claim.projectName }}/{{ claim.worktreeName }}</span
            >
          </button>

          <a
            v-if="claim.url"
            :href="claim.url"
            target="_blank"
            rel="noreferrer"
            class="shrink-0 text-faint transition-colors hover:text-ink"
            :title="claim.url"
            :aria-label="`Open ${claim.url}`"
          >
            <ExternalLink :size="11" aria-hidden="true" />
          </a>
        </div>
      </div>
    </li>
  </ul>

  <p v-else class="px-3 py-4 font-sans text-[0.6875rem] text-faint">
    No ports allocated yet. A worktree gets one the first time it is provisioned or started.
  </p>
</template>
