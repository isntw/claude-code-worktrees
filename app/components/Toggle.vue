<script setup lang="ts">
const model = defineModel<boolean>({ default: false })

withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
</script>

<template>
  <label class="group t-control">
    <input
      v-model="model"
      type="checkbox"
      role="switch"
      class="sr-only"
      autocomplete="off"
      :disabled="disabled"
    />

    <span
      class="t-control-indicator relative mr-2 inline-block h-3.5 w-6"
      :class="model ? 'border-ink bg-ink' : 'border-line-strong group-hover:border-ink'"
    >
      <span
        class="absolute top-px left-px size-2.5 transition-transform duration-100 ease-linear"
        :class="model ? 'translate-x-2.5 bg-canvas' : 'bg-faint group-hover:bg-dim'"
        aria-hidden="true"
      />
    </span>
    <slot />
  </label>
</template>
