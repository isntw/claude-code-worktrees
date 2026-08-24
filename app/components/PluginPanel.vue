<script setup lang="ts">
import { computed, ref } from 'vue'

const {
  report,
  busy,
  error,
  state,
  installed,
  stale,
  look,
  says,
  events,
  install,
  enable,
  disable,
  update,
  remove,
} = usePluginSetup()

const asking = ref<'install' | 'about' | null>(null)

const present = computed(() => installed.value || state.value === 'disabled')

const stamped = (value: string) => {
  const at = value.indexOf('-')
  return at === -1 ? { version: '', hash: value } : { version: value.slice(0, at), hash: value.slice(at + 1) }
}

const version = computed(() => {
  const said = report.value
  if (!said) return ''
  if (!stale.value) return said.installed ?? said.available ?? said.shipped

  const was = stamped(said.installed ?? '')
  const now = stamped(said.available ?? '')

  if (was.version && was.version === now.version) {
    return `${was.version} · ${was.hash} → ${now.hash}`
  }

  return `${said.installed} → ${said.available}`
})

const confirm = async () => {
  if (await install()) asking.value = null
}
</script>

<template>
  <Panel title="Claude Code">
    <template #label>
      <Badge v-if="state" :variation="look" size="md">{{ says }}</Badge>
    </template>

    <template v-if="present" #actions>
      <Toggle
        :model-value="state !== 'disabled'"
        :disabled="busy"
        :title="
          state === 'disabled'
            ? 'Switch the plugin back on in Claude Code.'
            : 'Switch the plugin off in Claude Code. It stays installed, and sessions stop being told what ccwt runs.'
        "
        @update:model-value="(on: boolean) => (on ? enable() : disable())"
        >{{ state === 'disabled' ? 'off' : 'on' }}</Toggle
      >
    </template>

    <div class="px-3 py-3">
      <p class="max-w-prose font-sans text-xs text-dim">
        A session working in one of these worktrees does not know ccwt already runs its dev server,
        so it starts a second one. This plugin tells it — machine wide, for every project, and
        nothing is written into any repository.
      </p>

      <div v-if="report" class="mt-3 border border-line px-3 py-2">
        <p class="t-eyebrow">
          {{ report.parts.origin === 'installed' ? 'Installed' : 'What gets installed' }}
        </p>

        <dl
          class="mt-1.5 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 font-mono text-[0.6875rem] leading-snug"
        >
          <dt class="text-faint">plugin</dt>
          <dd class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span class="text-ink">{{ report.parts.id }}</span>
            <span class="text-dim">{{ version }}</span>
            <span v-if="report.scope" class="text-faint">· {{ report.scope }}</span>
          </dd>

          <dt class="text-faint">hooks</dt>
          <dd class="min-w-0 text-ink">{{ events }}</dd>

          <dt v-if="report.parts.tools.length" class="text-faint">tools</dt>
          <dd v-if="report.parts.tools.length" class="min-w-0">
            <ul
              class="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-x-4 gap-y-0.5 text-ink"
            >
              <li v-for="tool in report.parts.tools" :key="tool" class="truncate">{{ tool }}</li>
            </ul>
          </dd>

          <dt v-if="report.parts.skills.length" class="text-faint">skills</dt>
          <dd v-if="report.parts.skills.length" class="min-w-0">
            <ul
              class="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-x-4 gap-y-0.5 text-ink"
            >
              <li v-for="skill in report.parts.skills" :key="skill.name" class="truncate">
                {{ skill.name }}
              </li>
            </ul>
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
        <Button
          v-if="stale"
          size="sm"
          :disabled="busy"
          tooltip="Hand Claude Code the copy of the plugin this ccwt carries, replacing the one it installed."
          @click="update"
          >{{ busy ? 'working…' : 'update' }}</Button
        >

        <Button v-if="report" size="sm" :disabled="busy" @click="asking = 'about'"
          >what it does</Button
        >

        <Button
          v-if="installed || state === 'disabled'"
          size="sm"
          :disabled="busy"
          tooltip="Uninstall the plugin from Claude Code. Sessions stop being told what ccwt runs."
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
