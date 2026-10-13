<script setup lang="ts">
const ROWS = [
  { name: 'feat-login', here: true, service: 'web', state: 'up', port: 5601, action: 'stop web', key: 'x' },
  { name: 'fix-ports', here: false, service: 'web', state: 'stopped', port: 5602, action: 'start web', key: '' },
]
</script>

<template>
  <figure class="border border-line bg-canvas font-mono text-[0.6875rem] leading-relaxed">
    <figcaption class="border-b border-line px-2 py-1 font-sans text-[0.625rem] text-faint">
      preview, in a Claude Code session
    </figcaption>

    <div class="px-2 py-2">
      <p class="truncate text-dim">
        <span class="text-faint">*</span> Reading app/pages/login.vue
      </p>

      <div class="mt-1.5 border border-line px-2 py-1">
        <div class="flex justify-between gap-3">
          <span class="truncate text-faint">ccwt . my-project . 2 worktrees this session</span>
          <span class="text-dim underline">dashboard</span>
        </div>
        <div
          v-for="(row, index) in ROWS"
          :key="row.name"
          class="grid grid-cols-[7.5rem_13rem_6.5rem_5.5rem] gap-x-3 whitespace-nowrap"
        >
          <span :class="row.here ? 'font-semibold text-ink' : 'text-faint'"
            >{{ row.here ? '> ' : '&nbsp;&nbsp;' }}{{ row.name }}</span
          >
          <span class="truncate">
            <span :class="row.state === 'up' ? 'text-success' : 'text-faint'"
              >{{ row.service }} {{ row.state }}</span
            >
            <span class="ml-1.5 text-dim underline">localhost:{{ row.port }}</span>
          </span>
          <span class="text-ink"
            ><span v-if="row.key" class="font-semibold text-ink">{{ row.key }}: </span>{{ row.action }}</span
          >
          <span class="text-faint"><span v-if="index === 0" class="font-semibold text-ink">d: </span>details</span>
        </div>
      </div>

      <p class="mt-1.5 text-ink"><span class="text-faint">&gt;</span></p>
      <p class="truncate text-faint">
        ? for shortcuts
        <span class="ml-2">ccwt&nbsp;&nbsp;feat-login&nbsp;&nbsp;web :5601 up&nbsp;&nbsp;+1 more</span>
      </p>
    </div>
  </figure>
</template>
