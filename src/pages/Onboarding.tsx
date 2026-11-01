import { useState } from 'react'
import { useApp } from '../lib/app'
import { supabase, errMsg } from '../lib/supabase'

export default function Onboarding() {
  const { session, reloadMembers } = useApp()
  const full = (session?.user.user_metadata?.full_name as string | undefined) ?? ''
  const first = full.split(' ')[0] ?? ''
  const pending = new URLSearchParams(location.search).get('invite') ?? sessionStorage.getItem('invite') ?? ''
  const [mode, setMode] = useState<'create' | 'join'>(pending ? 'join' : 'create')
  const [name, setName] = useState(first)
  const [initial, setInitial] = useState(first.charAt(0).toUpperCase())
  const [house, setHouse] = useState('Nuestra casa')
  const [code, setCode] = useState(pending)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !initial.trim()) { setError('Completá tu nombre y tu inicial.'); return }
    setBusy(true); setError(null)
    const { error } = mode === 'create'
      ? await supabase.rpc('create_household', { p_name: house, p_display_name: name, p_initial: initial })
      : await supabase.rpc('join_household', { p_code: code, p_display_name: name, p_initial: initial })
    if (error) { setError(errMsg(error)); setBusy(false); return }
    sessionStorage.removeItem('invite')
    history.replaceState(null, '', '/')
    await reloadMembers()
  }

  return (
    <form className="wrap" onSubmit={submit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="eyebrow">Bienvenida</span>
        <h1 className="title">Armemos el hogar</h1>
        <p className="sub">Uno de los dos crea el hogar y después le pasa un código al otro para sumarse. Los datos quedan en común.</p>
      </div>
      <div className="chips" role="group" aria-label="Cómo empezar">
        <button type="button" className={`chip${mode === 'create' ? ' on' : ''}`} aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Crear el hogar</button>
        <button type="button" className={`chip${mode === 'join' ? ' on' : ''}`} aria-pressed={mode === 'join'} onClick={() => setMode('join')}>Tengo un código</button>
      </div>
      <div className="list pad">
        {mode === 'create'
          ? <label className="lab">Nombre del hogar<input id="house" className="field" value={house} onChange={(e) => setHouse(e.target.value)} maxLength={60} /></label>
          : <label className="lab">Código que te pasaron<input id="code" className="field" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} autoCapitalize="characters" placeholder="Ej. 3FA9C21B" /></label>}
        <label className="lab">Tu nombre<input id="name" className="field" value={name} onChange={(e) => { setName(e.target.value); if (!initial) setInitial(e.target.value.charAt(0).toUpperCase()) }} maxLength={40} /></label>
        <label className="lab">Tu inicial (aparece en cada gasto que cargues)<input id="initial" className="field" value={initial} onChange={(e) => setInitial(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} style={{ width: 80 }} /></label>
      </div>
      {error && <p className="sub" role="alert" style={{ color: 'var(--warn)' }}>{error}</p>}
      <button className="btn primary block" disabled={busy}>{mode === 'create' ? 'Crear el hogar' : 'Sumarme'}</button>
    </form>
  )
}
