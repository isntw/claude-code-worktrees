export interface Named {
  id: string
  name: string
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function routeKeys(items: Named[]): Map<string, string> {
  const taken = new Map<string, number>()
  for (const item of items) {
    const slug = slugify(item.name)
    if (slug) taken.set(slug, (taken.get(slug) ?? 0) + 1)
  }

  const ids = new Set(items.map((item) => item.id))
  const keys = new Map<string, string>()

  for (const item of items) {
    const slug = slugify(item.name)
    const usable = slug !== '' && taken.get(slug) === 1 && !ids.has(slug)
    keys.set(item.id, usable ? slug : item.id)
  }

  return keys
}

export function resolveKey(items: Named[], key: string): string | null {
  if (items.some((item) => item.id === key)) return key

  for (const [id, slug] of routeKeys(items)) {
    if (slug === key) return id
  }

  return null
}
