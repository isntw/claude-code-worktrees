export function shortenHome(path: string, home?: string | null): string {
  if (!home) return path
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}
