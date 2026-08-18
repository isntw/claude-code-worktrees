import { ref } from 'vue'

const keyFor = (projectId: string) => `ccwt.ask.handoff.${projectId}`

const known = ref<Record<string, boolean>>({})

export function useConfirm() {
  return {
    asksHandoff: (projectId: string): boolean =>
      known.value[projectId] ?? localStorage.getItem(keyFor(projectId)) !== 'no',

    setAsksHandoff: (projectId: string, value: boolean): void => {
      known.value[projectId] = value
      localStorage.setItem(keyFor(projectId), value ? 'yes' : 'no')
    },
  }
}
