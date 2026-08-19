<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { LogLine } from '#shared/types'
import { segments, type Segment, type Tone } from '../ansi'

const props = withDefaults(defineProps<{ lines: LogLine[]; max?: string }>(), {
  max: '18rem',
})

const emit = defineEmits<{ clear: [] }>()

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

const mixed = computed(() => new Set(props.lines.map((line) => line.service)).size > 1)

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
        title="Forget everything ccwt has kept for this worktree"
        @click="emit('clear')"
        >clear</Button
      >
    </header>

    <div
      ref="scroller"
      class="ccwt-log min-h-0 grow overflow-y-auto px-3 py-2"
      :style="box"
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
