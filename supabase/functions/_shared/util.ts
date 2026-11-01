import { createClient } from 'npm:@supabase/supabase-js@2'

export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function todayIn(tz = 'America/Argentina/Buenos_Aires'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export const money = (n: number) => (n < 0 ? '-$' : '$') + String(Math.abs(Math.round(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export interface Line {
  id: string; household_id: string; kind: 'income' | 'fixed' | 'envelope'; name: string
  amount: number; day: number | null; paid: number; received: number; spent: number; month: string
}
export const toLine = (r: Record<string, unknown>): Line => ({
  id: r.id as string, household_id: r.household_id as string, kind: r.kind as Line['kind'], name: r.name as string,
  amount: Number(r.amount), day: (r.day as number | null) ?? null, paid: Number(r.paid), received: Number(r.received), spent: Number(r.spent), month: String(r.month),
})

export async function telegram(method: string, body: Record<string, unknown>) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) return null
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
