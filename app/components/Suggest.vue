<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{ options: string[]; placeholder?: string; label?: string; disabled?: boolean }>(),
  { placeholder: '', label: '', disabled: false },
)

const model = defineModel<string>({ default: '' })

const open = ref(false)
const active = ref(0)
const filtering = ref(false)

const matches = computed(() => {
  const term = model.value.trim().toLowerCase()
  if (!filtering.value || !term) return props.options
  return props.options.filter((option) => option.toLowerCase().includes(term))
})

const reveal = () => {
  filtering.value = false
  active.value = 0
  open.value = true
}

const shown = computed(() => open.value && matches.value.length > 0)

const choose = (value: string) => {
  model.value = value
  open.value = false
}

const move = (by: number) => {
  if (!shown.value) {
    open.value = true
    return
  }
  const count = matches.value.length
  active.value = (active.value + by + count) % count
}

const commit = () => {
  const chosen = matches.value[active.value]
  if (shown.value && chosen) choose(chosen)
}

const leaving = (event: FocusEvent) => {
  const root = event.currentTarget as HTMLElement | null
  const next = event.relatedTarget as Node | null
  if (!root || !next || !root.contains(next)) open.value = false
}
</script>

<template>
  <div class="relative" @focusout="leaving">
    <input
      v-model="model"
      type="text"
      class="t-input pr-6"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="label || undefined"
      :aria-expanded="shown"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
      @focus="reveal"
      @input="((filtering = true), (open = true), (active = 0))"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="commit"
      @keydown.esc="open = false"
    />

    <button
      v-if="options.length && !disabled"
      type="button"
      tabindex="-1"
      class="absolute inset-y-0 right-0 flex w-5 cursor-pointer items-center justify-center text-faint transition-colors hover:text-ink"
      :aria-label="`Show ${label || 'suggestions'}`"
      @mousedown.prevent
      @click="open ? (open = false) : reveal()"
    >
      <ChevronDown :size="11" aria-hidden="true" />
    </button>

    <ul
      v-if="shown"
      class="absolute inset-x-0 top-full z-20 mt-px max-h-40 overflow-y-auto border border-line bg-surface"
      role="listbox"
    >
      <li v-for="(option, at) in matches" :key="option">
        <button
          type="button"
          role="option"
          :aria-selected="at === active"
          class="block w-full cursor-pointer px-2 py-1 text-left font-mono text-[0.6875rem] transition-colors"
          :class="at === active ? 'bg-ink text-canvas' : 'text-dim hover:bg-raised hover:text-ink'"
          @mousedown.prevent="choose(option)"
          @mouseenter="active = at"
        >
          {{ option }}
        </button>
      </li>
    </ul>
  </div>
</template>
