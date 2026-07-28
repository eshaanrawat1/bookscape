function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case rn:
        h = ((gn - bn) / delta) % 6
        break
      case gn:
        h = (bn - rn) / delta + 2
        break
      default:
        h = (rn - gn) / delta + 4
        break
    }
    h *= 60
    if (h < 0) h += 360
  }

  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let [r1, g1, b1] = [0, 0, 0]

  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]

  const m = l - c / 2
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ]
}

function buildHeroGlow(color?: string | null, fallback = 'oklch(0.62 0.14 250)'): string {
  const raw = String(color || '').trim()
  const rgbMatch = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i)
  if (rgbMatch) {
    const r = Math.min(255, Number(rgbMatch[1]))
    const g = Math.min(255, Number(rgbMatch[2]))
    const b = Math.min(255, Number(rgbMatch[3]))
    const [h, s, l] = rgbToHsl(r, g, b)
    const warmHue = l < 0.45 ? (h + 18) % 360 : h
    const vivid = hslToRgb(warmHue, Math.min(1, Math.max(0.65, s * 1.2)), Math.min(0.68, Math.max(0.44, l + 0.2)))
    const highlight = hslToRgb(warmHue, Math.min(1, Math.max(0.5, s * 0.95)), Math.min(0.84, Math.max(0.62, l + 0.34)))
    const shadow = hslToRgb(warmHue, Math.min(1, Math.max(0.5, s)), Math.max(0.18, l * 0.45))
    return [
      `radial-gradient(circle at 28% 26%, rgba(${vivid[0]}, ${vivid[1]}, ${vivid[2]}, 0.72), rgba(${vivid[0]}, ${vivid[1]}, ${vivid[2]}, 0) 60%)`,
      `radial-gradient(circle at 74% 70%, rgba(${highlight[0]}, ${highlight[1]}, ${highlight[2]}, 0.56), rgba(${highlight[0]}, ${highlight[1]}, ${highlight[2]}, 0) 68%)`,
      `radial-gradient(circle at 52% 78%, rgba(${shadow[0]}, ${shadow[1]}, ${shadow[2]}, 0.42), rgba(${shadow[0]}, ${shadow[1]}, ${shadow[2]}, 0) 72%)`,
    ].join(', ')
  }

  if (raw) return raw
  return fallback
}

function buildDialogGlow(color?: string | null, fallback = 'oklch(0.62 0.14 250)'): string {
  const raw = String(color || '').trim()
  const rgbMatch = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i)
  if (rgbMatch) {
    const r = Math.min(255, Number(rgbMatch[1]))
    const g = Math.min(255, Number(rgbMatch[2]))
    const b = Math.min(255, Number(rgbMatch[3]))
    const [h, s, l] = rgbToHsl(r, g, b)
    const warmHue = l < 0.45 ? (h + 14) % 360 : h
    const mid = hslToRgb(warmHue, Math.min(1, Math.max(0.45, s * 0.72)), Math.min(0.72, Math.max(0.46, l + 0.16)))
    const fade = hslToRgb(warmHue, Math.min(1, Math.max(0.35, s * 0.55)), Math.max(0.24, l * 0.52))
    return [
      `radial-gradient(circle at 22% 18%, rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, 0.38), rgba(${mid[0]}, ${mid[1]}, ${mid[2]}, 0) 60%)`,
      `radial-gradient(circle at 78% 74%, rgba(${fade[0]}, ${fade[1]}, ${fade[2]}, 0.24), rgba(${fade[0]}, ${fade[1]}, ${fade[2]}, 0) 75%)`,
    ].join(', ')
  }

  if (raw) return raw
  return fallback
}

export { buildHeroGlow, buildDialogGlow }
