<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'

const { session, device, busy, error, signedIn, configured, start, cancel, signOut } =
  useForgeAuth()
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

      <Notice v-if="!configured" variation="warning" class="mt-3">
        This copy of ccwt has no GitHub client id, so it cannot offer a sign-in.
        <template #hint>
          Register an OAuth app with device flow enabled, then start ccwt with
          <code class="font-mono">CCWT_GITHUB_CLIENT_ID</code> set to its client id.
        </template>
      </Notice>

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
            :disabled="busy || !configured"
            :title="configured ? '' : 'ccwt was started without a GitHub client id'"
            @click="start"
            >{{
              busy ? 'working…' : signedIn ? 'use a different account' : 'connect GitHub'
            }}</Button
          >
          <Button
            v-if="signedIn"
            size="sm"
            :disabled="busy"
            tooltip="Forget the account ccwt holds. Pull request state disappears from the cards until you sign in again."
            @click="signOut"
            >sign out</Button
          >
        </template>
      </div>
    </div>
  </Panel>
</template>
