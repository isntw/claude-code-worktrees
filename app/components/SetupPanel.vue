<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { Setup, SetupNote, SetupTopic } from '#shared/types'
import type { Variation } from './variation'

const props = defineProps<{ setup: Setup }>()

const open = ref(false)

const TONE: Record<SetupNote['tone'], Variation> = {
  good: 'success',
  info: 'neutral',
  caution: 'warning',
}

const TOPICS: { topic: SetupTopic; label: string }[] = [
  { topic: 'files', label: 'what a worktree gets' },
  { topic: 'services', label: 'what runs in it' },
  { topic: 'together', label: 'running two at once' },
  { topic: 'problems', label: 'worth fixing' },
]

const cautions = computed(() => props.setup.notes.filter((note) => note.tone === 'caution').length)

const groups = computed(() =>
  TOPICS.map(({ topic, label }) => ({
    topic,
    label,
    notes: props.setup.notes.filter((note) => note.topic === topic),
  })).filter((group) => group.notes.length),
)

const headlineTone = computed<Variation>(() => {
  if (cautions.value) return 'warning'
  if (props.setup.portMode === 'none') return 'neutral'
  return props.setup.portMode === 'fixed' ? 'info' : 'success'
})
</script>

<template>
  <section class="border border-line bg-surface">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <component
        :is="open ? ChevronDown : ChevronRight"
        :size="12"
        class="shrink-0 text-faint"
        aria-hidden="true"
      />
      <span class="t-eyebrow">Setup</span>
      <StateDot :variation="headlineTone" />
      <span class="min-w-0 flex-1 truncate font-sans text-[0.6875rem] text-dim">{{
        setup.headline
      }}</span>
      <span
        class="shrink-0 font-mono text-[0.625rem]"
        :class="!open && cautions ? 'text-caution' : 'text-faint'"
        >{{ open ? 'hide' : cautions ? `${cautions} to check` : `${setup.notes.length} notes` }}</span
      >
    </button>

    <div v-if="open" class="flex flex-col gap-3 border-t border-line px-3 py-2.5">
      <section v-for="group in groups" :key="group.topic" class="flex flex-col gap-2">
        <p class="t-eyebrow">{{ group.label }}</p>

        <article v-for="(note, index) in group.notes" :key="index" class="flex gap-2">
          <StateDot :variation="TONE[note.tone]" class="mt-1.5" />
          <div class="min-w-0 flex-1">
            <p class="font-mono text-[0.6875rem] font-semibold text-ink">{{ note.title }}</p>
            <p
              v-if="note.body"
              class="max-w-prose font-sans text-[0.6875rem] leading-relaxed text-dim"
            >
              {{ note.body }}
            </p>
            <pre
              v-if="note.snippet"
              class="ccwt-log mt-1 overflow-x-auto border border-line bg-canvas px-2 py-1 text-faint"
              >{{ note.snippet }}</pre
            >
          </div>
        </article>
      </section>
    </div>
  </section>
</template>
