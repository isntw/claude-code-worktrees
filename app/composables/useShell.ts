import { ref } from 'vue'

const RAIL_KEY = 'ccwt.sidebar'

const sidebarCollapsed = ref(false)

export function initShell(): void {
  sidebarCollapsed.value = localStorage.getItem(RAIL_KEY) === 'collapsed'
}

export function useShell() {
  return {
    sidebarCollapsed,
    toggleSidebar: () => {
      sidebarCollapsed.value = !sidebarCollapsed.value
      localStorage.setItem(RAIL_KEY, sidebarCollapsed.value ? 'collapsed' : 'expanded')
    },
  }
}
