export type LineKind = 'income' | 'fixed' | 'envelope'

export interface Member {
  household_id: string
  user_id: string
  display_name: string
  initial: string
  email: string | null
  role: 'owner' | 'member'
  notify_email: boolean
}

export interface Line {
  id: string
  plan_id: string
  household_id: string
  kind: LineKind
  item_key: string
  name: string
  amount: number
  day: number | null
  owner_user: string | null
  sort: number
  month: string
  paid: number
  received: number
  spent: number
}

export interface Movement {
  id: string
  line_id: string
  amount: number
  by: string | null
  on: string
  note: string | null
  source: string
  created_at: string
}

/** Línea editable del plan (antes de guardar). */
export interface DraftLine {
  item_key?: string
  kind: LineKind
  name: string
  amount: number
  day: number | null
  owner_user: string | null
  locked?: boolean // tiene movimientos: no se puede quitar
}
