import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/app'
import { useMonthData } from '../lib/data'
import { addMonth, cap, digits, money, monthDate, monthName, pct, sum } from '../lib/format'
import { supabase, errMsg } from '../lib/supabase'
import type { DraftLine, Line, LineKind } from '../lib/types'
import { Avatar, Icon, Loading, MoneyInput, TopBar } from '../components/ui'

const TEMPLATE_FIXED = ['Luz', 'Gas', 'Agua', 'Internet', 'Celulares', 'Tarjeta de crédito']
const TEMPLATE_ENV = ['Súper', 'Nafta', 'Carnicería', 'Verdulería', 'Farmacia', 'Varios']

function fromLines(lines: Line[], lockMoved: boolean): DraftLine[] {
  return lines.map((l) => ({
    item_key: l.item_key, kind: l.kind, name: l.name, amount: l.amount, day: l.day, owner_user: l.owner_user,
    locked: lockMoved && (l.paid > 0 || l.received > 0 || l.spent > 0),
  }))
}

export default function Plan() {
  const { householdId, month, members, me, toast } = useApp()
  const nav = useNavigate()
  const prevM = addMonth(month, -1)
  const cur = useMonthData(householdId, month)
  const prev = useMonthData(householdId, prevM)
  const [draft, setDraft] = useState<DraftLine[] | null>(null)
  const [source, setSource] = useState<'saved' | 'copy' | 'template'>('template')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  // Armar el borrador: el plan guardado, o una copia del mes anterior, o la plantilla.
  useEffect(() => {
    if (cur.loading || prev.loading || dirty) return
    if (cur.hasPlan) { setDraft(fromLines(cur.lines, true)); setSource('saved') }
    else if (prev.hasPlan) { setDraft(fromLines(prev.lines, false)); setSource('copy') }
    else {
      setDraft([
        ...members.map((m) => ({ kind: 'income' as const, name: `${m.display_name} · Sueldo`, amount: 0, day: null, owner_user: m.user_id })),
        ...TEMPLATE_FIXED.map((n) => ({ kind: 'fixed' as const, name: n, amount: 0, day: null, owner_user: null })),
        ...TEMPLATE_ENV.map((n) => ({ kind: 'envelope' as const, name: n, amount: 0, day: null, owner_user: null })),
      ])
      setSource('template')
    }
  }, [cur.loading, prev.loading, cur.hasPlan, prev.hasPlan, cur.lines, prev.lines, members, dirty])

  useEffect(() => { setDirty(false); setDraft(null) }, [month])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const prevByKey = useMemo(() => new Map(prev.lines.map((l) => [l.item_key, l])), [prev.lines])

  if (!draft) return <Loading />

  const totals = {
    inc: sum(draft.filter((l) => l.kind === 'income').map((l) => l.amount)),
    pl: sum(draft.filter((l) => l.kind !== 'income').map((l) => l.amount)),
  }
  const margin = totals.inc - totals.pl

  function update(i: number, patch: Partial<DraftLine>) {
    setDraft((d) => d!.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true)
  }
  function remove(i: number) { setDraft((d) => d!.filter((_, j) => j !== i)); setDirty(true) }
  function add(kind: LineKind) {
    setDraft((d) => [...d!, { kind, name: '', amount: 0, day: null, owner_user: kind === 'income' ? me?.user_id ?? null : null }]); setDirty(true)
    setTimeout(() => { const els = document.querySelectorAll<HTMLInputElement>(`.nameinput[data-kind="${kind}"]`); els[els.length - 1]?.focus() }, 0)
  }
  function nextOwner(id: string | null) {
    const i = members.findIndex((m) => m.user_id === id)
    return members[(i + 1) % members.length]?.user_id ?? null
  }

  async function save() {
    const keep = draft!.filter((l) => l.name.trim() && (l.kind !== 'fixed' || l.amount > 0 || l.locked))
    const dropped = draft!.filter((l) => l.kind === 'fixed' && l.name.trim() && !(l.amount > 0) && !l.locked).length
    setBusy(true)
    const { error } = await supabase.rpc('save_month_plan', {
      p_month: monthDate(month),
      p_lines: keep.map((l, i) => ({ item_key: l.item_key ?? '', kind: l.kind, name: l.name.trim().slice(0, 60), amount: l.amount, day: l.day ?? '', owner_user: l.owner_user ?? '', sort: i })),
    })
    setBusy(false)
    if (error) { toast(errMsg(error)); return }
    toast(dropped ? `Plan guardado. ${dropped} ${dropped === 1 ? 'fijo sin monto quedó afuera' : 'fijos sin monto quedaron afuera'}` : `Plan de ${monthName(month)} guardado`)
    setDirty(false)
    await cur.refresh()
    nav('/')
  }

  function hint(l: DraftLine) {
    const p = l.item_key ? prevByKey.get(l.item_key) : undefined
    if (!p) return null
    const lbl = cap(monthName(prevM))
    if (l.kind === 'fixed') {
      const last = p.paid > 0 ? p.paid : p.amount
      if (!l.amount || l.amount === last) return <span>{lbl}: {money(last)}</span>
      const q = pct(l.amount, last)
      return <span className={l.amount > last ? 'hintw' : 'hintg'}>{lbl}: {money(last)} ({q > 0 ? '+' : ''}{q}%)</span>
    }
    if (l.kind === 'envelope') {
      return p.spent > l.amount ? <span className="hintw">En {monthName(prevM)} gastaron {money(p.spent)}, más de lo que ponés</span> : <span>En {monthName(prevM)} gastaron {money(p.spent)}</span>
    }
    return null
  }

  function section(kind: LineKind, title: string, subtitle: string, addLabel: string) {
    return (
      <section className="sec">
        <div className="sechead"><h2>{title}</h2><small>{subtitle}</small></div>
        <div className="list">
          {draft!.map((l, i) => l.kind !== kind ? null : (
            <div className="prow" key={i}>
              <div className="r1">
                {kind === 'income' && (
                  <button className="whobtn" onClick={() => update(i, { owner_user: nextOwner(l.owner_user) })} aria-label="Cambiar de quién es este ingreso"><Avatar userId={l.owner_user} /></button>
                )}
                <input className="nameinput" data-kind={kind} value={l.name} placeholder="Nombre" aria-label="Nombre" maxLength={60} onChange={(e) => update(i, { name: e.target.value })} />
                <MoneyInput label={`Monto de ${l.name}`} value={l.amount} onChange={(v) => update(i, { amount: v })} />
                {l.locked
                  ? <span className="del" title="Tiene movimientos cargados" aria-label="No se puede quitar: tiene movimientos cargados">•</span>
                  : <button className="del" onClick={() => remove(i)} aria-label={`Quitar ${l.name}`}><Icon.x /></button>}
              </div>
              {kind !== 'envelope'
                ? <div className="r2">{kind === 'income' ? 'Cobra el día' : 'Vence el día'}
                    <input className="dayinput" inputMode="numeric" value={l.day ?? ''} placeholder="–" aria-label={`Día de ${l.name}`}
                      onChange={(e) => { const v = Math.min(31, Number(digits(e.target.value).slice(0, 2)) || 0); update(i, { day: v || null }) }} />
                    {hint(l)}
                  </div>
                : hint(l) && <div className="r2">{hint(l)}</div>}
            </div>
          ))}
          <div style={{ padding: '0 16px' }}><button className="link" onClick={() => add(kind)}>{addLabel}</button></div>
        </div>
      </section>
    )
  }

  return (
    <div className="wrap">
      <TopBar />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="eyebrow">Un ratito, una vez al mes</span>
        <h1 className="title">Planificar {monthName(month)}</h1>
        <p className="sub">{source === 'saved' ? 'Plan guardado. Lo pueden ajustar cuando quieran durante el mes.' : source === 'copy' ? `Arranca copiado de ${monthName(prevM)}. Definan montos y fechas de este mes.` : 'Primera vez: completen montos y fechas. Los nombres se pueden cambiar.'}</p>
      </div>
      <section className="hero" aria-label="Totales del plan">
        <div className="pair">
          <div><span className="lbl">Ingresos del hogar</span><b className="num">{money(totals.inc)}</b></div>
          <div><span className="lbl">Gastos proyectados</span><b className="num">{money(totals.pl)}</b></div>
        </div>
        <div style={{ height: 1, background: 'var(--hero-track)' }} />
        <div className="pair" style={{ alignItems: 'baseline' }}>
          <span className="lbl" style={{ fontSize: 14 }}>Margen del mes</span>
          <b className={`num ${margin < 0 ? 'bad' : 'good'}`} style={{ fontSize: 28, fontWeight: 800 }}>{money(margin)}</b>
        </div>
      </section>
      {section('income', 'Ingresos', 'Todo va a una sola bolsa', '+ Agregar ingreso')}
      {section('fixed', 'Gastos fijos de este mes', 'Monto y vencimiento', '+ Agregar gasto fijo')}
      {section('envelope', 'Sobres estimados', 'Lo que piensan gastar', '+ Agregar sobre')}
      <div className="savebar">
        {dirty && <span className="dirty">Hay cambios sin guardar</span>}
        <button className="btn primary block" onClick={() => void save()} disabled={busy}>{busy ? 'Guardando…' : source === 'saved' ? 'Guardar cambios' : `Listo, arrancar ${monthName(month)}`}</button>
      </div>
    </div>
  )
}
