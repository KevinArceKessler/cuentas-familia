import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { currentMonth } from './format'
import type { Member } from './types'

interface AppState {
  session: Session | null
  authReady: boolean
  members: Member[]
  me: Member | null
  householdId: string | null
  membersReady: boolean
  reloadMembers: () => Promise<void>
  month: string
  setMonth: (m: string) => void
  toast: (msg: string) => void
  memberName: (id: string | null) => string
  memberIndex: (id: string | null) => number
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [membersReady, setMembersReady] = useState(false)
  const [month, setMonth] = useState(currentMonth())
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id ?? null

  const reloadMembers = useCallback(async () => {
    if (!uid) { setMembers([]); setMembersReady(true); return }
    const { data } = await supabase.from('household_members').select('*').order('joined_at')
    setMembers((data as Member[]) ?? [])
    setMembersReady(true)
  }, [uid])

  useEffect(() => { setMembersReady(false); void reloadMembers() }, [reloadMembers])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600)
  }, [])

  const me = members.find((m) => m.user_id === uid) ?? null
  const memberName = useCallback((id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? '', [members])
  const memberIndex = useCallback((id: string | null) => Math.max(0, members.findIndex((m) => m.user_id === id)) % 2, [members])

  return (
    <Ctx.Provider value={{ session, authReady, members, me, householdId: me?.household_id ?? null, membersReady, reloadMembers, month, setMonth, toast, memberName, memberIndex }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  )
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp fuera de AppProvider')
  return v
}
