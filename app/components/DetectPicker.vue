<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CcwtConfig, ServiceConfig } from '#shared/types'

const props = defineProps<{ current: CcwtConfig; suggested: CcwtConfig }>()
const emit = defineEmits<{ apply: [CcwtConfig]; close: [] }>()

type Section = 'copy' | 'link' | 'postCreate' | 'services'

interface Row {
  key: string
  section: Section
  value: string
  detail: string | null
  held: boolean
}

const TITLE: Record<Section, string> = {
  copy: 'Copied from the root checkout',
  link: 'Hardlinked from the root checkout',
  postCreate: 'Run after creating',
  services: 'Services',
}

const same = (a: ServiceConfig, b: ServiceConfig) => JSON.stringify(a) === JSON.stringify(b)

const rows = computed<Row[]>(() => {
  const out: Row[] = []

  for (const section of ['copy', 'link', 'postCreate'] as const) {
    for (const value of props.suggested.provision[section]) {
      out.push({
        key: `${section}:${value}`,
        section,
        value,
        detail: null,
        held: props.current.provision[section].includes(value),
      })
    }
  }

  for (const service of props.suggested.services) {
    const mine = props.current.services.find((candidate) => candidate.name === service.name)
    out.push({
      key: `services:${service.name}`,
      section: 'services',
      value: service.name,
      detail: mine ? `replaces your service named ${service.name}` : service.command,
      held: Boolean(mine && same(mine, service)),
    })
  }

  return out
})

const offered = computed(() => rows.value.filter((row) => !row.held))

const replacing = (row: Row) => Boolean(row.detail?.startsWith('replaces'))

const picked = ref(new Set(offered.value.filter((row) => !replacing(row)).map((row) => row.key)))

const toggle = (key: string, on: boolean) => {
  const next = new Set(picked.value)
  if (on) next.add(key)
  else next.delete(key)
  picked.value = next
}

const sections = computed(() => {
  const order: Section[] = ['copy', 'link', 'postCreate', 'services']
  return order
    .map((section) => ({ section, rows: rows.value.filter((row) => row.section === section) }))
    .filter((group) => group.rows.length)
})

const chosen = (section: Section) =>
  rows.value.filter((row) => row.section === section && picked.value.has(row.key)).length

const openable = (section: Section) =>
  rows.value.filter((row) => row.section === section && !row.held).length

const merged = computed<CcwtConfig>(() => {
  const next = JSON.parse(JSON.stringify(props.current)) as CcwtConfig

  for (const section of ['copy', 'link', 'postCreate'] as const) {
    const additions = props.suggested.provision[section].filter(
      (value) => picked.value.has(`${section}:${value}`) && !next.provision[section].includes(value),
    )
    next.provision[section] = [...next.provision[section], ...additions]
  }

  for (const service of props.suggested.services) {
    if (!picked.value.has(`services:${service.name}`)) continue
    const at = next.services.findIndex((candidate) => candidate.name === service.name)
    if (at === -1) next.services = [...next.services, service]
    else next.services[at] = service
  }

  return next
})
</script>

<template>
  <ModalPanel title="Bring from detection" @close="emit('close')">
    <p class="mb-3 max-w-prose font-sans text-xs text-dim">
      What ccwt found by reading the repository. Anything you tick is added to the recipe you have
      open — nothing you wrote is removed.
    </p>

    <p v-if="!offered.length" class="font-sans text-xs text-faint">
      Your recipe already has everything detection found.
    </p>

    <div v-else class="flex flex-col gap-3">
      <div v-for="group in sections" :key="group.section" class="flex flex-col gap-1">
        <div class="flex items-baseline gap-2">
          <span class="t-eyebrow">{{ TITLE[group.section] }}</span>
          <span v-if="openable(group.section)" class="font-sans text-[0.625rem] text-faint">
            {{ chosen(group.section) }} of {{ openable(group.section) }}
          </span>
        </div>

        <div
          v-for="row in group.rows"
          :key="row.key"
          class="flex flex-col gap-0.5 border border-line px-2 py-1.5"
        >
          <div class="flex items-baseline gap-2">
            <Checkbox
              :model-value="picked.has(row.key)"
              :disabled="row.held"
              @update:model-value="(value) => toggle(row.key, value)"
            >
              <span class="font-mono text-[0.6875rem]">{{ row.value }}</span>
            </Checkbox>

            <Badge v-if="row.held" variation="neutral">already in your recipe</Badge>
            <Badge v-else-if="replacing(row)" variation="warning">replaces</Badge>
          </div>

          <code v-if="row.detail && !row.held" class="pl-5 font-mono text-[0.625rem] text-faint">{{
            row.detail
          }}</code>
        </div>
      </div>
    </div>

    <template #footer>
      <Button size="sm" @click="emit('close')">cancel</Button>
      <Button
        size="sm"
        variation="success"
        :outline="false"
        :disabled="!picked.size"
        @click="emit('apply', merged)"
        >bring {{ picked.size }} {{ picked.size === 1 ? 'thing' : 'things' }}</Button
      >
    </template>
  </ModalPanel>
</template>
