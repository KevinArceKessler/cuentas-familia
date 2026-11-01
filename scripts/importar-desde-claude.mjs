#!/usr/bin/env node
// Importa los datos de la primera versión (la app en Claude) a Supabase.
//
// 1. En la app de Claude: Ajustes → "Descargar mis datos" → cuentas-familia-AAAA-MM-DD.json
// 2. En la app nueva: entren los dos con Google y armen el hogar (así existen sus usuarios).
// 3. Corran:
//    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/importar-desde-claude.mjs \
//      --archivo cuentas-familia-2026-11-01.json --kevin <mail de Kevin> --celeste <mail de Celeste> [--probar]
//
// --probar muestra qué se importaría sin escribir nada. La service role key NO va en el front ni en git.

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return acc
}, []))
const dry = Boolean(args.probar)
if (!args.archivo || !args.kevin || !args.celeste) {
  console.error('Uso: node scripts/importar-desde-claude.mjs --archivo <json> --kevin <mail> --celeste <mail> [--probar]')
  process.exit(1)
}
const data = JSON.parse(readFileSync(args.archivo, 'utf8'))
const plans = data.plans ?? {}
const gastos = data.gastos ?? []
const pagos = Object.values(data.pagos ?? {})
const cobros = Object.values(data.cobros ?? {})

let db = null, members = []
if (!dry) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: m, error } = await db.from('household_members').select('household_id, user_id, email')
  if (error) throw error
  members = m
}
const byMail = (mail) => members.find((m) => (m.email ?? '').toLowerCase() === String(mail).toLowerCase())
const K = dry ? { user_id: 'KEVIN', household_id: 'HOGAR' } : byMail(args.kevin)
const C = dry ? { user_id: 'CELESTE', household_id: 'HOGAR' } : byMail(args.celeste)
if (!K || !C) { console.error('No encontré a alguno de los dos. ¿Entraron ya a la app nueva y armaron el hogar?'); process.exit(1) }
if (K.household_id !== C.household_id) { console.error('Kevin y Celeste están en hogares distintos.'); process.exit(1) }
const hogar = K.household_id
const who = (w) => (w === 'C' ? C.user_id : K.user_id)

// El mismo id viejo → el mismo item_key en todos los meses (así se conserva la comparación mes a mes).
const keys = new Map()
const keyFor = (oldId) => { if (!keys.has(oldId)) keys.set(oldId, randomUUID()); return keys.get(oldId) }
const dateOf = (ms, month) => (ms ? new Date(ms).toISOString().slice(0, 10) : `${month}-15`)

const resumen = { meses: 0, lineas: 0, gastos: 0, pagos: 0, cobros: 0 }
const lineIds = new Map() // `${month}|${oldId}` → id nuevo

for (const [month, p] of Object.entries(plans).sort()) {
  const lines = [
    ...(p.incomes ?? []).map((x) => ({ kind: 'income', old: x.id, name: x.name, amount: x.amount, day: x.day, owner_user: who(x.who) })),
    ...(p.fixed ?? []).map((x) => ({ kind: 'fixed', old: x.id, name: x.name, amount: x.amount, day: x.day, owner_user: null })),
    ...(p.sobres ?? []).map((x) => ({ kind: 'envelope', old: x.id, name: x.name, amount: x.budget, day: null, owner_user: null })),
  ]
  resumen.meses++; resumen.lineas += lines.length
  if (dry) { lines.forEach((l) => lineIds.set(`${month}|${l.old}`, 'x')); continue }

  const { data: plan, error } = await db.from('month_plans').upsert({ household_id: hogar, month: `${month}-01`, created_by: K.user_id, updated_by: K.user_id }, { onConflict: 'household_id,month' }).select('id').single()
  if (error) throw error
  const rows = lines.map((l, i) => ({ plan_id: plan.id, household_id: hogar, kind: l.kind, item_key: keyFor(l.old), name: l.name.slice(0, 60), amount: l.amount || 0, day: l.day || null, owner_user: l.owner_user, sort: i }))
  const { data: ins, error: e2 } = await db.from('plan_lines').upsert(rows, { onConflict: 'plan_id,item_key' }).select('id, item_key')
  if (e2) throw e2
  for (const l of lines) lineIds.set(`${month}|${l.old}`, ins.find((r) => r.item_key === keyFor(l.old)).id)
}

async function insertAll(table, rows) {
  if (dry || !rows.length) return
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 200))
    if (error) throw error
  }
}

const gRows = [], pRows = [], cRows = [], skipped = []
for (const g of gastos) {
  const line = lineIds.get(`${g.month}|${g.sobreId}`)
  if (!line) { skipped.push(`gasto ${g.amount} (${g.month})`); continue }
  gRows.push({ household_id: hogar, line_id: line, amount: g.amount, spent_by: who(g.who), spent_on: g.date || `${g.month}-15`, note: g.note || null, source: 'import' })
}
for (const p of pagos) {
  const line = lineIds.get(`${p.month}|${p.fixedId}`)
  if (!line) { skipped.push(`pago ${p.amount} (${p.month})`); continue }
  pRows.push({ household_id: hogar, line_id: line, amount: p.amount, paid_by: who(p.who), paid_on: dateOf(p.at, p.month), note: p.note || null, source: 'import' })
}
for (const c of cobros) {
  const line = lineIds.get(`${c.month}|${c.incomeId}`)
  if (!line) { skipped.push(`cobro ${c.amount} (${c.month})`); continue }
  cRows.push({ household_id: hogar, line_id: line, amount: c.amount, received_by: who(c.who), received_on: dateOf(c.at, c.month), source: 'import' })
}
resumen.gastos = gRows.length; resumen.pagos = pRows.length; resumen.cobros = cRows.length
await insertAll('expenses', gRows.filter((r) => r.amount > 0))
await insertAll('payments', pRows.filter((r) => r.amount > 0))
await insertAll('income_receipts', cRows.filter((r) => r.amount > 0))

console.log(dry ? 'Prueba (no se escribió nada):' : 'Importado:', resumen)
if (skipped.length) console.log('Quedaron afuera porque su línea ya no está en el plan:', skipped)
