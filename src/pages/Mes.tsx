import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/app'
import { useMonthData } from '../lib/data'
import { currentMonth, money, monthName, shortDate, todayDay } from '../lib/format'
import { supabase, errMsg } from '../lib/supabase'
import type { Line, Movement } from '../lib/types'
import { Avatar, Icon, Loading, MoneyInput, NoPlan, TopBar } from '../components/ui'

type Inline = { line: string; mode: 'amount' | 'undo'; value: number } | null

export default function Mes() {
  const { householdId, month, me, memberName, toast } = useApp()
  const d = useMonthData(householdId, month)
  const [inline, setInline] = useState<Inline>(null)
  const [sheet, setSheet] = useState<string | null>(null)

  if (d.loading) return <Loading />
  if (d.error) return <div className="wrap"><TopBar /><div className="empty"><h2>No se pudieron traer las cuentas</h2><p>{d.error}</p></div></div>
  if (!d.hasPlan) return <div className="wrap"><TopBar /><NoPlan why="Primero se arma el plan y después se van marcando cobros, pagos y gastos." /></div>

  const t = d.totals, isCur = month === currentMonth(), today = todayDay()
  const used = t.incomePlan ? Math.min(100, ((t.pagado + t.gastado) / t.incomePlan) * 100) : 0

  async function saveInline(line: Line) {
    if (!inline || !householdId) return
    const amount = inline.value
    setInline(null)
    if (!amount) return
    const { error } = line.kind === 'income'
      ? await supabase.from('income_receipts').insert({ household_id: householdId, line_id: line.id, amount, received_by: me?.user_id })
      : await supabase.from('payments').insert({ household_id: householdId, line_id: line.id, amount, paid_by: me?.user_id })
    if (error) toast(errMsg(error)); else { toast(line.kind === 'income' ? 'Cobro registrado' : 'Pago registrado'); void d.refresh() }
  }
  async function undo(line: Line) {
    setInline(null)
    const { error } = await supabase.from(line.kind === 'income' ? 'income_receipts' : 'payments').delete().eq('line_id', line.id)
    if (error) toast(errMsg(error)); else { toast(line.kind === 'income' ? 'Cobro desmarcado' : 'Pago desmarcado'); void d.refresh() }
  }

  function row(line: Line) {
    const got = line.kind === 'income' ? line.received : line.paid
    const done = got > 0 && got >= line.amount, part = got > 0 && !done
    const lastBy = (line.kind === 'income' ? d.receipts : d.payments).find((m) => m.line_id === line.id)?.by ?? null
    let meta: string, warn = false
    if (done) meta = `${line.kind === 'income' ? 'Cobrado' : 'Pagado'} · ${memberName(lastBy)}${got !== line.amount ? ` · plan ${money(line.amount)}` : ''}`
    else if (part) meta = `${money(got)} de ${money(line.amount)} · falta ${money(line.amount - got)}`
    else if (!line.day) meta = 'Sin fecha'
    else if (line.kind === 'income') meta = `Cobra el día ${line.day}`
    else if (isCur && line.day < today) { meta = `Venció el ${line.day}`; warn = true }
    else if (isCur && line.day === today) { meta = 'Vence hoy'; warn = true }
    else if (isCur && line.day - today <= 3) { meta = `Vence en ${line.day - today} ${line.day - today === 1 ? 'día' : 'días'}`; warn = true }
    else meta = `Vence el ${line.day} de ${monthName(month).slice(0, 3)}`
    const label = line.kind === 'income' ? (done ? `Desmarcar cobro de ${line.name}` : `Marcar como cobrado: ${line.name}`) : (done ? `Desmarcar pago de ${line.name}` : `Marcar como pagado: ${line.name}`)
    return (
      <div key={line.id}>
        <div className={`item${done ? ' done' : ''}`}>
          <button className={`tick${done ? ' on' : part ? ' part' : ''}`} aria-label={label} aria-pressed={done}
            onClick={() => setInline(done ? { line: line.id, mode: 'undo', value: 0 } : { line: line.id, mode: 'amount', value: Math.max(0, line.amount - got) })}>
            <Icon.check />
          </button>
          {line.kind === 'income' && <Avatar userId={line.owner_user} small />}
          <div className="grow"><span className="name">{line.name}</span><span className={`meta${warn ? ' warn' : ''}`}>{meta}</span></div>
          <span className="amt num">{money(done ? got : line.amount)}</span>
        </div>
        {inline?.line === line.id && inline.mode === 'amount' && (
          <div className="inline">
            <p>{line.kind === 'income' ? '¿Cuánto entró?' : part ? '¿Cuánto pagaste ahora?' : '¿Cuánto pagaste? Si cambió, corregilo acá.'}</p>
            <div className="acts">
              <MoneyInput wide autoFocus label="Monto" value={inline.value} onChange={(v) => setInline({ ...inline, value: v })} onEnter={() => void saveInline(line)} />
              <button className="btn primary" onClick={() => void saveInline(line)}>Listo</button>
              <button className="btn" onClick={() => setInline(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {inline?.line === line.id && inline.mode === 'undo' && (
          <div className="inline">
            <p>{line.kind === 'income' ? '¿Desmarcar este cobro?' : '¿Desmarcar este pago? Se borran los pagos cargados.'}</p>
            <div className="acts"><button className="btn dark" onClick={() => void undo(line)}>Sí, desmarcar</button><button className="btn" onClick={() => setInline(null)}>Cancelar</button></div>
          </div>
        )}
      </div>
    )
  }

  const incomes = [...d.incomes].sort((a, b) => (a.day ?? 99) - (b.day ?? 99))
  const fixed = [...d.fixed].sort((a, b) => Number(a.paid >= a.amount && a.paid > 0) - Number(b.paid >= b.amount && b.paid > 0) || (a.day ?? 99) - (b.day ?? 99))
  const paidN = d.fixed.filter((l) => l.paid > 0 && l.paid >= l.amount).length
  const pendC = d.incomes.filter((l) => l.received <= 0).length
  const recent = d.expenses.slice(0, 6)
  const sheetLine = d.envelopes.find((l) => l.id === sheet) ?? null

  return (
    <div className="wrap">
      <TopBar />
      <section className="hero" aria-label="Resumen del mes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="lbl">Plata disponible hoy</span>
          <span className={`big num${t.disponible < 0 ? ' bad' : ''}`}>{money(t.disponible)}</span>
          <span className="hint num">{t.cobrado === 0 ? 'Marquen los cobros a medida que entren y esto se actualiza.' : `Cobrado ${money(t.cobrado)} − pagado y gastado ${money(t.pagado + t.gastado)}`}</span>
        </div>
        <div className={`hbar${t.pagado + t.gastado > t.incomePlan ? ' over' : ''}`} role="img" aria-label={`Usaron el ${Math.round(used)}% de los ingresos del mes`}><i style={{ width: `${used}%` }} /></div>
        <div className="pair">
          <div><span className="lbl">Ingresos del mes</span><b className="num">{money(t.incomePlan)}</b></div>
          <div><span className="lbl">Proyección a fin de mes</span><b className={`num ${t.proj < 0 ? 'bad' : 'good'}`}>{money(t.proj)}</b></div>
        </div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Cobros</h2><small>{pendC ? `Faltan ${pendC}` : 'Todo cobrado'}</small></div>
        <div className="list">{incomes.map(row)}</div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Por pagar</h2><small>{paidN} de {d.fixed.length} pagados</small></div>
        <div className="list">{fixed.length ? fixed.map(row) : <div className="item"><span className="meta">No hay gastos fijos en el plan.</span></div>}</div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Sobres del mes</h2><Link className="link" to="/plan" style={{ minHeight: 0 }}>Ver plan</Link></div>
        <div className="grid2">
          {d.envelopes.map((l) => {
            const over = l.amount > 0 && l.spent > l.amount, w = l.amount ? Math.min(100, (l.spent / l.amount) * 100) : l.spent ? 100 : 0
            return (
              <button key={l.id} className={`env${over ? ' over' : ''}`} onClick={() => setSheet(l.id)} aria-label={`${l.name}: ${money(l.spent)} de ${money(l.amount)}. Ver movimientos`}>
                <span className="n">{l.name}</span>
                <span className="v"><b className="num">{money(l.spent)}</b><small className="num">de {money(l.amount)}</small></span>
                <span className={`bar${over ? ' over' : ''}`}><i style={{ width: `${w}%` }} /></span>
              </button>
            )
          })}
        </div>
      </section>

      {recent.length > 0 && (
        <section className="sec">
          <div className="sechead"><h2>Últimos gastos</h2><small>de los dos</small></div>
          <div className="list">{recent.map((x) => <ExpenseRow key={x.id} x={x} sobre={d.envelopes.find((l) => l.id === x.line_id)?.name} onDeleted={d.refresh} />)}</div>
        </section>
      )}

      {sheetLine && (
        <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null) }} onKeyDown={(e) => { if (e.key === 'Escape') setSheet(null) }}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="shT">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div><h2 id="shT" style={{ fontSize: 20, fontWeight: 800 }}>{sheetLine.name}</h2><span className="sub num">{money(sheetLine.spent)} de {money(sheetLine.amount)}</span></div>
              <button className="iconbtn solid" onClick={() => setSheet(null)} aria-label="Cerrar" autoFocus><Icon.x /></button>
            </div>
            {(() => {
              const list = d.expenses.filter((x) => x.line_id === sheetLine.id)
              return list.length ? <div className="list">{list.map((x) => <ExpenseRow key={x.id} x={x} onDeleted={d.refresh} />)}</div> : <p className="sub">Todavía no hay gastos en este sobre.</p>
            })()}
            <Link className="btn primary block" to={`/cargar?linea=${sheetLine.id}`}>Cargar en {sheetLine.name}</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function ExpenseRow({ x, sobre, onDeleted }: { x: Movement; sobre?: string; onDeleted: () => Promise<void> }) {
  const { toast } = useApp()
  const [confirm, setConfirm] = useState(false)
  const meta = [sobre, shortDate(x.on), x.note, x.source === 'telegram' ? 'por Telegram' : null].filter(Boolean).join(' · ')
  async function del() {
    if (!confirm) { setConfirm(true); return }
    const { error } = await supabase.from('expenses').delete().eq('id', x.id)
    if (error) toast(errMsg(error)); else { toast('Gasto borrado'); void onDeleted() }
  }
  return (
    <div className="item">
      <Avatar userId={x.by} small />
      <div className="grow"><span className="name num">{money(x.amount)}</span><span className="meta">{meta}</span></div>
      <button className={confirm ? 'btn warn' : 'del'} onClick={() => void del()} onBlur={() => setConfirm(false)} aria-label={`Borrar gasto de ${money(x.amount)}`}>{confirm ? 'Borrar' : <Icon.x />}</button>
    </div>
  )
}
