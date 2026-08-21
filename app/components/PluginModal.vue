<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { PluginReport } from '#shared/types'

const props = withDefaults(defineProps<{ report: PluginReport; action?: 'install' | null }>(), {
  action: null,
})

const emit = defineEmits<{ close: []; confirm: [] }>()

const TOOLS: Record<string, string> = {
  ccwt_get_status: 'what runs for this repository, and on which ports',
  ccwt_get_logs: 'what a running service has printed, so a change can be checked without building',
  ccwt_add_project: 'registers the repository the session is in, so it can hold a recipe',
  ccwt_read_recipe: 'the recipe you have, and where it came from',
  ccwt_check_recipe: 'validates a recipe and stores nothing, so a session can get it right before saving',
  ccwt_write_recipe: 'saves the recipe into ccwt, never into your repository',
  ccwt_create_worktree: 'makes a worktree and provisions it from the recipe, ready and stopped',
  ccwt_provision_worktree: 'puts back what the recipe names and a worktree is missing, files only',
  ccwt_start_worktree:
    "asks ccwt to start a worktree's services, rather than the session starting its own",
  ccwt_stop_worktree: 'stops them and frees the port, so a changed recipe can be tried',
}

const open = ref(false)

const folded = computed(() => props.action !== null)
const shown = computed(() => !folded.value || open.value)

const shipped = computed(() => props.report.parts.origin === 'shipped')
const reviewing = computed(
  () => !props.report.approval.granted && !props.report.approval.askable,
)
const runs = computed(() =>
  reviewing.value
    ? props.report.commands.filter((line) => !line.includes('plugin install'))
    : props.report.commands,
)
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

    <button
      v-if="folded"
      type="button"
      class="mt-4 flex w-full cursor-pointer items-center gap-2 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <component
        :is="open ? ChevronDown : ChevronRight"
        :size="12"
        class="shrink-0 text-faint"
        aria-hidden="true"
      />
      <span class="t-eyebrow">What it registers</span>
      <span v-if="open" class="ml-auto shrink-0 font-mono text-[0.625rem] text-faint">hide</span>
    </button>

    <p v-if="shown" class="mt-4 max-w-prose font-sans text-[0.6875rem] text-faint">
      {{
        shipped
          ? 'Read from the copy this ccwt ships, not from Claude Code — so this is what an install would register, not what any session has:'
          : 'Read from the copy Claude Code installed, so this is what your sessions actually have:'
      }}
      <code class="font-mono text-dim">{{ report.parts.from }}</code>
    </p>

    <section v-if="shown" class="mt-4">
      <p class="t-eyebrow">
        {{ shipped ? 'Every hook it would register' : 'Every hook it registers' }}
      </p>
      <dl class="mt-2 grid grid-cols-[10.5rem_1fr] gap-x-3 gap-y-1">
        <template v-for="hook in report.parts.hooks" :key="`${hook.event}${hook.matcher}`">
          <dt class="font-mono text-[0.6875rem] text-ink">
            {{ hook.event }}<span v-if="hook.matcher" class="text-faint">:{{ hook.matcher }}</span>
          </dt>
          <dd class="font-sans text-[0.6875rem] text-faint">{{ hook.blurb }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="shown && report.parts.tools.length" class="mt-4">
      <p class="t-eyebrow">{{ shipped ? 'Tools it would add' : 'Tools it adds' }}</p>
      <dl class="mt-2 grid grid-cols-[10.5rem_1fr] gap-x-3 gap-y-1">
        <template v-for="name in report.parts.tools" :key="name">
          <dt class="font-mono text-[0.6875rem] text-ink">{{ name }}</dt>
          <dd class="font-sans text-[0.6875rem] text-faint">{{ TOOLS[name] ?? '' }}</dd>
        </template>
      </dl>
      <p class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
        A session can write the recipe, make a worktree from it, start it, read what it printed and
        stop it again. ccwt still allocates every port and owns every process. Removing a worktree is
        the one thing no tool does — that stays yours, from this dashboard.
      </p>
    </section>

    <section v-if="shown && report.parts.skills.length" class="mt-4">
      <p class="t-eyebrow">{{ shipped ? 'Skills it would add' : 'Skills it adds' }}</p>
      <dl class="mt-2 grid grid-cols-[10.5rem_1fr] gap-x-3 gap-y-1">
        <template v-for="skill in report.parts.skills" :key="skill.name">
          <dt class="font-mono text-[0.6875rem] text-ink">{{ skill.name }}</dt>
          <dd class="font-sans text-[0.6875rem] text-faint">{{ skill.blurb }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="action" class="mt-4 border border-line-strong px-3 py-3">
      <p class="t-eyebrow">ccwt will run these, and nothing else</p>
      <pre
        class="mt-2 overflow-x-auto font-mono text-[0.6875rem] leading-relaxed text-ink"
      >{{ runs.join('\n') }}</pre>
      <p class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
        ccwt writes a marketplace into <code class="font-mono">{{ report.source }}</code> naming a
        command that prints where this plugin lives — nothing is written there until you press this.
        Claude Code copies the plugin into its own cache, then re-runs that command once a session
        and reloads when the files have changed, so it stays current without ccwt being asked. If it
        does not switch the plugin on now, run
        <code class="font-mono text-dim">/reload-plugins --force</code> in a session you already have
        open.
      </p>
      <template v-if="reviewing">
        <p class="mt-2 max-w-prose font-sans text-[0.6875rem] text-dim">
          The install itself is not ccwt's to run. Claude Code will not run a command it has not been
          shown, and <code class="font-mono">-y</code> is ignored inside a Claude Code session — which
          is where this ccwt is running. Registering the marketplace is all ccwt can do; accept the
          command once from <code class="font-mono">/plugin</code>, or run this in your own terminal:
        </p>
        <pre
          class="mt-2 overflow-x-auto font-mono text-[0.6875rem] leading-relaxed text-ink"
        >claude plugin install {{ report.parts.id }} --scope user -y</pre>
      </template>
    </section>

    <template #footer>
      <Button size="sm" @click="emit('close')">{{ action ? 'cancel' : 'close' }}</Button>
      <Button
        v-if="action"
        size="sm"
        variation="primary"
        :outline="false"
        @click="emit('confirm')"
        >{{ reviewing ? 'register the marketplace' : 'install it' }}</Button
      >
    </template>
  </ModalPanel>
</template>
