<script setup lang="ts">
const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    placeholder?: string
    disabled?: boolean
    invalid?: boolean
    label?: string
  }>(),
  { placeholder: '', disabled: false, invalid: false, label: '' },
)
</script>

<template>
  <input
    v-model="model"
    type="text"
    class="t-input"
    :class="{ 't-input-invalid': invalid }"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="label || undefined"
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
  />
</template>
