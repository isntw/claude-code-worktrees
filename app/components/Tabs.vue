<script setup lang="ts" generic="T extends string | number">
const props = withDefaults(
  defineProps<{
    options: { value: T; label: string; count?: number }[]
    size?: 'sm' | 'md'
    label?: string
  }>(),
  { size: 'sm', label: 'View' },
)

const model = defineModel<T>({ required: true })

const SIZE = {
  sm: 'h-6 min-w-9 px-2 text-[0.6875rem]',
  md: 'h-7 min-w-11 px-2.5 text-xs',
}
</script>

<template>
  <div class="t-tabs" role="tablist" :aria-label="label">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      class="t-tabs-item"
      :class="[
        SIZE[props.size],
        model === option.value ? 'bg-ink text-canvas' : 'text-dim hover:bg-raised hover:text-ink',
      ]"
      @click="model = option.value"
    >
      <span class="t-tab-label">{{ option.label }}</span>
      <span
        v-if="option.count !== undefined"
        class="t-tab-label tabular-nums"
        :class="model === option.value ? 'opacity-70' : 'text-faint'"
        >{{ option.count }}</span
      >
    </button>
  </div>
</template>
