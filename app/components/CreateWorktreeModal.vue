<script setup lang="ts">
import { computed, ref } from 'vue'

const emit = defineEmits<{
  close: []
  create: [input: { name: string; branch: string; start: boolean }]
}>()

defineProps<{ busy?: boolean; error?: string | null }>()

const name = ref('')
const branch = ref('')
const start = ref(false)

const slug = computed(() =>
  name.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, ''),
)

const valid = computed(() => slug.value.length > 0)

const submit = () => {
  if (!valid.value) return
  emit('create', {
    name: slug.value,
    branch: branch.value.trim() || slug.value,
    start: start.value,
  })
}

</script>

<template>
  <ModalPanel title="New worktree" @close="emit('close')">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <label class="flex flex-col gap-1.5">
        <span class="t-eyebrow">Name</span>
        <Input v-model="name" placeholder="checkout-rewrite" label="Name" />
        <span v-if="slug && slug !== name" class="font-mono text-[0.625rem] text-faint"
          >creates {{ slug }}</span
        >
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="t-eyebrow">Branch</span>
        <Input v-model="branch" :placeholder="slug || 'same as name'" label="Branch" />
      </label>

      <Toggle v-model="start">start its services once provisioned</Toggle>

      <p v-if="error" class="font-sans text-[0.6875rem] text-alarm">{{ error }}</p>
    </form>

    <template #footer>
      <Button size="sm" @click="emit('close')">cancel</Button>
      <Button
        size="sm"
        variation="success"
        :outline="false"
        :disabled="!valid || busy"
        @click="submit"
        >{{ busy ? 'creating…' : 'create' }}</Button
      >
    </template>
  </ModalPanel>
</template>
