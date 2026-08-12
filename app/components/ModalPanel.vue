<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const opener = ref<HTMLElement | null>(null)

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  opener.value = document.activeElement as HTMLElement | null
  panel.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  opener.value?.focus()
})
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/70" aria-hidden="true" @click="emit('close')" />

  <div
    ref="panel"
    class="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col border border-line bg-surface outline-none"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    tabindex="-1"
  >
    <header class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
      <p class="t-eyebrow">{{ title }}</p>
      <button
        type="button"
        class="ml-auto flex size-6 items-center justify-center font-mono text-xs text-faint transition-colors hover:text-ink"
        aria-label="Close"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <slot />
    </div>

    <footer
      v-if="$slots.footer"
      class="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3"
    >
      <slot name="footer" />
    </footer>
  </div>
</template>
