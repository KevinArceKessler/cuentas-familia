import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { useHistory, useMonthData } from '../lib/data'
import { addMonth, cap, currentMonth, money, monthName, pct, sum } from '../lib/format'
import { supabase, errMsg } from '../lib/supabase'
import type { Line } from '../lib/types'
import { Loading, NoPlan, TopBar } from '../components/ui'

export default function Cierre() {
  const { householdId, month, toast } = useApp()
  const d = useMonthData(householdId, month)
  const hist = useHistory(householdId, month)
  const nextM = addMonth(month, 1)
  const next = useMonthData(householdId, nextM)
  const [applied, setApplied] = useState<Record<string, boolean>>({})

  const byMonth = useMemo(() => {
    const m = new Map<string, Line[]>()
    for (const l of hist) m.set(l.month, [...(m.get(l.month) ?? []), l])
    return m
  }, [hist])

  if (d.loading) return <Loading />
  if (!d.hasPlan) return <div className="wrap"><TopBar /><NoPlan why="El cierre compara lo que pensaron con lo que pasó." /></div>

  const t = d.totals, isCur = month === currentMonth()
  const pensado = t.fixedPlan + t.envPlan, real = t.pagado + t.gastado, p = pct(real, pensado)

  // Sobres que se pasan varios meses seguidos.
  const streaks = d.envelopes.map((s) => {
    const reals: number[] = []
    for (let k = 0, m = month; k < 6; k++, m = addMonth(m, -1)) {
      const l = (byMonth.get(m) ?? []).find((x) => x.item_key === s.item_key)
      if (!l || !(l.amount > 0) || l.spent <= l.amount) break
      reals.push(l.spent)
    }
    return { s, n: reals.length, avg: reals.length ? Math.round(sum(reals) / reals.length / 100) * 100 : 0 }
  }).filter((x) => x.n >= 2)

  async function apply(itemKey: string, value: number) {
    const target = next.lines.find((l) => l.item_key === itemKey)
    if (!target) return
    const { error } = await supabase.from('plan_lines').update({ amount: value }).eq('id', target.id)
    if (error) { toast(errMsg(error)); return }
    setApplied((a) => ({ ...a, [itemKey]: true }))
    toast(`Plan de ${monthName(nextM)} actualizado`)
  }

  const changed = d.fixed.filter((f) => f.paid > 0 && f.paid !== f.amount)

  // Evolución
  const months = [...byMonth.keys()].filter((m) => m <= month).sort().slice(-6)
  const rows = months.map((m) => {
    const ls = byMonth.get(m) ?? []
    return { m, p: sum(ls.filter((l) => l.kind !== 'income').map((l) => l.amount)), r: sum(ls.filter((l) => l.kind === 'fixed').map((l) => l.paid)) + sum(ls.filter((l) => l.kind === 'envelope').map((l) => l.spent)) }
  })

  return (
    <div className="wrap">
      <TopBar />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="eyebrow">{isCur ? 'Mes en curso' : 'Cierre de mes'}</span>
        <h1 className="title">{cap(monthName(month))}: pensado vs. real</h1>
      </div>

      <div className="list pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className="sub" style={{ fontSize: 12 }}>Pensaron gastar</span><b className="num" style={{ fontSize: 18 }}>{money(pensado)}</b></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}><span className="sub" style={{ fontSize: 12 }}>{isCur ? 'Van gastando' : 'Gastaron'}</span><b className="num" style={{ fontSize: 18 }}>{money(real)}</b></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`pill ${p > 3 ? 'w' : p < -3 ? 'g' : ''}`}>{p > 0 ? '+' : ''}{p}%</span>
          <span className="sub">Fijos: {money(t.pagado)} de {money(t.fixedPlan)} · Sobres: {money(t.gastado)} de {money(t.envPlan)}</span>
        </div>
      </div>

      <div className="legend">
        <span><i className="pbar" style={{ width: 16 }} />Lo pensado</span>
        <span><i className="rbar" style={{ width: 16 }} />Lo real</span>
      </div>
      <section className="sec">
        <div className="sechead"><h2>Sobres</h2><small>% sobre los ingresos</small></div>
        <div className="list">
          {d.envelopes.map((s) => {
            const mx = Math.max(s.spent, s.amount, 1), q = pct(s.spent, s.amount), cls = !s.amount ? '' : q > 3 ? 'w' : q < -3 ? 'g' : ''
            return (
              <div className="crow" key={s.id}>
                <div className="h"><span className="n">{s.name}</span><span className="r"><span className="num">{money(s.amount)} → {money(s.spent)}</span>{s.amount > 0 && <span className={`pill ${cls}`}>{q > 0 ? '+' : ''}{q}%</span>}</span></div>
                <i className="pbar" style={{ width: `${(s.amount / mx) * 100}%` }} />
                <i className={`rbar ${cls}`} style={{ width: `${(s.spent / mx) * 100}%` }} />
                <span className="sub" style={{ fontSize: 12 }}>{t.incomePlan ? Math.round((s.spent / t.incomePlan) * 100) : 0}% de los ingresos</span>
              </div>
            )
          })}
        </div>
      </section>

      {changed.length > 0 && (
        <section className="sec">
          <div className="sechead"><h2>Fijos que cambiaron</h2><small>pagado vs. plan</small></div>
          <div className="list">
            {changed.map((f) => {
              const q = pct(f.paid, f.amount)
              return <div className="item" key={f.id}><div className="grow"><span className="name">{f.name}</span><span className="meta num">Plan {money(f.amount)} · pagado {money(f.paid)}</span></div><span className={`pill ${q > 0 ? 'w' : 'g'}`}>{q > 0 ? '+' : ''}{q}%</span></div>
            })}
          </div>
        </section>
      )}

      {streaks.map(({ s, n, avg }) => {
        const inNext = next.lines.some((l) => l.item_key === s.item_key)
        return (
          <div className="insight" key={s.id}>
            <p><b>{s.name}</b> viene por encima de lo pensado hace {n} meses. En promedio gastaron {money(avg)}.</p>
            {applied[s.item_key] ? <p><b>Listo:</b> el plan de {monthName(nextM)} ya usa {money(avg)}.</p>
              : inNext ? <div><button className="btn dark" onClick={() => void apply(s.item_key, avg)}>Usar {money(avg)} en {monthName(nextM)}</button></div>
              : <p>Cuando planifiquen {monthName(nextM)} lo van a ver marcado al lado del sobre.</p>}
          </div>
        )
      })}

      <section className="sec">
        <div className="sechead"><h2>Evolución</h2><small>pensado vs. real por mes</small></div>
        {rows.length < 2
          ? <div className="list pad"><p className="sub">Con dos o más meses cargados, acá van a ver cómo viene la diferencia entre lo que planifican y lo que gastan.</p></div>
          : <Chart rows={rows} />}
      </section>
    </div>
  )
}

