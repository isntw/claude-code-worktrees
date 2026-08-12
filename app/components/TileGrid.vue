<script setup lang="ts">
export interface Tile {
  key: string
  label: string
  total: number
  errors: number
  note?: string
  inert?: boolean
  go: () => void
}

withDefaults(
  defineProps<{
    tiles: Tile[]
    dense?: boolean
  }>(),
  { dense: false },
)
</script>

<template>
  <div
    class="grid gap-2"
    :class="
      dense
        ? 'sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6'
        : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
    "
  >
    <button
      v-for="tile in tiles"
      :key="tile.key"
      type="button"
      class="group flex flex-col border border-line px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-raised"
      :class="tile.inert ? 'bg-canvas' : 'bg-surface'"
      @click="tile.go()"
    >
      <div class="flex h-4 w-full items-baseline gap-2">
        <span
          class="truncate font-mono text-[0.6875rem] transition-colors group-hover:text-ink"
          :class="tile.inert ? 'text-faint' : 'text-dim'"
          :title="tile.label"
          >{{ tile.label }}</span
        >
        <span v-if="tile.errors" class="ml-auto flex shrink-0 items-center gap-1 self-center">
          <span class="size-1.5 bg-alarm" />
          <span class="font-mono text-[0.625rem] tabular-nums text-alarm">{{ tile.errors }}</span>
        </span>
      </div>

      <p class="t-numeral mt-1.5" :class="{ 'text-faint': tile.inert }">
        {{ tile.total.toLocaleString() }}
      </p>

      <p
        v-if="tile.note"
        class="mt-1 truncate font-mono text-[0.625rem] text-faint"
        :title="tile.note"
      >
        {{ tile.note }}
      </p>
    </button>
  </div>
</template>
