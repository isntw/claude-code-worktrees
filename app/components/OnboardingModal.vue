<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, Check, ExternalLink, Minus, X } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ToolCheck, ToolState } from '#shared/types'
import { tone } from './variation'
import type { Variation } from './variation'

const emit = defineEmits<{ close: [] }>()

const api = useApi()
const forge = useForgeAuth()
const plugin = usePluginSetup()

const STEPS = [
  { name: 'preflight', title: 'Preflight', optional: false },
  { name: 'github', title: 'GitHub', optional: true },
  { name: 'plugin', title: 'Claude Code', optional: true },
] as const

const VARIATION: Record<ToolState, Variation> = {
  present: 'success',
  outdated: 'warning',
  missing: 'error',
}

const ICON: Record<ToolState, Component> = {
  present: Check,
  outdated: AlertTriangle,
  missing: X,
}

const tint = (variation: Variation) => `${tone(variation)} text-[var(--tone-quiet)]`

const at = ref(0)
const tools = ref<ToolCheck[] | null>(null)
const loading = ref(false)
const toolError = ref<string | null>(null)

const last = computed(() => at.value === STEPS.length - 1)

const ok = computed(
  () => tools.value?.every((tool) => !tool.required || tool.state === 'present') ?? false,
)

const rows = computed(() =>
  (tools.value ?? []).map((tool) => {
    const spare = tool.state === 'missing' && !tool.required

    return {
      ...tool,
      icon: spare ? Minus : ICON[tool.state],
      tint: tint(spare ? 'neutral' : VARIATION[tool.state]),
      said: tool.state === 'missing' ? 'not found' : (tool.version ?? 'installed'),
    }
  }),
)

const marks = computed<(Variation | null)[]>(() => [
  tools.value ? (ok.value ? 'success' : 'error') : null,
  forge.configured.value === false ? 'warning' : forge.signedIn.value ? 'success' : null,
  plugin.installed.value
    ? 'success'
    : plugin.state.value === 'disabled'
      ? 'warning'
      : null,
])

const status = computed<{ text: string; tint: string } | null>(() => {
  if (at.value === 0) {
    if (!tools.value) return null
    return ok.value
      ? { text: 'ready', tint: tint('success') }
      : { text: 'action needed', tint: tint('error') }
  }

  if (at.value === 1) {
    if (!forge.session.value) return null
    if (!forge.configured.value) return { text: 'unavailable', tint: tint('warning') }
    return forge.signedIn.value
      ? { text: 'connected', tint: tint('success') }
      : { text: 'not connected', tint: tint('neutral') }
  }

  if (!plugin.state.value) return null
  return { text: plugin.says.value, tint: tint(plugin.look.value) }
})

const commands = computed(() =>
  plugin.state.value === 'absent' ? (plugin.report.value?.commands ?? []) : [],
)

