import { useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'

export default function Login() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function google() {
    setBusy(true); setError(null)
    const invite = new URLSearchParams(location.search).get('invite')
    if (invite) sessionStorage.setItem('invite', invite)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) { setError(errMsg(error)); setBusy(false) }
  }

  return (
    <div className="wrap" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="eyebrow">Cuentas de la familia</span>
        <h1 className="title" style={{ fontSize: 32 }}>El plan del mes, los pagos y lo que se va gastando, entre los dos.</h1>
        <p className="sub" style={{ fontSize: 15 }}>Planifican una vez al mes, cargan en dos toques y al final ven lo pensado contra lo real.</p>
      </div>
      <button className="btn primary block" onClick={google} disabled={busy}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zM6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9zM12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.7 9.4 5.9 12 5.9z" /></svg>
        {busy ? 'Abriendo Google…' : 'Entrar con Google'}
      </button>
      {error && <p className="sub" role="alert" style={{ color: 'var(--warn)' }}>{error}</p>}
    </div>
  )
}
