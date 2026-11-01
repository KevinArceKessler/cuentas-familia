export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Fecha de hoy en Argentina, como YYYY-MM-DD. */
export function todayAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export const currentMonth = () => todayAR().slice(0, 7)
export const todayDay = () => Number(todayAR().slice(8, 10))

/** 'YYYY-MM' ± n meses */
export function addMonth(m: string, n: number): string {
  let [y, mo] = m.split('-').map(Number)
  mo += n
  while (mo > 12) { mo -= 12; y++ }
  while (mo < 1) { mo += 12; y-- }
  return `${y}-${String(mo).padStart(2, '0')}`
}
export const monthDate = (m: string) => `${m}-01`
export const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function dots(n: number): string {
  return String(Math.abs(Math.round(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
export const money = (n: number) => (n < 0 ? '-$' : '$') + dots(n)
export const digits = (v: string) => v.replace(/\D/g, '')
export const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0)
export const sum = (a: number[]) => a.reduce((x, y) => x + (Number(y) || 0), 0)

/** Para buscar sin importar tildes ni mayúsculas. */
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7)).slice(0, 3)}`
}
