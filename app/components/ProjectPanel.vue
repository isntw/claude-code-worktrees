<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { OverviewProject } from '#shared/types'

const { project } = defineProps<{ project: OverviewProject }>()

const emit = defineEmits<{ go: [] }>()

const open = defineModel<boolean>('open', { default: true })

const held = computed(() =>
  project.worktrees === 1 ? '1 worktree' : `${project.worktrees} worktrees`,
)

const problems = computed(() =>
  project.errors === 1 ? '1 problem in this project' : `${project.errors} problems in this project`,
)
</script>

<template>
  <section class="border border-line" :class="project.readable ? 'bg-surface' : 'bg-canvas'">
    <header class="flex h-10 items-center gap-3 border-b border-line px-3">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        :aria-expanded="open"
        :title="project.rootPath"
        @click="open = !open"
      >
        <component
          :is="open ? ChevronDown : ChevronRight"
          :size="12"
          class="shrink-0 text-faint"
          aria-hidden="true"
        />
        <span
          class="truncate font-mono text-xs"
          :class="project.readable ? 'text-ink' : 'text-faint'"
          >{{ project.name }}</span
        >
        <span v-if="project.defaultBranch" class="truncate font-mono text-[0.625rem] text-faint">{{
          project.defaultBranch
        }}</span>
      </button>

      <span v-if="project.errors" class="flex shrink-0 items-center gap-1" :title="problems">
        <StateDot variation="error" />
        <span class="font-mono text-[0.625rem] tabular-nums text-alarm">{{ project.errors }}</span>
      </span>

      <p class="shrink-0 font-mono text-[0.625rem] tabular-nums text-faint">
        {{ held }}<template v-if="project.live"> · {{ project.live }} up</template>
      </p>

      <Button size="sm" icon :title="`Open ${project.name}`" @click="emit('go')">
        <ArrowRight :size="11" aria-hidden="true" />
      </Button>
    </header>

    <div v-if="open"><slot /></div>
  </section>
</template>
