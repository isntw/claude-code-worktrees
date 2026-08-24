<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

export type Placement = 'top' | 'bottom' | 'left' | 'right'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    text: string
    placement?: Placement
    duration?: number
  }>(),
  { placement: 'top', duration: 2000 },
)

const OPPOSITE: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

const GAP = 7
const EDGE = 8
const INSET = 11
const WAIT = 200

const id = useId()
const trigger = ref<HTMLElement | null>(null)
const bubble = ref<HTMLElement | null>(null)
const open = ref(false)
const placed = ref(false)
const at = ref({ top: 0, left: 0 })
const caret = ref({ side: 'bottom' as Placement, offset: 0 })
const shown = ref(0)

let timer: ReturnType<typeof setTimeout> | null = null
let frame: number | null = null

const said = computed(() =>
  props.text.split(/`([^`]+)`/).map((piece, index) => ({ text: piece, code: index % 2 === 1 })),
)

const size = computed(() => said.value.reduce((count, piece) => count + piece.text.length, 0))

const parts = computed(() => {
  const whole = !open.value
  let left = whole ? size.value : shown.value
  let marked = false
  return said.value.map((piece) => {
    const take = Math.max(0, Math.min(piece.text.length, left))
    left -= take
    const boundary = !whole && !marked && take < piece.text.length
    if (boundary) marked = true
    return {
      code: piece.code,
      seen: piece.text.slice(0, take),
      rest: piece.text.slice(take),
      cursor: boundary,
    }
  })
})

const clamp = (value: number, least: number, most: number) =>
  Math.min(Math.max(value, least), Math.max(least, most))

const place = () => {
  const anchor = trigger.value?.getBoundingClientRect()
  const box = bubble.value?.getBoundingClientRect()
  if (!anchor || !box) return

  const room: Record<Placement, number> = {
    top: anchor.top,
    bottom: window.innerHeight - anchor.bottom,
    left: anchor.left,
    right: window.innerWidth - anchor.right,
  }

  const sideways = props.placement === 'left' || props.placement === 'right'
  const needed = (sideways ? box.width : box.height) + GAP + EDGE

  const other = OPPOSITE[props.placement]
  const side =
    room[props.placement] < needed && room[other] > room[props.placement] ? other : props.placement

  const middle = { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 }

  const top = sideways
    ? clamp(middle.y - box.height / 2, EDGE, window.innerHeight - box.height - EDGE)
    : side === 'top'
      ? anchor.top - box.height - GAP
      : anchor.bottom + GAP

  const left = sideways
    ? side === 'left'
      ? anchor.left - box.width - GAP
      : anchor.right + GAP
    : clamp(middle.x - box.width / 2, EDGE, window.innerWidth - box.width - EDGE)

  at.value = { top, left }
  caret.value = {
    side: OPPOSITE[side],
    offset: sideways
      ? clamp(middle.y - top, INSET, box.height - INSET)
      : clamp(middle.x - left, INSET, box.width - INSET),
  }
  placed.value = true
}

const halt = () => {
  if (frame === null) return
  cancelAnimationFrame(frame)
  frame = null
}

const type = () => {
  halt()
  const total = size.value
  const run = Number.isFinite(props.duration) ? Math.max(0, props.duration) : 0
  if (!total || !run || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    shown.value = total
    return
  }

  shown.value = 0
  const began = performance.now()
  const step = (now: number) => {
    const share = Math.min(1, (now - began) / run)
    shown.value = Math.round(total * share)
    frame = share < 1 ? requestAnimationFrame(step) : null
  }
  frame = requestAnimationFrame(step)
}

const disarm = () => {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
}

const show = () => {
  disarm()
  if (open.value) return
  placed.value = false
  open.value = true
  type()
  void nextTick(place)
}

const arm = () => {
  disarm()
  timer = setTimeout(show, WAIT)
}

const hide = () => {
  disarm()
  halt()
  open.value = false
}

const dismiss = (event: KeyboardEvent) => {
  if (event.key === 'Escape') hide()
}

const listen = (on: boolean) => {
  if (on) {
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.addEventListener('keydown', dismiss)
    return
  }
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
  window.removeEventListener('keydown', dismiss)
}

const nib = computed(() =>
  caret.value.side === 'top' || caret.value.side === 'bottom'
    ? { left: `${caret.value.offset}px` }
    : { top: `${caret.value.offset}px` },
)

watch(open, listen)

onBeforeUnmount(() => {
  disarm()
  halt()
  listen(false)
})
</script>

<template>
  <span
    ref="trigger"
    class="inline-flex"
    v-bind="$attrs"
    :aria-describedby="id"
    @mouseenter="arm"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    ><slot
  /></span>

  <Teleport to="body">
    <div
      :id="id"
      ref="bubble"
      role="tooltip"
      :class="open ? 't-tooltip' : 'sr-only'"
      :style="
        open ? { top: `${at.top}px`, left: `${at.left}px`, opacity: placed ? 1 : 0 } : undefined
      "
    >
      <span v-if="open" class="t-tooltip-caret" :data-side="caret.side" :style="nib" />
      <span class="t-tooltip-text"
        ><template v-for="(piece, index) in parts" :key="index"
          ><code v-if="piece.code"
            >{{ piece.seen
            }}<span v-if="piece.cursor" class="t-tooltip-cursor" aria-hidden="true" /><span
              class="t-tooltip-veil"
              >{{ piece.rest }}</span
            ></code
          ><template v-else
            >{{ piece.seen
            }}<span v-if="piece.cursor" class="t-tooltip-cursor" aria-hidden="true" /><span
              class="t-tooltip-veil"
              >{{ piece.rest }}</span
            ></template
          ></template
        ></span
      >
    </div>
  </Teleport>
</template>
