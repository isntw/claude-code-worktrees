<script setup lang="ts">
const { report, busy, error, state, present, look, says, install, enable, disable, update, remove } =
  useModSetup()
</script>

<template>
  <section v-if="report && state !== 'unavailable'" class="border border-line px-3 py-2">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <p class="t-eyebrow">Claude Code mod . live view</p>
        <Badge :variation="look" size="sm">{{ says }}</Badge>
      </div>
      <Toggle
        v-if="present"
        :model-value="state !== 'disabled'"
        :disabled="busy"
        :title="
          state === 'disabled'
            ? 'Switch the live view back on in Claude Code.'
            : 'Switch the live view off in Claude Code. It stays installed.'
        "
        @update:model-value="(on: boolean) => (on ? enable() : disable())"
        >{{ state === 'disabled' ? 'off' : 'on' }}</Toggle
      >
    </div>

    <p class="mt-1.5 max-w-prose font-sans text-xs text-dim">
      A mod changes Claude Code's own interface rather than what the model is told. This one is
      optional and installed on its own: inside every session it draws what ccwt runs, so you see it
      without asking.
    </p>

    <ModPreview class="mt-2 max-w-[42rem]" />

    <ul class="mt-2 max-w-prose list-disc pl-4 font-sans text-xs text-dim">
      <li v-for="line in report.shows" :key="line">{{ line }}</li>
    </ul>
    <p class="mt-1.5 font-mono text-[0.6875rem] text-faint">
      {{ report.id }}<template v-if="report.installed"> {{ report.installed }}</template>
    </p>

    <Notice
      v-for="issue in report.issues"
      :key="issue.code"
      :variation="issue.severity"
      :hint="issue.hint"
      class="mt-2"
      >{{ issue.message }}</Notice
    >

    <p v-if="error" class="mt-2 max-w-prose font-sans text-[0.6875rem] text-alarm">{{ error }}</p>

    <div class="mt-2 flex items-center gap-2">
      <Button
        v-if="state === 'absent'"
        size="sm"
        :disabled="busy"
        tooltip="Install the live view into Claude Code for every session on this machine."
        @click="install"
        >{{ busy ? 'working...' : 'install' }}</Button
      >
      <Button
        v-if="state === 'outdated'"
        size="sm"
        :disabled="busy"
        tooltip="Hand Claude Code the copy of the live view this ccwt carries."
        @click="update"
        >{{ busy ? 'working...' : 'update' }}</Button
      >
      <Button
        v-if="present"
        size="sm"
        :disabled="busy"
        tooltip="Uninstall the live view. The plugin above is not touched."
        @click="remove"
        >remove</Button
      >
    </div>
  </section>
</template>
