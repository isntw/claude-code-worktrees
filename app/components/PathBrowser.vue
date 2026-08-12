<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CornerLeftUp, Folder, GitBranch } from 'lucide-vue-next'
import type { DirEntry, DirListing } from '#shared/types'
import { shortenHome } from '../format'

const emit = defineEmits<{ pick: [path: string] }>()

const api = useApi()

const listing = ref<DirListing | null>(null)
const loading = ref(false)
const failure = ref<string | null>(null)
const showHidden = ref(false)

const go = async (path?: string) => {
  loading.value = true
  failure.value = null
  try {
    listing.value = await api.listDir(path)
  } catch (cause) {
    failure.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

const entries = computed(() =>
  (listing.value?.entries ?? []).filter((entry) => showHidden.value || !entry.hidden || entry.repo),
)

const hiddenCount = computed(
  () => (listing.value?.entries ?? []).filter((entry) => entry.hidden && !entry.repo).length,
)

const short = (path: string) => shortenHome(path, listing.value?.home)

const rowClass = (entry: DirEntry) =>
  entry.noise ? 'text-faint' : entry.repo ? 'text-ink' : 'text-dim'

onMounted(() => go())
</script>

<template>
  <div class="flex flex-col border border-line bg-canvas">
    <header class="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 py-1.5">
      <Button
        size="sm"
        icon
        :disabled="!listing?.parent || loading"
        title="Up one directory"
        @click="go(listing?.parent ?? undefined)"
      >
        <CornerLeftUp :size="12" aria-hidden="true" />
      </Button>
      <code class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-dim">{{
        listing ? short(listing.path) : '…'
      }}</code>
      <Checkbox v-if="hiddenCount" v-model="showHidden">
        {{ hiddenCount }} hidden
      </Checkbox>
    </header>

    <p v-if="failure" class="px-3 py-2 font-sans text-[0.6875rem] text-alarm">{{ failure }}</p>

    <ul v-else class="max-h-64 min-h-0 flex-1 overflow-y-auto">
      <li v-for="entry in entries" :key="entry.path">
        <div class="flex items-center gap-2 border-b border-line px-2 py-1 last:border-b-0">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-ink"
            :class="rowClass(entry)"
            :disabled="entry.noise"
            @click="go(entry.path)"
          >
            <component
              :is="entry.repo ? GitBranch : Folder"
              :size="12"
              class="shrink-0"
              aria-hidden="true"
            />
            <span class="truncate font-mono text-[0.6875rem]">{{ entry.name }}</span>
            <span
              v-if="entry.branch"
              class="shrink-0 truncate font-mono text-[0.625rem] text-faint"
              >{{ entry.branch }}</span
            >
          </button>

          <Badge v-if="entry.known" variation="info">registered</Badge>
          <span v-else-if="entry.noise" class="t-eyebrow">skipped</span>
          <Button v-else-if="entry.repo" size="sm" @click="emit('pick', entry.path)">use</Button>
        </div>
      </li>

      <li v-if="!entries.length && !loading" class="px-3 py-2 font-sans text-[0.6875rem] text-faint">
        No directories here.
      </li>
    </ul>

    <p
      v-if="listing?.truncated"
      class="shrink-0 border-t border-line px-3 py-1.5 font-sans text-[0.625rem] text-caution"
    >
      Only the first 500 directories are shown — narrow the path.
    </p>
  </div>
</template>
