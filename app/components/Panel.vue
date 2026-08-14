<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'

withDefaults(defineProps<{ title: string; aside?: string }>(), { aside: '' })

const open = defineModel<boolean>('open', { default: true })
</script>

<template>
  <section class="border border-line bg-surface">
    <header class="flex items-center gap-2 border-b border-line px-3 py-2">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        :aria-expanded="open"
        @click="open = !open"
      >
        <ChevronDown v-if="open" :size="12" aria-hidden="true" class="shrink-0 text-faint" />
        <ChevronRight v-else :size="12" aria-hidden="true" class="shrink-0 text-faint" />
        <span class="t-eyebrow shrink-0">{{ title }}</span>
        <slot name="label" />
        <span v-if="aside" class="t-eyebrow ml-auto shrink-0 text-faint">{{ aside }}</span>
      </button>

      <slot name="actions" />
    </header>

    <div v-if="open">
      <slot />
    </div>
  </section>
</template>
