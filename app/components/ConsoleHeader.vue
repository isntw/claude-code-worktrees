<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    blurb: string
    loading?: boolean
  }>(),
  { loading: false },
)
</script>

<template>
  <header
    class="relative shrink-0 border-b border-line bg-surface px-4 py-3"
    :class="{ sweep: loading }"
  >
    <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div class="min-w-0">
        <h1 class="font-mono text-sm font-semibold text-ink">{{ title }}</h1>
        <p class="mt-0.5 font-sans text-[0.6875rem] text-faint">{{ blurb }}</p>
      </div>

      <div class="ml-auto flex items-center gap-3">
        <slot />
      </div>
    </div>
  </header>
</template>
