<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Check, Minus, X } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ToolCheck, ToolState } from '#shared/types'
import type { Variation } from './variation'

const emit = defineEmits<{ close: [] }>()

const api = useApi()

const tools = ref<ToolCheck[] | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const STEPS = [
  {
    name: 'register',
    body: 'ccwt reads a repository’s package manager and dev script. The recipe is kept in ~/.ccwt — no file is ever written into the repo itself.',
  },
  {
    name: 'worktree',
    body: 'A branch and a directory of its own under .claude/worktrees, so two pieces of work never share a checkout.',
  },
  {
    name: 'provision',
    body: 'Gitignored files like .env are copied in, and node_modules is hardlinked from the root checkout or installed.',
  },
  {
    name: 'ports',
    body: 'A free port per service, per worktree — remembered in worktree-scoped git config and handed to the process as PORT.',
  },
  {
    name: 'run',
    body: 'Services start, logs stream live, and the card shows what is reachable. Removing a worktree keeps the branch.',
  },
]

const VARIATION: Record<ToolState, Variation> = {
  present: 'live',
  outdated: 'warning',
  missing: 'error',
}

const ICON: Record<ToolState, Component> = {
  present: Check,
  outdated: AlertTriangle,
  missing: X,
}

const TINT: Record<Variation, string> = {
  neutral: 'text-faint',
  info: 'text-dim',
  success: 'text-ink',
  live: 'text-live',
  warning: 'text-caution',
  error: 'text-alarm',
}

const ok = computed(
  () => tools.value?.every((tool) => !tool.required || tool.state === 'present') ?? false,
)

const rows = computed(() =>
  (tools.value ?? []).map((tool) => {
    const spare = tool.state === 'missing' && !tool.required

    return {
      ...tool,
      icon: spare ? Minus : ICON[tool.state],
      tint: TINT[spare ? 'neutral' : VARIATION[tool.state]],
      said: tool.state === 'missing' ? 'not found' : (tool.version ?? 'installed'),
    }
  }),
)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    tools.value = await api.getRequirements()
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <ModalPanel title="Welcome to ccwt" @close="emit('close')">
    <div class="flex flex-col gap-5">
      <p class="max-w-prose font-sans text-xs leading-relaxed text-dim">
        ccwt runs a git worktree as a running environment — its own files, its own dependencies, its
        own port, its own dev server — so several branches can be alive at once and you can see which
        of them is up.
      </p>

      <section>
        <div class="mb-2 flex items-center gap-2 border-b border-line pb-1.5">
          <p class="t-eyebrow">Preflight</p>
          <p
            v-if="tools"
            class="ml-auto font-mono text-[0.625rem]"
            :class="TINT[ok ? 'live' : 'error']"
          >
            {{ ok ? 'ready' : 'action needed' }}
          </p>
        </div>

        <p v-if="error" class="font-sans text-[0.6875rem] text-alarm">{{ error }}</p>
        <p v-else-if="!tools" class="font-sans text-[0.6875rem] text-faint">checking…</p>

        <ul v-else class="flex flex-col gap-2">
          <li v-for="row in rows" :key="row.name" class="flex items-baseline gap-3">
            <component
              :is="row.icon"
              :size="12"
              class="shrink-0 self-start"
              :class="row.tint"
              aria-hidden="true"
            />
            <span class="w-10 shrink-0 font-mono text-[0.6875rem] font-semibold text-ink">{{
              row.name
            }}</span>
            <span class="w-28 shrink-0 font-mono text-[0.625rem]">
              <span :class="row.state === 'missing' ? 'text-faint' : 'text-dim'">{{ row.said }}</span>
              <span v-if="row.minimum" class="text-faint"> ≥{{ row.minimum }}</span>
            </span>
            <span class="min-w-0 flex-1 font-sans text-[0.6875rem] leading-relaxed text-dim">
              {{ row.purpose }}
              <span v-if="row.state !== 'present'" class="font-mono text-[0.625rem]" :class="row.tint">
                — {{ row.install }}
              </span>
            </span>
            <Badge v-if="!row.required" class="shrink-0">optional</Badge>
          </li>
        </ul>
      </section>

      <section>
        <p class="t-eyebrow mb-2 border-b border-line pb-1.5">Pipeline</p>

        <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <template v-for="(step, index) in STEPS" :key="step.name">
            <span v-if="index" class="font-mono text-[0.625rem] text-faint" aria-hidden="true"
              >→</span
            >
            <Badge mono variation="success" class="border-line! bg-canvas">{{ step.name }}</Badge>
          </template>
        </div>

        <ol class="mt-3 flex flex-col gap-1.5">
          <li v-for="step in STEPS" :key="step.name" class="flex gap-3">
            <span class="w-16 shrink-0 font-mono text-[0.625rem] text-faint">{{ step.name }}</span>
            <span class="min-w-0 flex-1 font-sans text-[0.6875rem] leading-relaxed text-dim">{{
              step.body
            }}</span>
          </li>
        </ol>
      </section>
    </div>

    <template #footer>
      <Button size="sm" :disabled="loading" @click="load">{{
        loading ? 'checking…' : 're-check'
      }}</Button>
      <Button size="sm" variation="success" :outline="false" @click="emit('close')">got it</Button>
    </template>
  </ModalPanel>
</template>