function Chart({ rows }: { rows: { m: string; p: number; r: number }[] }) {
  const mx = Math.max(...rows.map((r) => Math.max(r.p, r.r, 1)))
  const W = 340, base = 140, top = 16, slot = (W - 20) / rows.length, bw = Math.min(18, slot / 3)
  return (
    <div className="chartbox">
      <svg viewBox={`0 0 ${W} 170`} role="img" aria-label={`Gasto pensado y real de los últimos ${rows.length} meses`}>
        <line x1="10" y1={base} x2={W - 10} y2={base} stroke="var(--line)" strokeWidth="1" />
        {rows.map((r, i) => {
          const cx = 10 + slot * i + slot / 2, hp = (r.p / mx) * (base - top), hr = (r.r / mx) * (base - top)
          return (
            <g key={r.m}>
              <rect x={cx - bw - 1} y={base - hp} width={bw} height={hp} rx="3" fill="var(--prev)"><title>{`${cap(monthName(r.m))} pensado ${money(r.p)}`}</title></rect>
              <rect x={cx + 1} y={base - hr} width={bw} height={hr} rx="3" fill={r.r > r.p ? 'var(--warn)' : 'var(--accent)'}><title>{`${cap(monthName(r.m))} real ${money(r.r)}`}</title></rect>
              <text x={cx} y={base + 18} textAnchor="middle">{cap(monthName(r.m).slice(0, 3))}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
