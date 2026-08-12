<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LogLine } from '#shared/types'

const props = withDefaults(defineProps<{ lines: LogLine[]; height?: string }>(), {
  height: '18rem',
})

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
      <p
        v-for="(line, index) in lines"
        :key="index"
        :class="line.stream === 'stderr' ? 'text-alarm' : 'text-dim'"
      >
        {{ line.text }}
      </p>
    </div>
  </div>
</template>
