<script setup lang="ts">
import { ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import type {
  LockState,
  LogLine,
  OverviewRow,
  PortClaim,
  PortRow,
  ServiceState,
  Worktree,
} from '#shared/types'
import type { Stat } from '../components/StatBar.vue'
import type { Variation } from '../components/variation'
import { NAV } from '../nav'

const page = NAV.find((item) => item.name === 'preview')!

const VARIATIONS: Variation[] = ['neutral', 'info', 'success', 'live', 'warning', 'error']

const text = ref('npm run dev -- --port 5200')
const blank = ref('')
const area = ref('{\n  "services": []\n}')
const list = ref(['.env', '.env.local'])
const checked = ref(true)
const mixed = ref(false)
const switched = ref(true)
const tab = ref<'a' | 'b' | 'c'>('a')
const modal = ref(false)

const LOCKS: (LockState | undefined)[] = [undefined, 'unknown', 'live', 'gone']
const SERVICES: ServiceState[] = ['stopped', 'starting', 'running', 'crashed']

const sample = (index: number, service: ServiceState): Worktree => ({
  id: `w${index}`,
  projectId: 'p',
  name: ['checkout-rewrite', 'flaky-tests', 'worktree-a11y', 'bump-nuxt'][index] ?? 'sample',
  path: `/Users/you/workspace/projects/app/../.worktrees/sample-${index}`,
  root: false,
  branch: ['feature/checkout', 'fix/flaky', 'worktree-a11y', null][index] ?? null,
  head: '9f2c1ab4e7d3',
  origin: (['ccwt', 'manual', 'claude', 'claude'] as const)[index] ?? 'manual',
  detached: index === 3,
  bare: false,
  locked: LOCKS[index] !== undefined,
  lockReason:
    LOCKS[index] === 'unknown'
      ? 'locked from ccwt'
      : LOCKS[index]
        ? `claude agent sample-${index} (pid ${4820 + index})`
        : null,
  lockState: LOCKS[index] ?? null,
  prunable: false,
  provisioned: true,
  services: [
    {
      name: 'web',
      state: service,
      port: service === 'stopped' ? (index === 0 ? 3000 : null) : 5200 + index,
      url: service === 'running' ? `http://127.0.0.1:${5200 + index}` : null,
      pid: service === 'running' ? 40000 + index : null,
      startedAt: null,
      exitCode: service === 'crashed' ? 1 : null,
      reachable: service === 'running' ? true : null,
      taken: service === 'stopped' && index === 0,
    },
  ],
  issues: index === 3 ? [{ code: 'worktree.drift', severity: 'error', message: 'env drift' }] : [],
})

const CARDS = SERVICES.map((service, index) => sample(index, service))

const PROJECTS = ['app', 'app', 'kape-kb', 'legacy']

const ROWS: OverviewRow[] = CARDS.map((worktree, index) => ({
  projectId: 'p',
  projectName: PROJECTS[index] ?? 'app',
  worktree,
}))

const STATS: Stat[] = [
  { key: 'projects', label: 'Projects', value: 4 },
  { key: 'worktrees', label: 'Worktrees', value: 12, note: '5 with something up' },
  {
    key: 'running',
    label: 'Services up',
    value: 5,
    variation: 'live',
    note: '1 still starting · of 9',
  },
  { key: 'crashed', label: 'Crashed', value: 1, variation: 'error' },
  { key: 'ports', label: 'Ports allocated', value: 9 },
  { key: 'problems', label: 'Problems', value: 0, variation: 'neutral' },
]

const claim = (
  service: string,
  state: ServiceState,
  project: string,
  worktree: string,
): PortClaim => ({
  projectId: 'p',
  projectName: project,
  worktreeId: `${project}-${worktree}-${service}`,
  worktreeName: worktree,
  service,
  state,
  url: state === 'running' ? 'http://localhost:5200' : null,
})

const PORTS: PortRow[] = [
  {
    port: 3000,
    claims: [
      claim('api', 'stopped', 'app', 'checkout-rewrite'),
      claim('api', 'stopped', 'app', 'flaky-tests'),
    ],
  },
  { port: 5200, claims: [claim('web', 'running', 'app', 'checkout-rewrite')] },
  { port: 5201, claims: [claim('web', 'starting', 'app', 'flaky-tests')] },
  { port: 5203, claims: [claim('web', 'crashed', 'legacy', 'bump-nuxt')] },
  { port: 8080, claims: [claim('api', 'running', 'app', 'checkout-rewrite')] },
]

const said = (service: string, stream: 'stdout' | 'stderr', text: string): LogLine => ({
  worktreeId: 'w',
  service,
  stream,
  at: '',
  text,
})

const LOGS: LogLine[] = [
  said('web', 'stdout', '> app@0.1.0 dev'),
  said('web', 'stdout', '\u001b[1m\u001b[38;2;173;127;168m▲ Next.js 16.2.10\u001b[39m\u001b[22m'),
  said('web', 'stdout', '\u001b[2m- Local:\u001b[22m        \u001b[36mhttp://localhost:5200\u001b[39m'),
  said('web', 'stdout', '\u001b[32m✓\u001b[39m Ready in 273ms'),
  said('api', 'stderr', '[@sentry/nextjs] DEPRECATION WARNING: disableLogger is deprecated'),
  said('api', 'stderr', '(node:44354) [DEP0205] DeprecationWarning: `module.register()` is deprecated'),
  said('api', 'stderr', '\u001b[33m⚠ the "middleware" file convention is deprecated\u001b[39m'),
  said('web', 'stderr', '\u001b[41m\u001b[97m FAIL \u001b[39m\u001b[49m src/checkout.test.ts'),
  said('web', 'stderr', '\u001b[31mError: EADDRINUSE: address already in use :::5200\u001b[39m'),
  said('web', 'stderr', "ENOENT: no such file or directory, open '.env.local'"),
]

const SECTION = 'border border-line bg-surface'
const HEAD = 'border-b border-line px-3 py-2'
const BODY = 'flex flex-wrap items-center gap-3 px-3 py-3'
</script>

<template>
  <ConsoleHeader :title="page.title" :blurb="page.blurb">
    <Button @click="modal = true">open a dialog</Button>
  </ConsoleHeader>

  <main class="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 xl:grid-cols-2">
    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Type</p></header>
      <div class="flex flex-col gap-2 px-3 py-3">
        <p class="t-eyebrow">eyebrow — what this is</p>
        <p class="t-numeral">1,284</p>
        <p class="t-data text-dim">t-data · 127.0.0.1:5200 · 22ms</p>
        <p class="font-sans text-xs text-dim">
          Sans is what we think about it. Mono is what the machine said.
        </p>
      </div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Palette</p></header>
      <div class="grid grid-cols-4 gap-2 px-3 py-3 sm:grid-cols-6">
        <div
          v-for="name in [
            'canvas',
            'surface',
            'raised',
            'line',
            'line-strong',
            'dim',
            'faint',
            'ink',
            'live',
            'caution',
            'alarm',
          ]"
          :key="name"
          class="flex flex-col gap-1"
        >
          <span class="h-8 border border-line" :style="{ background: `var(--ccwt-${name})` }" />
          <span class="truncate font-mono text-[0.5625rem] text-faint">{{ name }}</span>
        </div>
      </div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Badge</p></header>
      <div :class="BODY">
        <Badge v-for="v in VARIATIONS" :key="v" :variation="v">{{ v }}</Badge>
        <Badge variation="selected">selected</Badge>
        <Badge mono>mono</Badge>
      </div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Button</p></header>
      <div :class="BODY">
        <Button v-for="v in VARIATIONS" :key="v" :variation="v">{{ v }}</Button>
      </div>
      <div :class="BODY">
        <Button v-for="v in VARIATIONS" :key="v" :variation="v" :outline="false">{{ v }}</Button>
      </div>
      <div :class="BODY">
        <Button size="sm">small</Button>
        <Button size="md">medium</Button>
        <Button disabled>disabled</Button>
        <Button size="sm"><template #lead><Plus :size="11" /></template>lead sm</Button>
        <Button size="md"><template #lead><Plus :size="12" /></template>lead md</Button>
        <Button icon><Plus :size="12" /></Button>
      </div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Text inputs</p></header>
      <div class="flex flex-col gap-3 px-3 py-3">
        <Input v-model="text" label="Filled" />
        <Input v-model="blank" placeholder="placeholder text" label="Empty" />
        <Input v-model="text" invalid label="Invalid" />
        <Input v-model="text" disabled label="Disabled" />
        <Textarea v-model="area" :rows="4" label="Textarea" />
      </div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">List editor</p></header>
      <div class="px-3 py-3">
        <ListEditor v-model="list" placeholder=".env.local" add-label="file" />
      </div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Controls</p></header>
      <div :class="BODY">
        <Checkbox v-model="checked">checked</Checkbox>
        <Checkbox v-model="mixed" indeterminate>indeterminate</Checkbox>
        <Checkbox disabled>disabled</Checkbox>
        <Toggle v-model="switched">toggle</Toggle>
        <Tabs
          v-model="tab"
          :options="[
            { value: 'a', label: 'all', count: 12 },
            { value: 'b', label: 'running', count: 3 },
            { value: 'c', label: 'attention' },
          ]"
        />
      </div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Tiles</p></header>
      <div class="px-3 py-3">
        <TileGrid
          dense
          :tiles="[
            { key: '1', label: 'app', total: 7, errors: 0, note: 'pnpm', go: () => {} },
            { key: '2', label: 'api', total: 3, errors: 2, note: 'npm', go: () => {} },
            { key: '3', label: 'legacy', total: 0, errors: 0, note: 'archived', inert: true, go: () => {} },
          ]"
        />
      </div>
    </section>

    <section :class="SECTION" class="xl:col-span-2">
      <header :class="HEAD"><p class="t-eyebrow">Stat bar</p></header>
      <div class="px-3 py-3"><StatBar :stats="STATS" /></div>
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Ports</p></header>
      <PortList :rows="PORTS" />
    </section>

    <section :class="SECTION">
      <header :class="HEAD"><p class="t-eyebrow">Ports — none</p></header>
      <PortList :rows="[]" />
    </section>

    <section :class="SECTION" class="min-w-0 xl:col-span-2">
      <header :class="HEAD"><p class="t-eyebrow">Worktree table</p></header>
      <WorktreeTable :rows="ROWS" />
    </section>

    <section class="xl:col-span-2">
      <p class="t-eyebrow mb-2">Worktree cards</p>
      <div class="grid gap-2 lg:grid-cols-2 2xl:grid-cols-4">
        <WorktreeCard v-for="card in CARDS" :key="card.id" :worktree="card" />
      </div>
    </section>

    <section class="xl:col-span-2">
      <p class="t-eyebrow mb-2">Log viewer</p>
      <LogViewer height="10rem" :lines="LOGS" />
    </section>
  </main>

  <ModalPanel v-if="modal" title="Dialog" @close="modal = false">
    <p class="font-sans text-xs text-dim">
      Escape closes it, focus returns to whatever opened it, and the panel is square like everything
      else.
    </p>
    <template #footer>
      <Button size="sm" @click="modal = false">cancel</Button>
      <Button size="sm" variation="error" :outline="false" @click="modal = false">remove</Button>
    </template>
  </ModalPanel>
</template>
