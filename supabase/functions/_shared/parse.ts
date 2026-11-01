// Interpreta mensajes tipo "super 8500", "nafta 12.000 ypf ruta", "carni 8,5k", "luz $130 mil".
export interface Parsed { query: string; amount: number; note: string }

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function toAmount(tok: string, nextTok?: string): { value: number; usedNext: boolean } | null {
  const t = tok.replace(/^\$/, '').toLowerCase()
  const m = t.match(/^(\d+(?:[.,]\d+)*)(k|mil|lucas?)?$/)
  if (!m) return null
  let raw = m[1]
  let mult = m[2] ? 1000 : 1
  let usedNext = false
  if (!m[2] && nextTok && /^(k|mil|lucas?)$/i.test(nextTok)) { mult = 1000; usedNext = true }
  if (mult === 1000) {
    // "8,5k" o "8.5k" → 8500
    raw = raw.replace(',', '.')
    const v = Number(raw)
    return Number.isFinite(v) ? { value: Math.round(v * 1000), usedNext } : null
  }
  // "8.500" / "8,500" / "8500" → 8500; "8500,50" → 8500.5
  const dec = raw.match(/^(.*)[.,](\d{1,2})$/)
  if (dec && !/[.,]\d{3}$/.test(raw)) return { value: Number(dec[1].replace(/[.,]/g, '') + '.' + dec[2]), usedNext }
  return { value: Number(raw.replace(/[.,]/g, '')), usedNext }
}

export function parseMessage(text: string): Parsed | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const a = toAmount(tokens[i], tokens[i + 1])
    if (!a || !(a.value > 0)) continue
    const before = tokens.slice(0, i).join(' ')
    const after = tokens.slice(i + 1 + (a.usedNext ? 1 : 0)).join(' ')
    const query = before || after
    const note = before ? after : ''
    if (!query) return null
    return { query: normalize(query), amount: a.value, note: note.slice(0, 120) }
  }
  return null
}

/** Busca líneas cuyo nombre coincide con lo escrito. Devuelve las mejores. */
export function matchLines<T extends { name: string }>(query: string, lines: T[]): T[] {
  const q = normalize(query)
  const words = q.split(/\s+/)
  const scored = lines.map((l) => {
    const n = normalize(l.name)
    let s = 0
    if (n === q) s = 100
    else if (n.startsWith(q)) s = 80
    else if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) s = 70
    else if (n.includes(q)) s = 60
    else if (words.every((w) => n.includes(w))) s = 50
    else if (q.includes(n)) s = 40
    return { l, s }
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
  if (!scored.length) return []
  const top = scored[0].s
  // Si hay un ganador claro, solo ese; si empatan, todos los empatados.
  return scored.filter((x) => x.s === top).map((x) => x.l)
}
