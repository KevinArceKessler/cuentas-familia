import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './lib/app'
import { configured } from './lib/supabase'
import { Loading, Nav } from './components/ui'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Mes from './pages/Mes'
import Plan from './pages/Plan'
import Cargar from './pages/Cargar'
import Cierre from './pages/Cierre'
import Ajustes from './pages/Ajustes'

function Shell() {
  const { session, authReady, membersReady, me } = useApp()
  const loc = useLocation()
  if (!configured) {
    return <div className="wrap"><div className="empty"><h2>Falta configurar Supabase</h2><p>Completá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver .env.example) y volvé a levantar la app.</p></div></div>
  }
  if (!authReady) return <Loading />
  if (!session) return <Login />
  if (!membersReady) return <Loading />
  if (!me) return <Onboarding />
  return (
    <>
      <Routes location={loc}>
        <Route path="/" element={<Mes />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/cargar" element={<Cargar />} />
        <Route path="/cierre" element={<Cierre />} />
        <Route path="/ajustes" element={<Ajustes />} />
        <Route path="*" element={<Mes />} />
      </Routes>
      <Nav />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  )
}
