import { ref } from 'vue'

const RAIL_KEY = 'ccwt.sidebar'
const GUIDE_KEY = 'ccwt.guide'
const GUIDE_REVISION = '1'

const sidebarCollapsed = ref(false)
const guideOpen = ref(false)

export function initShell(): void {
  sidebarCollapsed.value = localStorage.getItem(RAIL_KEY) === 'collapsed'
  guideOpen.value = localStorage.getItem(GUIDE_KEY) !== GUIDE_REVISION
}

export function useShell() {
  return {
    sidebarCollapsed,
    toggleSidebar: () => {
      sidebarCollapsed.value = !sidebarCollapsed.value
      localStorage.setItem(RAIL_KEY, sidebarCollapsed.value ? 'collapsed' : 'expanded')
    },
    guideOpen,
    openGuide: () => {
      guideOpen.value = true
    },
    closeGuide: () => {
      guideOpen.value = false
      localStorage.setItem(GUIDE_KEY, GUIDE_REVISION)
    },
  }
}
