import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { addMonth, monthDate, sum } from './format'
import type { Line, Movement } from './types'

type Row = Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)

function toLine(r: Row): Line {
  return {
    id: r.id as string, plan_id: r.plan_id as string, household_id: r.household_id as string,
    kind: r.kind as Line['kind'], item_key: r.item_key as string, name: r.name as string,
    amount: n(r.amount), day: (r.day as number | null) ?? null, owner_user: (r.owner_user as string | null) ?? null,
    sort: n(r.sort), month: String(r.month).slice(0, 7), paid: n(r.paid), received: n(r.received), spent: n(r.spent),
  }
}
function toMov(r: Row, by: string, on: string): Movement {
  return { id: r.id as string, line_id: r.line_id as string, amount: n(r.amount), by: (r[by] as string | null) ?? null, on: r[on] as string, note: (r.note as string | null) ?? null, source: r.source as string, created_at: r.created_at as string }
}

export interface MonthData {
  loading: boolean
  error: string | null
  hasPlan: boolean
  lines: Line[]
  incomes: Line[]
  fixed: Line[]
  envelopes: Line[]
  expenses: Movement[]
  payments: Movement[]
  receipts: Movement[]
  totals: { incomePlan: number; cobrado: number; pagado: number; gastado: number; fixedPlan: number; envPlan: number; proj: number; disponible: number }
  refresh: () => Promise<void>
}

/** Todo lo de un mes, en vivo: cuando el otro carga algo, se actualiza solo. */
export function useMonthData(householdId: string | null, month: string): MonthData {
  const [state, setState] = useState<{ loading: boolean; error: string | null; hasPlan: boolean; lines: Line[]; expenses: Movement[]; payments: Movement[]; receipts: Movement[] }>({
    loading: true, error: null, hasPlan: false, lines: [], expenses: [], payments: [], receipts: [],
  })
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!householdId) return
    const my = ++seq.current
    const { data: plan, error: e1 } = await supabase.from('month_plans').select('id').eq('month', monthDate(month)).maybeSingle()
    if (e1) { setState((s) => ({ ...s, loading: false, error: e1.message })); return }
    if (!plan) { if (my === seq.current) setState({ loading: false, error: null, hasPlan: false, lines: [], expenses: [], payments: [], receipts: [] }); return }
    const { data: lr, error: e2 } = await supabase.from('month_lines').select('*').eq('plan_id', plan.id).order('sort')
    if (e2) { setState((s) => ({ ...s, loading: false, error: e2.message })); return }
    const lines = (lr as Row[]).map(toLine)
    const ids = lines.map((l) => l.id)
    const empty = { data: [] as Row[] }
    const [ex, pa, re] = ids.length
      ? await Promise.all([
          supabase.from('expenses').select('*').in('line_id', ids).order('created_at', { ascending: false }),
          supabase.from('payments').select('*').in('line_id', ids).order('created_at', { ascending: false }),
          supabase.from('income_receipts').select('*').in('line_id', ids).order('created_at', { ascending: false }),
        ])
      : [empty, empty, empty]
    if (my !== seq.current) return
    setState({
      loading: false, error: null, hasPlan: true, lines,
      expenses: ((ex.data as Row[]) ?? []).map((r) => toMov(r, 'spent_by', 'spent_on')),
      payments: ((pa.data as Row[]) ?? []).map((r) => toMov(r, 'paid_by', 'paid_on')),
      receipts: ((re.data as Row[]) ?? []).map((r) => toMov(r, 'received_by', 'received_on')),
    })
  }, [householdId, month])

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    void refresh()
    if (!householdId) return
    let t: number | undefined
    const later = () => { window.clearTimeout(t); t = window.setTimeout(() => void refresh(), 250) }
    const ch = supabase.channel(`hogar-${householdId}-${month}`)
    for (const table of ['month_plans', 'plan_lines', 'payments', 'income_receipts', 'expenses']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, later)
    }
    ch.subscribe()
    const onFocus = () => { if (document.visibilityState === 'visible') later() }
    document.addEventListener('visibilitychange', onFocus)
    return () => { window.clearTimeout(t); void supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onFocus) }
  }, [householdId, month, refresh])

  return useMemo(() => {
    const { lines } = state
    const incomes = lines.filter((l) => l.kind === 'income')
    const fixed = lines.filter((l) => l.kind === 'fixed')
    const envelopes = lines.filter((l) => l.kind === 'envelope')
    const incomePlan = sum(incomes.map((l) => l.amount))
    const cobrado = sum(incomes.map((l) => l.received))
    const pagado = sum(fixed.map((l) => l.paid))
    const gastado = sum(envelopes.map((l) => l.spent))
    const fixedPlan = sum(fixed.map((l) => l.amount))
    const envPlan = sum(envelopes.map((l) => l.amount))
    const proj = incomePlan - sum(fixed.map((l) => Math.max(l.amount, l.paid))) - sum(envelopes.map((l) => Math.max(l.amount, l.spent)))
    return { ...state, incomes, fixed, envelopes, totals: { incomePlan, cobrado, pagado, gastado, fixedPlan, envPlan, proj, disponible: cobrado - pagado - gastado }, refresh }
  }, [state, refresh])
}

/** Líneas de los últimos meses (para el cierre: evolución y sobres que se pasan seguido). */
export function useHistory(householdId: string | null, month: string, months = 6) {
  const [lines, setLines] = useState<Line[]>([])
  useEffect(() => {
    if (!householdId) return
    let alive = true
    supabase.from('month_lines').select('*').gte('month', monthDate(addMonth(month, -(months - 1)))).lte('month', monthDate(month))
      .then(({ data }) => { if (alive) setLines(((data as Row[]) ?? []).map(toLine)) })
    return () => { alive = false }
  }, [householdId, month, months])
  return lines
}
