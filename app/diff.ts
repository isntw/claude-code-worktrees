export interface DiffLine {
  kind: 'same' | 'add' | 'remove'
  text: string
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const m = a.length
  const n = b.length

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'remove', text: a[i]! })
      i += 1
    } else {
      out.push({ kind: 'add', text: b[j]! })
      j += 1
    }
  }

  while (i < m) out.push({ kind: 'remove', text: a[i++]! })
  while (j < n) out.push({ kind: 'add', text: b[j++]! })

  return out
}

export function changed(lines: DiffLine[]): boolean {
  return lines.some((line) => line.kind !== 'same')
}

export function collapse(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Set<number>()

  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let at = index - context; at <= index + context; at += 1) keep.add(at)
  })

  const out: DiffLine[] = []
  let skipping = false

  lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line)
      skipping = false
      return
    }
    if (!skipping) {
      out.push({ kind: 'same', text: '⋯' })
      skipping = true
    }
  })

  return out
}
