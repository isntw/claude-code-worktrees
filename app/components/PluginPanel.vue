<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PluginReport, PluginState } from '#shared/types'
import type { BadgeVariation } from './variation'

const api = useApi()

const report = ref<PluginReport | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const showing = ref(false)

const state = computed<PluginState | null>(() => report.value?.state ?? null)
const installed = computed(() => state.value === 'installed' || state.value === 'outdated')

const LOOK: Record<PluginState, BadgeVariation> = {
  unavailable: 'neutral',
  absent: 'neutral',
  installed: 'live',
  disabled: 'warning',
  outdated: 'warning',
}

const SAYS: Record<PluginState, string> = {
  unavailable: 'claude code not found',
  absent: 'not installed',
  installed: 'installed',
  disabled: 'switched off',
  outdated: 'update available',
}

const load = async () => {
  report.value = await api.getPlugin().catch(() => null)
}

const act = async (run: () => Promise<PluginReport>) => {
  busy.value = true
  error.value = null
  try {
    report.value = await run()
    showing.value = false
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <Panel title="Claude Code">
    <template #label>
      <Badge v-if="state" :variation="LOOK[state]" size="sm">{{ SAYS[state] }}</Badge>
    </template>

    <div class="px-3 py-3">
      <p class="max-w-prose font-sans text-xs text-dim">
        A Claude Code session working in one of these worktrees has no idea ccwt is already running
        its dev server, so it starts a second one. This installs a plugin that tells it — machine
        wide, for every project, and nothing is written into any repository.
      </p>

      <dl class="mt-3 grid gap-2 border-t border-line pt-3">
        <div v-for="capability in report?.capabilities ?? []" :key="capability.name">
          <dt class="t-eyebrow">{{ capability.title }}</dt>
          <dd class="mt-0.5 max-w-prose font-sans text-[0.6875rem] text-faint">
            {{ capability.blurb }}
          </dd>
        </div>
      </dl>

      <p
        v-if="installed && report"
        class="mt-3 flex items-center gap-2 border-t border-line pt-3 font-mono text-[0.6875rem] text-dim"
      >
        <span class="text-ink">{{ report.installed }}</span>
        <span v-if="report.scope" class="text-faint">{{ report.scope }} scope</span>
        <span v-if="report.state === 'outdated'" class="text-caution"
          >ccwt ships {{ report.shipped }}</span
        >
      </p>

      <div
        v-for="issue in report?.issues ?? []"
        :key="issue.code"
        class="mt-3 border px-3 py-2"
        :class="issue.severity === 'error' ? 'border-alarm' : 'border-caution'"
      >
        <p
          class="max-w-prose font-sans text-[0.6875rem]"
          :class="issue.severity === 'error' ? 'text-alarm' : 'text-caution'"
        >
          {{ issue.message }}
        </p>
        <p v-if="issue.hint" class="mt-1 max-w-prose font-sans text-[0.6875rem] text-faint">
          {{ issue.hint }}
        </p>
      </div>

      <div v-if="showing && report" class="mt-3 border border-line-strong px-3 py-3">
        <p class="t-eyebrow">ccwt will run these, and nothing else</p>
        <pre
          class="mt-2 overflow-x-auto font-mono text-[0.6875rem] leading-relaxed text-ink"
        >{{ report.commands.join('\n') }}</pre>
        <p class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
          The plugin is copied into <code class="font-mono">{{ report.source }}</code> first. A
          command that would start a second copy of a running service will be refused, and sessions
          working in a worktree get renamed after it. It takes effect in your
          <span class="text-dim">next</span> session, not the one you have open.
        </p>
      </div>

      <p v-if="error" class="mt-2 max-w-prose font-sans text-[0.6875rem] text-alarm">{{ error }}</p>

      <div class="mt-3 flex items-center gap-2">
        <template v-if="state === 'absent' || state === 'outdated'">
          <Button v-if="!showing" size="sm" :disabled="busy" @click="showing = true">{{
            state === 'outdated' ? 'update…' : 'install…'
          }}</Button>
          <template v-else>
            <Button size="sm" variation="success" :disabled="busy" @click="act(api.installPlugin)">{{
              busy ? 'working…' : 'run them'
            }}</Button>
            <Button size="sm" :disabled="busy" @click="showing = false">cancel</Button>
          </template>
        </template>

        <Button
          v-if="state === 'disabled'"
          size="sm"
          :disabled="busy"
          @click="act(api.enablePlugin)"
          >{{ busy ? 'working…' : 'switch it on' }}</Button
        >

        <Button
          v-if="installed || state === 'disabled'"
          size="sm"
          :disabled="busy"
          title="Uninstall the plugin from Claude Code. Sessions stop being told what ccwt runs."
          @click="act(api.removePlugin)"
          >remove</Button
        >
      </div>
    </div>
  </Panel>
</template>
