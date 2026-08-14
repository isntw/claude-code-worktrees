export type Tone = 'ink' | 'dim' | 'faint' | 'alarm' | 'caution' | 'live'

export interface Segment {
  text: string
  tone: Tone
  fill: Tone | null
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

interface Style {
  fg: Tone | null
  bg: Tone | null
  bold: boolean
  faded: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  inverse: boolean
}

const HUES: Tone[] = ['faint', 'alarm', 'live', 'caution', 'ink', 'ink', 'ink', 'ink']

const NONE =
  /(?:^|[^a-z])(?:0|no)\s+(?:errors?|warnings?|failures?|failed|problems?|issues?)(?![a-z])/gi
const ALARM =
  /(?:^|[^a-z/])(?:errors?|fatal|panic|exception|traceback|failed|failure)(?![a-z/])|[✖✗✘]/i
const CAUTION = /warn(?:ing)?s?(?![a-z/])|deprecat|⚠/i

const FINAL = /[@-~]/

function blank(): Style {
  return {
    fg: null,
    bg: null,
    bold: false,
    faded: false,
    italic: false,
    underline: false,
    strike: false,
    inverse: false,
  }
}

function copy(style: Style): Style {
  return { ...style }
}

function codes(params: string): number[] {
  const out: number[] = []
  for (const part of params.split(';')) {
    if (part.includes(':')) {
      for (const bit of part.split(':')) if (bit !== '') out.push(Number(bit))
    } else out.push(part === '' ? 0 : Number(part))
  }
  return out.filter((value) => Number.isFinite(value))
}

function fromRgb(red: number, green: number, blue: number): Tone {
  const high = Math.max(red, green, blue)
  const low = Math.min(red, green, blue)
  const spread = high - low

  if (high === 0 || spread / high < 0.22) return high < 110 ? 'faint' : 'ink'

  let hue: number
  if (high === red) hue = 60 * (((green - blue) / spread + 6) % 6)
  else if (high === green) hue = 60 * ((blue - red) / spread + 2)
  else hue = 60 * ((red - green) / spread + 4)

  if (hue < 20 || hue >= 330) return 'alarm'
  if (hue < 70) return 'caution'
  if (hue < 165) return 'live'
  return 'ink'
}

function fromIndex(value: number): Tone {
  if (value < 16) return HUES[value % 8]!
  if (value < 232) {
    const offset = value - 16
    const scale = [0, 95, 135, 175, 215, 255]
    return fromRgb(
      scale[Math.floor(offset / 36) % 6]!,
      scale[Math.floor(offset / 6) % 6]!,
      scale[offset % 6]!,
    )
  }
  return (value - 232) * 10 + 8 < 110 ? 'faint' : 'ink'
}

function apply(style: Style, params: string): boolean {
  const list = codes(params)
  let painted = false

  for (let index = 0; index < list.length; index += 1) {
    const code = list[index]!

    if (code === 38 || code === 48) {
      const kind = list[index + 1]
      let tone: Tone | null = null

      if (kind === 5) {
        tone = fromIndex(list[index + 2] ?? 0)
        index += 2
      } else if (kind === 2) {
        tone = fromRgb(list[index + 2] ?? 0, list[index + 3] ?? 0, list[index + 4] ?? 0)
        index += 4
      } else {
        index += 1
      }

      if (tone) {
        if (code === 38) style.fg = tone
        else style.bg = tone
        painted = true
      }
      continue
    }

    if (code === 0) Object.assign(style, blank())
    else if (code === 1) style.bold = true
    else if (code === 2) style.faded = true
    else if (code === 3) style.italic = true
    else if (code === 4) style.underline = true
    else if (code === 7) style.inverse = true
    else if (code === 9) style.strike = true
    else if (code === 21 || code === 22) {
      style.bold = false
      style.faded = false
    } else if (code === 23) style.italic = false
    else if (code === 24) style.underline = false
    else if (code === 27) style.inverse = false
    else if (code === 29) style.strike = false
    else if (code === 39) style.fg = null
    else if (code === 49) style.bg = null
    else if (code >= 30 && code <= 37) {
      style.fg = HUES[code - 30]!
      painted = true
    } else if (code >= 40 && code <= 47) {
      style.bg = HUES[code - 40]!
      painted = true
    } else if (code >= 90 && code <= 97) {
      style.fg = HUES[code - 90]!
      painted = true
    } else if (code >= 100 && code <= 107) {
      style.bg = HUES[code - 100]!
      painted = true
    }
  }

  return painted
}

function resolve(style: Style, base: Tone, text: string): Segment {
  let tone = style.fg ?? (style.bold ? 'ink' : base)
  if (style.faded && !style.fg) tone = 'faint'

  let fill = style.bg
  if (style.inverse) {
    fill = tone
    tone = 'ink'
  }

  return {
    text,
    tone,
    fill,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    strike: style.strike,
  }
}

export function severity(text: string): Tone | null {
  const said = text.replace(NONE, ' ')
  if (ALARM.test(said)) return 'alarm'
  if (CAUTION.test(said)) return 'caution'
  return null
}

export function segments(input: string): Segment[] {
  const parts: { text: string; style: Style }[] = []
  const style = blank()
  let buffer = ''
  let painted = false
  let index = 0

  const flush = () => {
    if (!buffer) return
    parts.push({ text: buffer, style: copy(style) })
    buffer = ''
  }

  while (index < input.length) {
    const char = input[index]!

    if (char !== '\u001b') {
      if (char === '\t' || char >= ' ') buffer += char
      index += 1
      continue
    }

    const next = input[index + 1]

    if (next === '[') {
      let end = index + 2
      while (end < input.length && !FINAL.test(input[end]!)) end += 1
      if (input[end] === 'm') {
        flush()
        if (apply(style, input.slice(index + 2, end))) painted = true
      }
      index = end + 1
      continue
    }

    if (next === ']') {
      let end = index + 2
      while (end < input.length) {
        if (input[end] === '\u0007') {
          end += 1
          break
        }
        if (input[end] === '\u001b' && input[end + 1] === '\\') {
          end += 2
          break
        }
        end += 1
      }
      index = end
      continue
    }

    index += next === undefined ? 1 : 2
  }

  flush()

  const plain = parts.map((part) => part.text).join('')
  const base = painted ? 'dim' : (severity(plain) ?? 'dim')

  return parts.map((part) => resolve(part.style, base, part.text))
}
