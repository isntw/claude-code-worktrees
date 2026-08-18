<script setup lang="ts">
import type { PluginReport } from '#shared/types'

withDefaults(defineProps<{ report: PluginReport; action?: 'install' | 'update' | null }>(), {
  action: null,
})

const emit = defineEmits<{ close: []; confirm: [] }>()
</script>

<template>
  <ModalPanel title="Claude Code plugin" @close="emit('close')">
    <p class="max-w-prose font-sans text-xs text-dim">
      A Claude Code session working in one of these worktrees has no idea ccwt is already running its
      dev server, so it starts a second one — on the wrong port, outliving the session, holding a
      port ccwt will not hand out again. This plugin tells it.
    </p>

    <section class="mt-4">
      <p class="t-eyebrow">What it does</p>
      <dl class="mt-2 grid gap-2">
        <div v-for="capability in report.capabilities" :key="capability.name">
          <dt class="font-sans text-[0.6875rem] text-ink">{{ capability.title }}</dt>
          <dd class="mt-0.5 max-w-prose font-sans text-[0.6875rem] text-faint">
            {{ capability.blurb }}
          </dd>
        </div>
      </dl>
    </section>

    <section class="mt-4">
      <p class="t-eyebrow">Every hook it registers</p>
      <dl class="mt-2 grid grid-cols-[10.5rem_1fr] gap-x-3 gap-y-1">
        <template v-for="hook in report.parts.hooks" :key="`${hook.event}${hook.matcher}`">
          <dt class="font-mono text-[0.6875rem] text-ink">
            {{ hook.event }}<span v-if="hook.matcher" class="text-faint">:{{ hook.matcher }}</span>
          </dt>
          <dd class="font-sans text-[0.6875rem] text-faint">{{ hook.blurb }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="report.parts.servers.length" class="mt-4">
      <p class="t-eyebrow">Tools it adds</p>
      <dl class="mt-2 grid grid-cols-[10.5rem_1fr] gap-x-3 gap-y-1">
        <dt class="font-mono text-[0.6875rem] text-ink">ccwt_status</dt>
        <dd class="font-sans text-[0.6875rem] text-faint">
          what runs for this repository, and on which ports
        </dd>
        <dt class="font-mono text-[0.6875rem] text-ink">ccwt_logs</dt>
        <dd class="font-sans text-[0.6875rem] text-faint">
          what a running service has printed, so a change can be checked without building
        </dd>
      </dl>
      <p class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
        Both are read-only. Nothing the session can call will start, stop or restart a service —
        that stays yours, from this dashboard.
      </p>
    </section>

    <section v-if="action" class="mt-4 border border-line-strong px-3 py-3">
      <p class="t-eyebrow">ccwt will run these, and nothing else</p>
      <pre
        class="mt-2 overflow-x-auto font-mono text-[0.6875rem] leading-relaxed text-ink"
      >{{ report.commands.join('\n') }}</pre>
      <p class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
        The plugin is copied into <code class="font-mono">{{ report.source }}</code> first — ccwt has
        written nothing there until you press this. Claude Code says at the end of the install
        whether it switched the plugin on; if it did not, run
        <code class="font-mono text-dim">/reload-plugins --force</code> in a session you already have
        open. The <code class="font-mono">--force</code> is needed because this adds tools, which
        drops the prompt cache. A new session picks it up either way.
      </p>
    </section>

    <template #footer>
      <Button size="sm" @click="emit('close')">{{ action ? 'cancel' : 'close' }}</Button>
      <Button
        v-if="action"
        size="sm"
        variation="primary"
        :outline="false"
        @click="emit('confirm')"
        >{{ action === 'update' ? 'update it' : 'install it' }}</Button
      >
    </template>
  </ModalPanel>
</template>
