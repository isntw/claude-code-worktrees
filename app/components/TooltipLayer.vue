<script setup lang="ts">
import { computed } from 'vue'
import { bubble, described, shown } from '../composables/useTooltip'

const said = computed(() =>
  shown.text.split(/`([^`]+)`/).map((piece, index) => ({ text: piece, code: index % 2 === 1 })),
)

const parts = computed(() => {
  let left = shown.typed
  let marked = false
  return said.value.map((piece) => {
    const take = Math.max(0, Math.min(piece.text.length, left))
    left -= take
    const boundary = !marked && take < piece.text.length
    if (boundary) marked = true
    return {
      code: piece.code,
      seen: piece.text.slice(0, take),
      rest: piece.text.slice(take),
      cursor: boundary,
    }
  })
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="bubble"
      role="tooltip"
      :class="shown.id ? 't-tooltip' : 'sr-only'"
      :style="
        shown.id
          ? {
              top: `${shown.at.top}px`,
              left: `${shown.at.left}px`,
              opacity: shown.placed ? 1 : 0,
            }
          : undefined
      "
    >
      <span
        v-if="shown.id"
        class="t-tooltip-caret"
        :data-side="shown.caret.side"
        :style="
          shown.caret.side === 'top' || shown.caret.side === 'bottom'
            ? { left: `${shown.caret.offset}px` }
            : { top: `${shown.caret.offset}px` }
        "
      />
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

    <span v-for="[id, text] of described" :key="id" :id="id" class="sr-only">{{ text }}</span>
  </Teleport>
</template>
