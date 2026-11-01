import { useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { supabase, errMsg, TELEGRAM_BOT } from '../lib/supabase'
import { todayAR } from '../lib/format'
import { Avatar } from '../components/ui'

export default function Ajustes() {
  const { me, members, reloadMembers, toast, householdId } = useApp()
  const [name, setName] = useState(me?.display_name ?? '')
  const [initial, setInitial] = useState(me?.initial ?? '')
  const [invite, setInvite] = useState<string | null>(null)
  const [tgCode, setTgCode] = useState<string | null>(null)
  const [tgLinked, setTgLinked] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.from('telegram_links').select('chat_id').maybeSingle().then(({ data }) => setTgLinked(Boolean(data)))
  }, [tgCode])

  if (!me) return null

  async function saveProfile() {
    const { error } = await supabase.from('household_members').update({ display_name: name.trim(), initial: initial.trim().toUpperCase() }).eq('user_id', me!.user_id)
    if (error) toast(errMsg(error)); else { toast('Datos actualizados'); void reloadMembers() }
  }
  async function toggleMail() {
    const { error } = await supabase.from('household_members').update({ notify_email: !me!.notify_email }).eq('user_id', me!.user_id)
    if (error) toast(errMsg(error)); else void reloadMembers()
  }
  async function newInvite() {
    const { data, error } = await supabase.rpc('create_invite')
    if (error) toast(errMsg(error)); else setInvite(data as string)
  }
  async function linkTelegram() {
    const { data, error } = await supabase.rpc('create_telegram_code')
    if (error) toast(errMsg(error)); else setTgCode(data as string)
  }
  async function unlinkTelegram() {
    const { error } = await supabase.from('telegram_links').delete().eq('user_id', me!.user_id)
    if (error) toast(errMsg(error)); else { setTgLinked(false); toast('Telegram desvinculado') }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast('Copiado') } catch { toast('No se pudo copiar: seleccionalo a mano') }
  }
  async function exportAll() {
    const tables = ['month_plans', 'plan_lines', 'payments', 'income_receipts', 'expenses', 'household_members'] as const
    const out: Record<string, unknown> = { exportado: new Date().toISOString(), hogar: householdId }
    for (const t of tables) { const { data } = await supabase.from(t).select('*'); out[t] = data ?? [] }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cuentas-familia-${todayAR()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const inviteLink = invite ? `${location.origin}/?invite=${invite}` : ''
  const tgLink = tgCode && TELEGRAM_BOT ? `https://t.me/${TELEGRAM_BOT}?start=${tgCode}` : ''

  return (
    <div className="wrap">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="eyebrow">Ajustes</span><h1 className="title">Tu cuenta y el hogar</h1></div>

      <section className="sec">
        <div className="sechead"><h2>Tus datos</h2><small>{me.email}</small></div>
        <div className="list pad">
          <label className="lab">Nombre<input id="pname" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
          <label className="lab">Inicial<input id="pinitial" className="field" value={initial} onChange={(e) => setInitial(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} style={{ width: 80 }} /></label>
          <div><button className="btn" onClick={() => void saveProfile()} disabled={!name.trim() || !initial.trim()}>Guardar</button></div>
        </div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>El hogar</h2><small>{members.length} {members.length === 1 ? 'persona' : 'personas'}</small></div>
        <div className="list">
          {members.map((m) => (
            <div className="item" key={m.user_id}><Avatar userId={m.user_id} /><div className="grow"><span className="name">{m.display_name}</span><span className="meta">{m.email}</span></div></div>
          ))}
          <div className="inline" style={{ background: 'transparent' }}>
            {invite ? (
              <>
                <p style={{ color: 'var(--ink)' }}>Pasale este link (o el código <b className="num">{invite}</b>). Vence en 7 días.</p>
                <div className="acts"><input className="field" readOnly value={inviteLink} onFocus={(e) => e.target.select()} aria-label="Link de invitación" /><button className="btn" onClick={() => void copy(inviteLink)}>Copiar</button></div>
              </>
            ) : <div><button className="btn" onClick={() => void newInvite()}>Invitar a alguien al hogar</button></div>}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Avisos</h2></div>
        <div className="list">
          <div className="item">
            <div className="grow"><span className="name">Mail de vencimientos</span><span className="meta">Unos días antes, el mismo día y si quedó vencido sin pagar.</span></div>
            <button className={`chip who${me.notify_email ? ' on' : ''}`} aria-pressed={me.notify_email} onClick={() => void toggleMail()}>{me.notify_email ? 'Activado' : 'Apagado'}</button>
          </div>
          <div className="item" style={{ flexWrap: 'wrap' }}>
            <div className="grow"><span className="name">Telegram</span><span className="meta">Avisos y carga rápida: le escribís "super 8500" al bot y queda cargado.</span></div>
            {tgLinked ? <button className="btn" onClick={() => void unlinkTelegram()}>Desvincular</button>
              : <button className="btn primary" onClick={() => void linkTelegram()} disabled={!TELEGRAM_BOT}>Conectar</button>}
          </div>
          {tgCode && !tgLinked && (
            <div className="inline">
              <p>Abrí este link en el celular y tocá "Iniciar" en el chat del bot. El código vence en 30 minutos.</p>
              <div className="acts"><a className="btn primary" href={tgLink} target="_blank" rel="noreferrer">Abrir Telegram</a><button className="btn" onClick={() => setTgCode(null)}>Listo</button></div>
            </div>
          )}
        </div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Tus datos en un archivo</h2></div>
        <div className="list pad">
          <p className="sub">Descargá todo (planes, pagos, cobros y gastos) como respaldo.</p>
          <div><button className="btn" onClick={() => void exportAll()}>Descargar mis datos</button></div>
        </div>
      </section>

      <button className="btn block" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
    </div>
  )
}