const load = async () => {
  loading.value = true
  toolError.value = null
  try {
    tools.value = await api.getRequirements()
  } catch (cause) {
    toolError.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <ModalPanel title="Welcome to ccwt" @close="emit('close')">
    <section class="flex min-h-[8rem] flex-col">
      <div class="mb-2.5 flex items-center gap-2.5 border-b border-line pb-1.5">
        <div class="-my-1 flex items-center gap-1">
          <button
            v-for="(step, index) in STEPS"
            :key="step.name"
            type="button"
            class="flex size-4 items-center justify-center"
            :title="step.title"
            :aria-label="step.title"
            :aria-current="index === at ? 'step' : undefined"
            @click="at = index"
          >
            <StateDot
              :variation="index === at ? 'primary' : (marks[index] ?? 'neutral')"
              :outline="index !== at && !marks[index]"
            />
          </button>
        </div>

        <p class="t-eyebrow">{{ STEPS[at]!.title }}</p>
        <Badge v-if="STEPS[at]!.optional" size="sm">optional</Badge>

        <p v-if="status" class="ml-auto font-mono text-[0.625rem]" :class="status.tint">
          {{ status.text }}
        </p>
      </div>

      <template v-if="at === 0">
        <p v-if="toolError" class="font-sans text-[0.6875rem] text-alarm">{{ toolError }}</p>
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
            <span class="w-24 shrink-0 font-mono text-[0.625rem]">
              <span :class="row.state === 'missing' ? 'text-faint' : 'text-dim'">{{ row.said }}</span>
              <span v-if="row.minimum" class="text-faint"> ≥{{ row.minimum }}</span>
            </span>
            <span class="min-w-0 flex-1 font-sans text-[0.6875rem] leading-relaxed text-dim">
              {{ row.purpose }}
            </span>
          </li>
        </ul>

        <div v-if="tools && !ok" class="mt-3 border border-alarm px-3 py-2">
          <p
            v-for="row in rows.filter((tool) => tool.state !== 'present')"
            :key="row.name"
            class="font-mono text-[0.6875rem]"
            :class="row.tint"
          >
            {{ row.name }} — {{ row.install }}
          </p>
        </div>

        <Button class="mt-3 self-start" size="sm" :disabled="loading" @click="load">{{
          loading ? 'checking…' : 're-check'
        }}</Button>
      </template>

      <template v-else-if="at === 1">
        <p v-if="forge.signedIn.value" class="flex items-center gap-2">
          <span class="font-mono text-xs text-ink">{{ forge.session.value?.login }}</span>
          <span class="font-sans text-[0.6875rem] text-faint">signed in to ccwt</span>
        </p>

        <p v-else class="max-w-prose font-sans text-xs leading-relaxed text-dim">
          Pull request state on every worktree card, and merge from one. The token is kept in
          <code class="font-mono">~/.ccwt</code> and never leaves this machine.
        </p>

        <p
          v-if="forge.signedIn.value && forge.session.value && !forge.session.value.canMerge"
          class="mt-2 max-w-prose font-sans text-[0.6875rem] text-caution"
        >
          This sign-in can read pull requests but not merge them.
        </p>

        <Notice v-if="!forge.configured.value" variation="warning" class="mt-3">
          This copy of ccwt has no GitHub client id, so it cannot offer a sign-in. Start it with
          <code class="font-mono">CCWT_GITHUB_CLIENT_ID</code> set.
        </Notice>

        <div v-if="forge.device.value" class="mt-3 border border-line-strong px-3 py-3">
          <p class="t-eyebrow">Enter this code on GitHub</p>
          <p class="mt-2 font-mono text-lg tracking-[0.2em] text-ink">
            {{ forge.device.value.userCode }}
          </p>
          <a
            :href="forge.device.value.verificationUri"
            target="_blank"
            rel="noreferrer"
            class="mt-2 inline-flex items-center gap-1 font-mono text-[0.6875rem] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          >
            {{ forge.device.value.verificationUri.replace(/^https?:\/\//, '') }}
            <ExternalLink :size="11" aria-hidden="true" />
          </a>
          <p class="mt-2 font-sans text-[0.6875rem] text-faint">
            Waiting for you to authorise it. This picks it up on its own.
          </p>
        </div>

        <p v-if="forge.error.value" class="mt-2 font-sans text-[0.6875rem] text-alarm">
          {{ forge.error.value }}
        </p>

        <div class="mt-3 flex items-center gap-2">
          <Button v-if="forge.device.value" size="sm" @click="forge.cancel">cancel</Button>
          <Button
            v-else
            size="sm"
            :variation="forge.signedIn.value ? 'neutral' : 'primary'"
            :outline="forge.signedIn.value"
            :disabled="forge.busy.value || !forge.configured.value"
            @click="forge.start"
            >{{
              forge.busy.value
                ? 'working…'
                : forge.signedIn.value
                  ? 'use a different account'
                  : 'connect GitHub'
            }}</Button
          >
        </div>
      </template>

      <template v-else>
        <p class="max-w-prose font-sans text-xs leading-relaxed text-dim">
          A Claude Code session working in a worktree has no idea ccwt already runs its dev server,
          so it starts a second one on the wrong port. This plugin tells it.
        </p>

        <dl
          v-if="plugin.report.value"
          class="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 font-mono text-[0.6875rem] leading-snug"
        >
          <dt class="text-faint">plugin</dt>
          <dd class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span class="text-ink">{{ plugin.report.value.parts.id }}</span>
            <span class="text-dim">{{
              plugin.report.value.shipped
            }}</span>
            <span v-if="plugin.report.value.scope" class="text-faint"
              >· {{ plugin.report.value.scope }}</span
            >
          </dd>

          <dt class="text-faint">marketplace</dt>
          <dd class="flex min-w-0 items-baseline gap-x-1.5">
            <span class="shrink-0 text-ink">{{ plugin.report.value.parts.marketplace }}</span>
            <span class="min-w-0 truncate text-faint">{{ plugin.report.value.source }}</span>
          </dd>

          <dt class="text-faint">hooks</dt>
          <dd class="min-w-0 text-ink">{{ plugin.events.value }}</dd>

          <template v-if="plugin.report.value.parts.tools.length">
            <dt class="text-faint">tools</dt>
            <dd class="min-w-0 text-ink">
              {{ plugin.report.value.parts.tools.join(' · ') }}
            </dd>
          </template>

          <template v-if="plugin.report.value.parts.skills.length">
            <dt class="text-faint">skills</dt>
            <dd class="min-w-0 text-ink">
              {{ plugin.report.value.parts.skills.map((skill) => skill.name).join(' · ') }}
            </dd>
          </template>
        </dl>

        <Notice
          v-for="issue in plugin.report.value?.issues ?? []"
          :key="issue.code"
          :variation="issue.severity"
          :hint="issue.hint"
          class="mt-3"
          >{{ issue.message }}</Notice
        >

        <div v-if="commands.length" class="mt-3 border border-line-strong px-3 py-2">
          <p class="t-eyebrow">ccwt will run these, and nothing else</p>
          <pre
            class="mt-1.5 overflow-x-auto font-mono text-[0.6875rem] leading-relaxed text-ink"
          >{{ commands.join('\n') }}</pre>
        </div>

        <p v-if="plugin.error.value" class="mt-2 font-sans text-[0.6875rem] text-alarm">
          {{ plugin.error.value }}
        </p>

        <div class="mt-3 flex items-center gap-2">
          <Button
            v-if="plugin.state.value === 'absent'"
            size="sm"
            variation="primary"
            :outline="false"
            :disabled="plugin.busy.value"
            @click="plugin.install"
            >{{ plugin.busy.value ? 'installing…' : 'install it' }}</Button
          >
          <Button
            v-else-if="plugin.state.value === 'disabled'"
            size="sm"
            :disabled="plugin.busy.value"
            @click="plugin.enable"
            >{{ plugin.busy.value ? 'working…' : 'switch it on' }}</Button
          >
        </div>
      </template>
    </section>

    <template #footer>
      <p class="mr-auto font-mono text-[0.625rem] text-faint tabular-nums">
        {{ at + 1 }} / {{ STEPS.length }}
      </p>
      <Button size="sm" :disabled="at === 0" @click="at -= 1">back</Button>
      <Button
        size="sm"
        variation="primary"
        :outline="false"
        @click="last ? emit('close') : (at += 1)"
        >{{ last ? 'done' : 'next' }}</Button
      >
    </template>
  </ModalPanel>
</template>
