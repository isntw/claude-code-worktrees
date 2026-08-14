<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { LogLine } from '#shared/types'
import { segments, type Segment, type Tone } from '../ansi'

const props = withDefaults(defineProps<{ lines: LogLine[]; height?: string }>(), {
  height: '18rem',
})

const emit = defineEmits<{ clear: [] }>()

const TEXT: Record<Tone, string> = {
  ink: 'text-ink',
  dim: 'text-dim',
  faint: 'text-faint',
  alarm: 'text-alarm',
  caution: 'text-caution',
  live: 'text-live',
}

const FILL: Record<Tone, string> = {
  ink: 'bg-ink text-canvas',
  dim: 'bg-dim text-canvas',
  faint: 'bg-faint text-canvas',
  alarm: 'bg-alarm text-canvas',
  caution: 'bg-caution text-canvas',
  live: 'bg-live text-canvas',
}

const parsed = new WeakMap<LogLine, Segment[]>()

const parse = (line: LogLine): Segment[] => {
  const known = parsed.get(line)
  if (known) return known
  const made = segments(line.text)
  parsed.set(line, made)
  return made
}

const paint = (part: Segment) => [
  part.fill ? FILL[part.fill] : TEXT[part.tone],
  part.bold ? 'font-semibold' : '',
  part.italic ? 'italic' : '',
  part.underline ? 'underline' : '',
  part.strike ? 'line-through' : '',
]

const mixed = computed(() => new Set(props.lines.map((line) => line.service)).size > 1)

const scroller = ref<HTMLElement | null>(null)
const follow = ref(true)

const onScroll = () => {
  const element = scroller.value
  if (!element) return
  follow.value = element.scrollHeight - element.scrollTop - element.clientHeight < 24
}

watch(
  () => props.lines.length,
  async () => {
    if (!follow.value) return
    await nextTick()
    const element = scroller.value
    if (element) element.scrollTop = element.scrollHeight
  },
)
</script>

<template>
  <div class="flex min-h-0 flex-col border border-line bg-canvas">
    <header class="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
      <p class="t-eyebrow">Logs</p>
      <span class="ml-auto font-mono text-[0.625rem] tabular-nums text-faint"
        >{{ lines.length }} lines</span
      >
      <Checkbox v-model="follow">follow</Checkbox>
      <Button
        size="sm"
        :disabled="!lines.length"
        title="Forget everything ccwt has kept for this worktree"
        @click="emit('clear')"
        >clear</Button
      >
    </header>

    <div
      ref="scroller"
      class="ccwt-log min-h-0 flex-1 overflow-y-auto px-3 py-2"
      :style="{ height }"
      @scroll="onScroll"
    >
      <p v-if="!lines.length" class="font-sans text-[0.6875rem] text-faint">
        Nothing yet. Start a service and its output lands here.
      </p>
      <div v-for="(line, index) in lines" :key="index" class="flex min-h-[1.55em] gap-2">
        <span v-if="mixed" class="w-16 shrink-0 truncate select-none text-faint">{{
          line.service
        }}</span>
        <span class="min-w-0 flex-1"
          ><span v-for="(part, at) in parse(line)" :key="at" :class="paint(part)">{{
            part.text
          }}</span></span
        >
      </div>
    </div>
  </div>
</template>
