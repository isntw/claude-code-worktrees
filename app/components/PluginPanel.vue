<script setup lang="ts">
import { ref } from 'vue'

const { report, busy, error, state, installed, look, says, events, install, enable, remove } =
  usePluginSetup()

const asking = ref<'install' | 'update' | 'about' | null>(null)

const confirm = async () => {
  if (await install()) asking.value = null
}
</script>

<template>
  <Panel title="Claude Code">
    <template #label>
      <Badge v-if="state" :variation="look" size="sm">{{ says }}</Badge>
    </template>

    <div class="px-3 py-3">
      <p class="max-w-prose font-sans text-xs text-dim">
        A session working in one of these worktrees does not know ccwt already runs its dev server,
        so it starts a second one. This plugin tells it — machine wide, for every project, and
        nothing is written into any repository.
      </p>

      <div v-if="report" class="mt-3 border border-line px-3 py-2">
        <p class="t-eyebrow">{{ installed ? 'Installed' : 'What gets installed' }}</p>

        <dl
          class="mt-1.5 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 font-mono text-[0.6875rem] leading-snug"
        >
          <dt class="text-faint">plugin</dt>
          <dd class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span class="text-ink">{{ report.parts.id }}</span>
            <span class="text-dim">{{ installed ? report.installed : report.shipped }}</span>
            <span v-if="report.scope" class="text-faint">· {{ report.scope }}</span>
            <span v-if="report.state === 'outdated'" class="text-caution"
              >· ccwt ships {{ report.shipped }}</span
            >
          </dd>

          <dt class="text-faint">from</dt>
          <dd class="min-w-0 truncate text-dim">{{ report.source }}</dd>

          <dt class="text-faint">hooks</dt>
          <dd class="min-w-0 text-ink">{{ events }}</dd>

          <dt v-if="report.parts.tools.length" class="text-faint">tools</dt>
          <dd v-if="report.parts.tools.length" class="min-w-0 text-ink">
            {{ report.parts.tools.join(' · ') }}
            <span class="font-sans text-faint">read only</span>
          </dd>
        </dl>
      </div>

      <Notice
        v-for="issue in report?.issues ?? []"
        :key="issue.code"
        :variation="issue.severity"
        :hint="issue.hint"
        class="mt-3"
        >{{ issue.message }}</Notice
      >

      <p v-if="error" class="mt-2 max-w-prose font-sans text-[0.6875rem] text-alarm">{{ error }}</p>

      <div class="mt-3 flex items-center gap-2">
        <Button v-if="state === 'absent'" size="sm" :disabled="busy" @click="asking = 'install'"
          >install…</Button
        >
        <Button v-if="state === 'outdated'" size="sm" :disabled="busy" @click="asking = 'update'"
          >update…</Button
        >
        <Button v-if="state === 'disabled'" size="sm" :disabled="busy" @click="enable">{{
          busy ? 'working…' : 'switch it on'
        }}</Button>

        <Button v-if="report" size="sm" :disabled="busy" @click="asking = 'about'"
          >what it does</Button
        >

        <Button
          v-if="installed || state === 'disabled'"
          size="sm"
          :disabled="busy"
          title="Uninstall the plugin from Claude Code. Sessions stop being told what ccwt runs."
          @click="remove"
          >remove</Button
        >
      </div>
    </div>
  </Panel>

  <PluginModal
    v-if="asking && report"
    :report="report"
    :action="asking === 'about' ? null : asking"
    @close="asking = null"
    @confirm="confirm"
  />
</template>
