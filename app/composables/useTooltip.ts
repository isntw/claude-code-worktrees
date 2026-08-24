import { onBeforeUnmount, reactive, ref, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

export type Placement = 'top' | 'bottom' | 'left' | 'right'

export type TooltipOptions = {
  placement?: MaybeRefOrGetter<Placement>
  duration?: MaybeRefOrGetter<number>
}

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
const RUN = 650

export const described = reactive(new Map<string, string>())

export const shown = reactive({
  id: '',
  text: '',
  at: { top: 0, left: 0 },
  caret: { side: 'bottom' as Placement, offset: 0 },
  placed: false,
  typed: 0,
})

export const bubble = shallowRef<HTMLElement | null>(null)

let count = 0

const clamp = (value: number, least: number, most: number) =>
  Math.min(Math.max(value, least), Math.max(least, most))

const quiet = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const place = (anchor: HTMLElement | null, want: Placement) => {
  const from = anchor?.getBoundingClientRect()
  const box = bubble.value?.getBoundingClientRect()
  if (!from || !box) return

  const room: Record<Placement, number> = {
    top: from.top,
    bottom: window.innerHeight - from.bottom,
    left: from.left,
    right: window.innerWidth - from.right,
  }

  const sideways = want === 'left' || want === 'right'
  const needed = (sideways ? box.width : box.height) + GAP + EDGE
  const other = OPPOSITE[want]
  const side = room[want] < needed && room[other] > room[want] ? other : want

  const middle = { x: from.left + from.width / 2, y: from.top + from.height / 2 }

  const top = sideways
    ? clamp(middle.y - box.height / 2, EDGE, window.innerHeight - box.height - EDGE)
    : side === 'top'
      ? from.top - box.height - GAP
      : from.bottom + GAP

  const left = sideways
    ? side === 'left'
      ? from.left - box.width - GAP
      : from.right + GAP
    : clamp(middle.x - box.width / 2, EDGE, window.innerWidth - box.width - EDGE)

  shown.at = { top, left }
  shown.caret = {
    side: OPPOSITE[side],
    offset: sideways
      ? clamp(middle.y - top, INSET, box.height - INSET)
      : clamp(middle.x - left, INSET, box.width - INSET),
  }
  shown.placed = true
}

export function useTooltip(
  anchor: Ref<HTMLElement | null>,
  text: MaybeRefOrGetter<string | undefined>,
  options: TooltipOptions = {},
) {
  const id = `tip-${++count}`
  const mine = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let frame: number | null = null

  const said = () => toValue(text) ?? ''
  const where = () => toValue(options.placement) ?? 'top'
  const run = () => {
    const asked = toValue(options.duration)
    return Number.isFinite(asked) ? Math.max(0, asked as number) : RUN
  }

  watch(
    () => said(),
    (value) => {
      if (value) described.set(id, value)
      else described.delete(id)
      if (mine.value) shown.text = value
    },
    { immediate: true },
  )

  const halt = () => {
    if (frame === null) return
    cancelAnimationFrame(frame)
    frame = null
  }

  const type = () => {
    halt()
    const total = said().length
    const span = run()
    if (!total || !span || quiet()) {
      shown.typed = total
      return
    }
    shown.typed = 0
    const began = performance.now()
    const step = (now: number) => {
      const share = Math.min(1, (now - began) / span)
      shown.typed = Math.round(total * share)
      frame = share < 1 ? requestAnimationFrame(step) : null
    }
    frame = requestAnimationFrame(step)
  }

  const reposition = () => place(anchor.value, where())

  const listen = (on: boolean) => {
    if (on) {
      window.addEventListener('scroll', reposition, true)
      window.addEventListener('resize', reposition)
      window.addEventListener('keydown', dismiss)
      return
    }
    window.removeEventListener('scroll', reposition, true)
    window.removeEventListener('resize', reposition)
    window.removeEventListener('keydown', dismiss)
  }

  const dismiss = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide()
  }

  const hide = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!mine.value) return
    halt()
    listen(false)
    mine.value = false
    shown.id = ''
    shown.placed = false
  }

  const show = () => {
    if (!said() || mine.value) return
    mine.value = true
    shown.id = id
    shown.text = said()
    shown.placed = false
    type()
    listen(true)
    requestAnimationFrame(reposition)
  }

  const arm = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(show, WAIT)
  }

  const bind = (element: HTMLElement | null, on: boolean) => {
    if (!element) return
    const how = on ? 'addEventListener' : 'removeEventListener'
    element[how]('mouseenter', arm)
    element[how]('mouseleave', hide)
    element[how]('focusin', show)
    element[how]('focusout', hide)
  }

  watch(
    [anchor, () => Boolean(said())],
    ([element, wanted], previous) => {
      const before = previous?.[0]
      if (before) bind(before, false)
      if (wanted && element) bind(element, true)
      else if (!wanted) hide()
    },
    { immediate: true, flush: 'post' },
  )

  onBeforeUnmount(() => {
    hide()
    bind(anchor.value, false)
    described.delete(id)
  })

  return { id }
}
