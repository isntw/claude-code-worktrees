import type { SocketMessage } from '../../shared/types'

const ALLOWED_ORIGINS = new Set(['127.0.0.1', 'localhost', '[::1]'])

const peers = new Set<{ send: (data: string) => void }>()

export function broadcast(message: SocketMessage): void {
  const data = JSON.stringify(message)
  for (const peer of peers) peer.send(data)
}

export default defineWebSocketHandler({
  upgrade(request) {
    const origin = request.headers.get('origin')
    if (!origin) return

    let hostname: string
    try {
      hostname = new URL(origin).hostname
    } catch {
      throw createError({ statusCode: 403, statusMessage: 'Bad origin' })
    }

    if (!ALLOWED_ORIGINS.has(hostname)) {
      throw createError({ statusCode: 403, statusMessage: 'Bad origin' })
    }
  },

  open(peer) {
    peers.add(peer)
  },

  close(peer) {
    peers.delete(peer)
  },

  error(peer) {
    peers.delete(peer)
  },
})
