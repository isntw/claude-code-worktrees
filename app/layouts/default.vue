<script setup lang="ts">
const { guideOpen, closeGuide } = useShell()
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <ConsoleSidebar class="hidden lg:flex" />

    <div class="flex min-w-0 flex-1 flex-col">
      <slot />
    </div>

    <OnboardingModal v-if="guideOpen" @close="closeGuide" />
  </div>
</template>
