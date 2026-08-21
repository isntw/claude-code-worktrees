<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number
    accent?: boolean
  }>(),
  { size: 24, accent: true },
)
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
    <g fill="currentColor">
      <rect x="0" y="0" width="15" height="3" /><rect x="0" y="3" width="3" height="3" /><rect x="0" y="6" width="3" height="3" />
      <rect x="0" y="9" width="3" height="3" /><rect x="0" y="12" width="15" height="3" /><rect x="17" y="0" width="15" height="3" />
      <rect x="17" y="3" width="3" height="3" /><rect x="17" y="6" width="3" height="3" /><rect x="17" y="9" width="3" height="3" />
      <rect x="17" y="12" width="15" height="3" />
    </g>
    <g fill="currentColor" :class="accent ? 'text-agent' : undefined">
      <rect x="0" y="17" width="3" height="3" /><rect x="12" y="17" width="3" height="3" /><rect x="0" y="20" width="3" height="3" />
      <rect x="12" y="20" width="3" height="3" /><rect x="0" y="23" width="3" height="3" /><rect x="6" y="23" width="3" height="3" />
      <rect x="12" y="23" width="3" height="3" /><rect x="0" y="26" width="6" height="3" /><rect x="9" y="26" width="6" height="3" />
      <rect x="0" y="29" width="3" height="3" /><rect x="12" y="29" width="3" height="3" /><rect x="17" y="17" width="15" height="3" />
      <rect x="23" y="20" width="3" height="3" /><rect x="23" y="23" width="3" height="3" /><rect x="23" y="26" width="3" height="3" />
      <rect x="23" y="29" width="3" height="3" />
    </g>
  </svg>
</template>
