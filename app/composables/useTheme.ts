import { ref } from 'vue'

const KEY = 'ccwt.theme'

const dark = ref(true)

function apply(value: boolean): void {
  document.documentElement.classList.toggle('dark', value)
}

export function initTheme(): void {
  const stored = localStorage.getItem(KEY)
  dark.value = stored === null ? true : stored === 'dark'
  apply(dark.value)
}

export function useTheme() {
  return {
    dark,
    toggle: () => {
      dark.value = !dark.value
      apply(dark.value)
      localStorage.setItem(KEY, dark.value ? 'dark' : 'light')
    },
  }
}
