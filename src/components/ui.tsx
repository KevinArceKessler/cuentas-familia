import { NavLink, Link } from 'react-router-dom'
import { useApp } from '../lib/app'
import { addMonth, cap, dots, digits, monthName } from '../lib/format'

const svg = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
export const Icon = {
  left: () => <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.2" {...svg}><path d="M15 18l-6-6 6-6" /></svg>,
  right: () => <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.2" {...svg}><path d="M9 18l6-6-6-6" /></svg>,
  check: () => <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="3" {...svg}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  x: () => <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2.2" {...svg}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  search: () => <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2.2" {...svg}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  mes: () => <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="2" {...svg}><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  plan: () => <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="2" {...svg}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>,
  plus: () => <svg width="26" height="26" viewBox="0 0 24 24" strokeWidth="2.6" {...svg}><path d="M12 5v14M5 12h14" /></svg>,
  cierre: () => <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="2" {...svg}><path d="M5 20V11M12 20V5M19 20v-6" /></svg>,
  user: () => <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="2" {...svg}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
}

export function Avatar({ userId, small }: { userId: string | null; small?: boolean }) {
  const { members, memberIndex } = useApp()
  const m = members.find((x) => x.user_id === userId)
  return <span className={`av c${memberIndex(userId)}${small ? ' sm' : ''}`} aria-label={m?.display_name}>{m?.initial ?? '?'}</span>
}

export function TopBar() {
  const { month, setMonth, me } = useApp()
  return (
    <div className="top">
      <div className="monthnav">
        <button className="iconbtn" onClick={() => setMonth(addMonth(month, -1))} aria-label="Mes anterior"><Icon.left /></button>
        <div><strong>{cap(monthName(month))}</strong><span>{month.slice(0, 4)}</span></div>
        <button className="iconbtn" onClick={() => setMonth(addMonth(month, 1))} aria-label="Mes siguiente"><Icon.right /></button>
      </div>
      {me && <Link className="me" to="/ajustes"><Avatar userId={me.user_id} small />{me.display_name}</Link>}
    </div>
  )
}

export function Nav() {
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '')
  return (
    <nav className="tabs" aria-label="Secciones">
      <div className="in">
        <NavLink to="/" end className={cls}><Icon.mes />Mes</NavLink>
        <NavLink to="/plan" className={cls}><Icon.plan />Plan</NavLink>
        <NavLink to="/cargar" className="fab" aria-label="Cargar un gasto"><Icon.plus /></NavLink>
        <NavLink to="/cierre" className={cls}><Icon.cierre />Cierre</NavLink>
        <NavLink to="/ajustes" className={cls}><Icon.user />Ajustes</NavLink>
      </div>
    </nav>
  )
}

/** Campo de pesos con separador de miles mientras se escribe. */
export function MoneyInput({ value, onChange, label, wide, autoFocus, onEnter }: { value: number; onChange: (v: number) => void; label: string; wide?: boolean; autoFocus?: boolean; onEnter?: () => void }) {
  return (
    <label className={`money${wide ? ' wide' : ''}`}>
      <span>$</span>
      <input
        inputMode="numeric" autoComplete="off" aria-label={label} placeholder="0" autoFocus={autoFocus}
        value={value ? dots(value) : ''}
        onChange={(e) => onChange(Number(digits(e.target.value).slice(0, 10)) || 0)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
        onFocus={(e) => e.target.select()}
      />
    </label>
  )
}

export function Loading() {
  return <div className="wrap"><p className="loading">Cargando las cuentas…</p></div>
}

export function NoPlan({ why }: { why: string }) {
  const { month } = useApp()
  return (
    <div className="empty">
      <h2>Todavía no planificaron {monthName(month)}</h2>
      <p>{why} Si ya planificaron el mes anterior, el plan arranca copiado de ahí y solo hay que ajustar lo que cambió.</p>
      <Link className="btn primary" to="/plan">Planificar {monthName(month)}</Link>
    </div>
  )
}
