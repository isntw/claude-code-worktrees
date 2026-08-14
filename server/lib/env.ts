export function envKey(prefix: string, service: string): string {
  return `${prefix}_${service.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`
}
