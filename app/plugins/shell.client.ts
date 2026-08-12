import { initShell } from '../composables/useShell'
import { initTheme } from '../composables/useTheme'

export default defineNuxtPlugin(() => {
  initTheme()
  initShell()
})
