<script setup lang="ts">
import { computed } from 'vue'

const { done, total, label } = defineProps<{ done: number; total: number; label: string }>()

const determinate = computed(() => total > 0)
const percent = computed(() =>
  total > 0 ? Math.round(Math.min(1, Math.max(0, done / total)) * 100) : 0,
)
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      class="t-progress min-w-0 flex-1"
      role="progressbar"
      :aria-label="label"
      :aria-valuenow="determinate ? percent : undefined"
      :aria-valuemin="determinate ? 0 : undefined"
      :aria-valuemax="determinate ? 100 : undefined"
    >
      <i v-if="determinate" class="t-progress-fill" :style="{ inlineSize: `${percent}%` }" />
      <i v-else class="t-progress-drift" />
    </span>

    <span v-if="determinate" class="t-data shrink-0 tabular-nums text-dim">{{ percent }}%</span>
    <span class="t-data shrink-0 truncate text-faint">{{ label }}</span>
  </div>
</template>
