<script setup lang="ts">
import { NAV } from '../nav'

const page = NAV.find((entry) => entry.name === 'settings')!
</script>

<template>
  <ConsoleHeader :title="page.title" :blurb="page.blurb" />

  <main class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="grid gap-4">
      <AddressPanel />
      <ForgePanel />
      <PluginPanel />
    </div>
  </main>
</template>
