import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../lib/app'
import { useMonthData } from '../lib/data'
import { cap, currentMonth, money, monthName, norm } from '../lib/format'
import { supabase, errMsg } from '../lib/supabase'
import type { Line } from '../lib/types'
import { Icon, Loading, NoPlan, TopBar } from '../components/ui'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del']

export default function Cargar() {
  const { householdId, month, members, me, toast } = useApp()
  const d = useMonthData(householdId, month)
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [selId, setSelId] = useState<string | null>(params.get('linea'))
  const [amount, setAmount] = useState('')
  const [who, setWho] = useState<string | null>(me?.user_id ?? null)
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(() => [...d.envelopes, ...d.fixed], [d.envelopes, d.fixed])

  // Sugerencias: lo que usaron más recientemente, después el orden del plan.
  const ordered = useMemo(() => {
    const last = new Map<string, number>()
    for (const m of [...d.expenses, ...d.payments]) last.set(m.line_id, Math.max(last.get(m.line_id) ?? 0, Date.parse(m.created_at)))
    return candidates.map((l, i) => ({ l, i })).sort((a, b) => (last.get(b.l.id) ?? 0) - (last.get(a.l.id) ?? 0) || a.i - b.i).map((x) => x.l)
  }, [candidates, d.expenses, d.payments])

  useEffect(() => {
    if (!candidates.length) return
    if (!selId || !candidates.some((l) => l.id === selId)) setSelId(ordered[0]?.id ?? null)
  }, [candidates, ordered, selId])

  if (d.loading) return <Loading />
  if (!d.hasPlan) return <div className="wrap"><TopBar /><NoPlan why="Los gastos se cargan en los sobres y fijos del plan." /></div>
  if (!candidates.length) return <div className="wrap"><TopBar /><div className="empty"><h2>El plan no tiene sobres ni fijos</h2><p>Agreguen al menos uno para poder cargar.</p><Link className="btn primary" to="/plan">Ir al plan</Link></div></div>

  const sel: Line | undefined = candidates.find((l) => l.id === selId)
  const amt = Number(amount) || 0
  const nq = norm(q)
  const shown = nq
    ? ordered.filter((l) => norm(l.name).includes(nq)).slice(0, 8)
    : ordered.slice(0, 5)
  const visible = sel && !shown.some((l) => l.id === sel.id) ? [sel, ...shown] : shown

  function press(k: string) {
    if (k === 'del') setAmount((a) => a.slice(0, -1))
    else setAmount((a) => (a.length >= 10 ? a : (a + k).replace(/^0+/, '')))
  }

  async function save() {
    if (!sel || !amt || !householdId) return
    setBusy(true)
    const base = { household_id: householdId, line_id: sel.id, amount: amt, note: note.trim().slice(0, 120) || null }
    const { error } = sel.kind === 'fixed'
      ? await supabase.from('payments').insert({ ...base, paid_by: who })
      : await supabase.from('expenses').insert({ ...base, spent_by: who })
    setBusy(false)
    if (error) { toast(errMsg(error)); return }
    toast(`${sel.kind === 'fixed' ? 'Pago' : 'Gasto'} guardado: ${sel.name} ${money(amt)}`)
    nav('/')
  }

  let status = null
  if (sel?.kind === 'fixed') {
    const total = sel.paid + amt, diff = total - sel.amount, w = sel.amount ? Math.min(100, (total / sel.amount) * 100) : 100
    status = (
      <div className="status">
        <div className="l"><b>Fijo {sel.name}</b><b className={diff > 0 ? 'hintw' : 'hintg'}>{diff > 0 ? `+${money(diff)} sobre el plan` : diff < 0 ? `Faltan ${money(-diff)}` : 'Justo lo planificado'}</b></div>
        <span className={`bar${diff > 0 ? ' over' : ''}`} style={{ height: 8 }}><i style={{ width: `${w}%` }} /></span>
        <span className="num" style={{ color: 'var(--muted)', fontSize: 12 }}>{sel.paid ? `Ya pagado ${money(sel.paid)} · ` : ''}Con esto: {money(total)} de {money(sel.amount)}{sel.day ? ` · vence el ${sel.day}` : ''}</span>
      </div>
    )
  } else if (sel) {
    const after = sel.spent + amt, left = sel.amount - after, over = left < 0, w = sel.amount ? Math.min(100, (after / sel.amount) * 100) : 100
    status = (
      <div className="status">
        <div className="l"><b>Sobre {sel.name}</b><b className={over ? 'hintw' : 'hintg'}>{over ? `Se pasa ${money(-left)}` : `Quedan ${money(left)}`}</b></div>
        <span className={`bar${over ? ' over' : ''}`} style={{ height: 8 }}><i style={{ width: `${w}%` }} /></span>
        <span className="num" style={{ color: 'var(--muted)', fontSize: 12 }}>Con este gasto: {money(after)} de {money(sel.amount)}</span>
      </div>
    )
  }

  return (
    <div className="wrap">
      <TopBar />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className="title" style={{ fontSize: 22 }}>Nuevo gasto</h1>
        <span className="pill">{month === currentMonth() ? 'Hoy' : cap(monthName(month))}</span>
      </div>

      <label className="search"><Icon.search />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: súper, luz, tarjeta…" aria-label="Buscar entre sobres y gastos fijos" autoComplete="off"
          onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); setSelId(shown[0].id); setQ('') } }} />
      </label>
      <div className="chips" role="group" aria-label="Sobres y gastos fijos">
        {visible.map((l) => (
          <button key={l.id} className={`chip${l.id === selId ? ' on' : ''}`} aria-pressed={l.id === selId} onClick={() => { setSelId(l.id); setQ('') }}>
            {l.name}{l.kind === 'fixed' && <small className="tag">{l.paid >= l.amount && l.paid > 0 ? 'fijo ✓' : 'fijo'}</small>}
          </button>
        ))}
      </div>
      {nq && !shown.length && <p className="sub" style={{ marginTop: -8 }}>No hay nada con ese nombre en el plan. Se agrega desde Plan.</p>}

      <div className="amount"><span className="eyebrow">Monto</span><b className="num" aria-live="polite">{money(amt)}</b></div>
      {status}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="eyebrow" style={{ marginRight: 4 }}>¿Quién?</span>
        {members.map((m) => (
          <button key={m.user_id} className={`chip who${who === m.user_id ? ' on' : ''}`} aria-pressed={who === m.user_id} onClick={() => setWho(m.user_id)}>{m.display_name}</button>
        ))}
      </div>
      <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional): carnicería del barrio, cumple…" aria-label="Nota" maxLength={120} autoComplete="off" />

      <div className="keypad">
        {KEYS.map((k) => <button key={k} className="key" onClick={() => press(k)} aria-label={k === 'del' ? 'Borrar' : k}>{k === 'del' ? '⌫' : k}</button>)}
      </div>
      <button className="btn primary block" onClick={() => void save()} disabled={!amt || !sel || busy}>{sel?.kind === 'fixed' ? 'Guardar pago' : 'Guardar gasto'}</button>
    </div>
  )
}
