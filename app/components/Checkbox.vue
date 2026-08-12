<script setup lang="ts">
const model = defineModel<boolean>({ default: false })

withDefaults(
  defineProps<{
    indeterminate?: boolean
    disabled?: boolean
  }>(),
  { indeterminate: false, disabled: false },
)
</script>

<template>
  <label class="group t-control">
    <input
      v-model="model"
      type="checkbox"
      class="sr-only"
      autocomplete="off"
      :indeterminate="indeterminate"
      :disabled="disabled"
    />

    <span
      class="t-control-indicator mr-1.5 inline-flex size-3 items-center justify-center"
      :class="
        model || indeterminate
          ? 'border-ink bg-ink text-canvas'
          : 'border-line-strong text-transparent group-hover:border-ink'
      "
    >
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path v-if="indeterminate" d="M4 8h8" />
        <path v-else d="m3.75 8.25 2.75 3 5.75-6.5" />
      </svg>
    </span>
    <slot />
  </label>
</template>
