<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-vue-next'
import { NAV } from '../nav'

const route = useRoute()
const { sidebarCollapsed, toggleSidebar, openGuide } = useShell()
const { dark, toggle } = useTheme()

const pages = computed(() => NAV.filter((item) => item.nav === 'page'))
const pinned = computed(() => NAV.filter((item) => item.nav === 'pinned'))

const active = (path: string) => (path === '/' ? route.path === '/' : route.path.startsWith(path))

const ITEM = 'relative flex w-full items-center gap-2 text-left font-mono transition-colors'
const ACTIVE =
  'bg-raised text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-ink'
const IDLE = 'text-dim hover:text-ink'

const PAD = computed(() => (sidebarCollapsed.value ? 'justify-center px-0' : 'px-4'))

const hint = (label: string) => (sidebarCollapsed.value ? label : undefined)
</script>

<template>
  <nav
    class="flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150"
    :class="sidebarCollapsed ? 'w-14' : 'w-56'"
  >
    <div
      class="flex items-center border-b border-line py-3"
      :class="sidebarCollapsed ? 'justify-center px-0' : 'px-4'"
    >
      <div v-if="!sidebarCollapsed" class="min-w-0 flex-1">
        <p class="font-mono text-sm font-bold tracking-[0.18em] text-ink">ccwt</p>
        <p class="t-eyebrow mt-1">claude code worktrees</p>
      </div>
      <button
        type="button"
        class="flex size-6 shrink-0 items-center justify-center text-faint transition-colors hover:text-ink"
        :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!sidebarCollapsed"
        :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleSidebar"
      >
        <component
          :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose"
          :size="13"
          class="shrink-0"
          aria-hidden="true"
        />
      </button>
    </div>

    <ul class="flex flex-col py-2">
      <li v-for="item in pages" :key="item.name">
        <NuxtLink
          :to="item.path"
          class="h-8 text-xs"
          :class="[ITEM, PAD, active(item.path) ? ACTIVE : IDLE]"
          :aria-current="active(item.path) ? 'page' : undefined"
          :title="hint(item.title)"
        >
          <component :is="item.icon" :size="13" class="shrink-0" aria-hidden="true" />
          <span :class="sidebarCollapsed ? 'sr-only' : 'flex-1'">{{ item.title }}</span>
        </NuxtLink>
      </li>
    </ul>

    <div class="mt-auto border-t border-line">
      <NuxtLink
        v-for="item in pinned"
        :key="item.name"
        :to="item.path"
        class="h-9 border-b border-line text-xs"
        :class="[ITEM, PAD, active(item.path) ? ACTIVE : IDLE]"
        :aria-current="active(item.path) ? 'page' : undefined"
        :title="hint(item.title)"
      >
        <component :is="item.icon" :size="13" class="shrink-0" aria-hidden="true" />
        <span :class="sidebarCollapsed ? 'sr-only' : 'flex-1'">{{ item.title }}</span>
      </NuxtLink>

      <button
        type="button"
        class="h-9 border-b border-line text-xs text-dim transition-colors hover:bg-raised hover:text-ink"
        :class="[ITEM, PAD]"
        :title="hint('Guide')"
        @click="openGuide"
      >
        <BookOpen :size="13" class="shrink-0" aria-hidden="true" />
        <span :class="sidebarCollapsed ? 'sr-only' : 'flex-1'">Guide</span>
      </button>

      <button
        type="button"
        class="h-9 text-dim transition-colors hover:bg-raised hover:text-ink"
        :class="[ITEM, PAD]"
        :title="hint('Theme')"
        @click="toggle"
      >
        <component :is="dark ? Sun : Moon" :size="13" class="shrink-0" aria-hidden="true" />
        <span :class="sidebarCollapsed ? 'sr-only' : 't-eyebrow flex-1'">Theme</span>
        <span v-if="!sidebarCollapsed" class="font-mono text-[0.6875rem] text-dim">{{
          dark ? 'dark' : 'light'
        }}</span>
      </button>
    </div>
  </nav>
</template>
