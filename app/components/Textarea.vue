<script setup lang="ts">
const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    rows?: number
    placeholder?: string
    disabled?: boolean
    label?: string
  }>(),
  { rows: 12, placeholder: '', disabled: false, label: '' },
)
</script>

<template>
  <textarea
    v-model="model"
    class="t-area"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="label || undefined"
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
  />
</template>
