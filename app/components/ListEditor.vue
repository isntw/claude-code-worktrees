<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'

const model = defineModel<string[]>({ default: () => [] })

withDefaults(
  defineProps<{
    placeholder?: string
    empty?: string
    addLabel?: string
  }>(),
  { placeholder: '', empty: 'Nothing here.', addLabel: 'add' },
)

const update = (index: number, value: string) => {
  const next = [...model.value]
  next[index] = value
  model.value = next
}

const remove = (index: number) => {
  model.value = model.value.filter((_, at) => at !== index)
}

const add = () => {
  model.value = [...model.value, '']
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <p v-if="!model.length" class="font-sans text-[0.625rem] text-faint">{{ empty }}</p>

    <div v-for="(entry, index) in model" :key="index" class="flex items-center gap-1.5">
      <Input
        :model-value="entry"
        :placeholder="placeholder"
        :label="placeholder"
        @update:model-value="(value) => update(index, value)"
      />
      <Button size="sm" icon title="Remove" @click="remove(index)">
        <X :size="12" aria-hidden="true" />
      </Button>
    </div>

    <div>
      <Button size="sm" @click="add">
        <template #lead><Plus :size="11" aria-hidden="true" /></template>
        {{ addLabel }}
      </Button>
    </div>
  </div>
</template>
