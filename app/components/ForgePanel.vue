<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import type { DeviceCode, ForgeSession } from '#shared/types'

const api = useApi()

const session = ref<ForgeSession | null>(null)
const device = ref<DeviceCode | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null

const signedIn = computed(() => session.value?.login !== null && session.value?.login !== undefined)

const ready = computed(() => session.value?.configured !== false)

const load = async () => {
  session.value = await api.getForgeSession().catch(() => null)
}

const stopPolling = () => {
  if (timer) clearTimeout(timer)
  timer = null
}

const poll = async (handle: string, seconds: number) => {
  timer = setTimeout(async () => {
    const outcome = await api.pollForgeLogin(handle).catch((cause: Error) => ({
      state: 'failed' as const,
      message: cause.message,
    }))

    if (outcome.state === 'pending') {
      await poll(handle, outcome.interval)
      return
    }

    if (outcome.state === 'failed') {
      error.value = outcome.message
      device.value = null
      return
    }

    session.value = outcome.session
    device.value = null
  }, seconds * 1000)
}

const start = async () => {
  busy.value = true
  error.value = null
  try {
    const started = await api.startForgeLogin()
    device.value = started
    await poll(started.handle, started.interval)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}

const cancel = () => {
  stopPolling()
  device.value = null
}

const signOut = async () => {
  busy.value = true
  try {
    session.value = await api.signOutForge()
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <Panel title="GitHub">
    <div class="px-3 py-3">
      <p v-if="signedIn" class="flex items-center gap-2">
        <span class="font-mono text-xs text-ink">{{ session?.login }}</span>
        <span class="font-sans text-[0.6875rem] text-faint">signed in to ccwt</span>
      </p>

      <p v-else class="max-w-prose font-sans text-xs text-dim">
        ccwt reads pull request state for every worktree, and can merge one from its card. Both need
        a GitHub account. The token is kept in <code class="font-mono">~/.ccwt</code> and never
        leaves this machine.
      </p>

      <p
        v-if="signedIn && session && !session.canMerge"
        class="mt-2 max-w-prose font-sans text-[0.6875rem] text-caution"
      >
        This sign-in can read pull requests but not merge them. Sign in again to grant write access.
      </p>

      <div v-if="!ready" class="mt-3 border border-caution px-3 py-2">
        <p class="max-w-prose font-sans text-[0.6875rem] text-caution">
          This copy of ccwt has no GitHub client id, so it cannot offer a sign-in.
        </p>
        <p class="mt-1 max-w-prose font-sans text-[0.6875rem] text-faint">
          Register an OAuth app with device flow enabled, then start ccwt with
          <code class="font-mono">CCWT_GITHUB_CLIENT_ID</code> set to its client id.
        </p>
      </div>

      <div v-if="device" class="mt-3 border border-line-strong px-3 py-3">
        <p class="t-eyebrow">Enter this code on GitHub</p>
        <p class="mt-2 font-mono text-lg tracking-[0.2em] text-ink">{{ device.userCode }}</p>
        <a
          :href="device.verificationUri"
          target="_blank"
          rel="noreferrer"
          class="mt-2 inline-flex items-center gap-1 font-mono text-[0.6875rem] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
        >
          {{ device.verificationUri.replace(/^https?:\/\//, '') }}
          <ExternalLink :size="11" aria-hidden="true" />
        </a>
        <p class="mt-2 font-sans text-[0.6875rem] text-faint">
          Waiting for you to authorise it. This page picks it up on its own.
        </p>
      </div>

      <p v-if="error" class="mt-2 max-w-prose font-sans text-[0.6875rem] text-alarm">{{ error }}</p>

      <div class="mt-3 flex items-center gap-2">
        <Button v-if="device" size="sm" @click="cancel">cancel</Button>
        <template v-else>
          <Button
            size="sm"
            :disabled="busy || !ready"
            :title="ready ? '' : 'ccwt was started without a GitHub client id'"
            @click="start"
            >{{
              busy ? 'working…' : signedIn ? 'use a different account' : 'connect GitHub'
            }}</Button
          >
          <Button
            v-if="signedIn"
            size="sm"
            :disabled="busy"
            title="Forget the account ccwt holds. Pull request state disappears from the cards until you sign in again."
            @click="signOut"
            >sign out</Button
          >
        </template>
      </div>
    </div>
  </Panel>
</template>
