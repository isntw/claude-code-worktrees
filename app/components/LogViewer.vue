<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { LogLine } from '#shared/types'
import { segments, type Segment, type Tone } from '../ansi'

const props = withDefaults(defineProps<{ streams: Record<string, LogLine[]>; max?: string }>(), {
  max: '18rem',
})

const emit = defineEmits<{ clear: [service: string] }>()

const TEXT: Record<Tone, string> = {
  ink: 'text-ink',
  dim: 'text-dim',
  faint: 'text-faint',
  alarm: 'text-alarm',
  caution: 'text-caution',
  success: 'text-success',
}

const FILL: Record<Tone, string> = {
  ink: 'bg-ink text-canvas',
  dim: 'bg-dim text-canvas',
  faint: 'bg-faint text-canvas',
  alarm: 'bg-alarm text-canvas',
  caution: 'bg-caution text-canvas',
  success: 'bg-success text-canvas',
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

const chosen = ref('')

const named = computed(() =>
  Object.keys(props.streams)
    .filter((name) => props.streams[name]?.length)
    .sort(),
)

const lines = computed(() => props.streams[chosen.value] ?? [])

watch(
  named,
  (names) => {
    if (!names.length) chosen.value = ''
    else if (!names.includes(chosen.value)) chosen.value = names[0]!
  },
  { immediate: true },
)

const scroller = ref<HTMLElement | null>(null)
const follow = ref(true)

const KEY = 'ccwt.log-height'
const MIN = 64

const size = ref<number | null>(null)

const stored = Number(localStorage.getItem(KEY))
if (Number.isFinite(stored) && stored >= MIN) size.value = stored

const box = computed(() =>
  size.value === null ? { maxHeight: props.max } : { height: `${size.value}px` },
)

const limit = (value: number) =>
  Math.min(Math.max(value, MIN), Math.max(MIN, window.innerHeight - 120))

const held = ref<{ id: number; y: number; from: number } | null>(null)

const onDown = (event: PointerEvent) => {
  const element = scroller.value
  if (event.button !== 0 || !element) return
  held.value = { id: event.pointerId, y: event.clientY, from: element.clientHeight }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}

const onDrag = (event: PointerEvent) => {
  const drag = held.value
  if (!drag || drag.id !== event.pointerId) return
  size.value = limit(drag.from + (event.clientY - drag.y))
  const element = scroller.value
  if (element && follow.value) element.scrollTop = element.scrollHeight
}

const onDrop = (event: PointerEvent) => {
  if (held.value?.id !== event.pointerId) return
  held.value = null
  if (size.value !== null) localStorage.setItem(KEY, String(size.value))
}

const onReset = () => {
  size.value = null
  localStorage.removeItem(KEY)
}

const step = (by: number) => {
  const element = scroller.value
  if (!element) return
  size.value = limit(element.clientHeight + by)
  localStorage.setItem(KEY, String(size.value))
}

const onScroll = () => {
  const element = scroller.value
  if (!element) return
  follow.value = element.scrollHeight - element.scrollTop - element.clientHeight < 24
}

watch(
  () => lines.value.length,
  async () => {
    if (!follow.value) return
    await nextTick()
    const element = scroller.value
    if (element) element.scrollTop = element.scrollHeight
  },
)
</script>

<template>
  <div class="relative flex min-h-0 flex-col border border-line bg-canvas">
    <header class="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
      <p class="t-eyebrow">Logs</p>
      <span class="ml-auto font-mono text-[0.625rem] tabular-nums text-faint"
        >{{ lines.length }} lines</span
      >
      <Checkbox v-model="follow" title="Keep the newest line in view as output arrives"
        >follow</Checkbox
      >
      <Button
        size="sm"
        :disabled="!lines.length"
        :title="
          chosen
            ? `Forget what ccwt has kept for ${chosen}`
            : 'Forget everything ccwt has kept for this worktree'
        "
        @click="emit('clear', chosen)"
        >clear</Button
      >
    </header>

    <div v-if="named.length > 1" class="t-rail shrink-0" role="tablist" aria-label="Service">
      <button
        v-for="name in named"
        :key="name"
        type="button"
        role="tab"
        :aria-selected="chosen === name"
        class="t-rail-item"
        @click="chosen = name"
      >
        <span class="t-tab-label">{{ name }}</span>
      </button>
    </div>

    <div
      ref="scroller"
      class="ccwt-log min-h-0 grow overflow-y-auto px-3 py-2"
      :style="box"
      @scroll="onScroll"
    >
      <p v-if="!lines.length" class="font-sans text-[0.6875rem] text-faint">
        {{
          chosen
            ? `Nothing from ${chosen} yet.`
            : 'Nothing yet. Start a service and its output lands here.'
        }}
      </p>
      <div v-for="(line, index) in lines" :key="index" class="min-h-[1.55em]">
        <span v-for="(part, at) in parse(line)" :key="at" :class="paint(part)">{{ part.text }}</span>
      </div>
    </div>

    <button
      type="button"
      class="absolute right-0 bottom-0 flex size-4 cursor-ns-resize touch-none items-end justify-end p-0.5 text-faint hover:text-dim"
      title="Drag to resize, double-click to reset"
      aria-label="Resize the log"
      @pointerdown="onDown"
      @pointermove="onDrag"
      @pointerup="onDrop"
      @pointercancel="onDrop"
      @dblclick="onReset"
      @keydown.up.prevent="step(-24)"
      @keydown.down.prevent="step(24)"
    >
      <svg
        viewBox="0 0 8 8"
        width="8"
        height="8"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8 1.5 1.5 8M8 5 5 8" />
      </svg>
    </button>
  </div>
</template>
