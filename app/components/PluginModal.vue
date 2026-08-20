<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { PluginReport } from '#shared/types'

const props = withDefaults(
  defineProps<{ report: PluginReport; action?: 'install' | 'update' | null }>(),
  { action: null },
)

const emit = defineEmits<{ close: []; confirm: [] }>()

const open = ref(false)

const updating = computed(() => props.action === 'update')
const folded = computed(() => props.action !== null)
const shown = computed(() => !folded.value || open.value)
</script>

<template>
  <ModalPanel :title="updating ? 'Update the plugin' : 'Claude Code plugin'" @close="emit('close')">
    <p v-if="updating" class="max-w-prose font-sans text-xs text-dim">
      You have <span class="font-mono text-dim">{{ report.installed }}</span
      >; ccwt ships <span class="font-mono text-ink">{{ report.shipped }}</span
      >. Same plugin, replaced in place — nothing is written into any repository.
    </p>
    <p v-else class="max-w-prose font-sans text-xs text-dim">
      A Claude Code session working in one of these worktrees has no idea ccwt is already running its
      dev server, so it starts a second one — on the wrong port, outliving the session, holding a
      port ccwt will not hand out again. This plugin tells it.
    </p>

    <section v-if="!updating" class="mt-4">
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
      <span class="t-eyebrow">{{ updating ? 'What it does' : 'What it registers' }}</span>
      <span v-if="open" class="ml-auto shrink-0 font-mono text-[0.625rem] text-faint">hide</span>
    </button>

    <section v-if="updating && open" class="mt-3">
      <dl class="grid gap-2">
        <div v-for="capability in report.capabilities" :key="capability.name">
          <dt class="font-sans text-[0.6875rem] text-ink">{{ capability.title }}</dt>
          <dd class="mt-0.5 max-w-prose font-sans text-[0.6875rem] text-faint">
            {{ capability.blurb }}
          </dd>
        </div>
      </dl>
    </section>

    <section v-if="shown" class="mt-4">
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

    <section v-if="shown && report.parts.servers.length" class="mt-4">
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
        <dt class="font-mono text-[0.6875rem] text-ink">ccwt_project_add</dt>
        <dd class="font-sans text-[0.6875rem] text-faint">
          registers the repository the session is in, so it can hold a recipe
        </dd>
        <dt class="font-mono text-[0.6875rem] text-ink">ccwt_recipe_read</dt>
        <dd class="font-sans text-[0.6875rem] text-faint">
          the recipe you have, where it came from, and whether it has gone stale
        </dd>
        <dt class="font-mono text-[0.6875rem] text-ink">ccwt_recipe_check</dt>
        <dd class="font-sans text-[0.6875rem] text-faint">
          validates a recipe and stores nothing, so a session can get it right before saving
        </dd>
        <dt class="font-mono text-[0.6875rem] text-ink">ccwt_recipe_write</dt>
        <dd class="font-sans text-[0.6875rem] text-faint">
          saves the recipe into ccwt, never into your repository
        </dd>
        <dt class="font-mono text-[0.6875rem] text-ink">ccwt_worktree_start</dt>
        <dd class="font-sans text-[0.6875rem] text-faint">
          asks ccwt to start a worktree's services, rather than the session starting its own
        </dd>
      </dl>
      <p class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
        A session can ask ccwt to start a worktree, and can write the recipe that says what starting
        one means. ccwt still allocates every port and owns every process, and nothing a session
        calls will stop or restart a service — that stays yours, from this dashboard.
      </p>
    </section>

    <section v-if="shown && report.parts.skills.length" class="mt-4">
      <p class="t-eyebrow">Skills it adds</p>
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
      >{{ report.commands.join('\n') }}</pre>
      <p v-if="updating" class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
        The new copy replaces <code class="font-mono">{{ report.source }}</code> first. A session you
        already have open needs
        <code class="font-mono text-dim">/reload-plugins --force</code>; a new one picks it up on its
        own.
      </p>
      <p v-else class="mt-2 max-w-prose font-sans text-[0.6875rem] text-faint">
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
