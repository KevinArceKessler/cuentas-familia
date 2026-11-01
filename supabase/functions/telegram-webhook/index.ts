// Bot de Telegram: vincula la cuenta (/start <código>), carga gastos y pagos ("super 8500"),
// muestra pendientes y resumen, y deshace la última carga.
import { admin, esc, json, money, telegram, todayIn, toLine, type Line } from '../_shared/util.ts'
import { matchLines, parseMessage } from '../_shared/parse.ts'

const HELP = [
  'Escribime qué gastaste y cuánto, así:',
  '• <i>super 8500</i>',
  '• <i>nafta 12.000 ypf ruta</i> (lo que va después del monto queda como nota)',
  '• <i>luz 130 mil</i> (si es un gasto fijo, queda como pagado)',
  '',
  '/pendientes — lo que falta pagar este mes',
  '/resumen — cómo vienen el mes',
  '/deshacer — borra lo último que cargaste por acá',
].join('\n')

Deno.serve(async (req) => {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== Deno.env.get('TELEGRAM_WEBHOOK_SECRET')) return json({ error: 'no autorizado' }, 401)
  const update = await req.json().catch(() => null)
  if (!update) return json({ ok: true })
  const db = admin()

  try {
    if (update.callback_query) await onCallback(db, update.callback_query)
    else if (update.message?.text) await onMessage(db, update.message)
  } catch (e) {
    console.error(e)
    const chat = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id
    if (chat) await telegram('sendMessage', { chat_id: chat, text: 'Uy, algo falló de mi lado. Probá de nuevo en un rato o cargalo desde la app.' })
  }
  return json({ ok: true })
})

type DB = ReturnType<typeof admin>
const reply = (chat_id: number, text: string, extra: Record<string, unknown> = {}) => telegram('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra })

async function linkedUser(db: DB, chatId: number) {
  const { data } = await db.from('telegram_links').select('user_id, household_id').eq('chat_id', chatId).maybeSingle()
  return data as { user_id: string; household_id: string } | null
}

async function monthLines(db: DB, householdId: string): Promise<Line[]> {
  const { data: h } = await db.from('households').select('timezone').eq('id', householdId).single()
  const month = `${todayIn(h?.timezone).slice(0, 7)}-01`
  const { data } = await db.from('month_lines').select('*').eq('household_id', householdId).eq('month', month).order('sort')
  return (data ?? []).map(toLine)
}

async function onMessage(db: DB, msg: { chat: { id: number }; text: string }) {
  const chat = msg.chat.id, text = msg.text.trim()

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1]
    if (!code) {
      const u = await linkedUser(db, chat)
      return reply(chat, u ? `Ya estás conectado.\n\n${HELP}` : 'Hola. Para conectarme con tu cuenta, entrá a la app → Ajustes → Telegram → Conectar.')
    }
    const { data: c } = await db.from('telegram_link_codes').select('*').eq('code', code).maybeSingle()
    if (!c || new Date(c.expires_at) < new Date()) return reply(chat, 'Ese código venció. Generá uno nuevo desde la app: Ajustes → Telegram → Conectar.')
    await db.from('telegram_links').delete().eq('chat_id', chat)
    await db.from('telegram_links').upsert({ user_id: c.user_id, household_id: c.household_id, chat_id: chat })
    await db.from('telegram_link_codes').delete().eq('code', code)
    const { data: m } = await db.from('household_members').select('display_name').eq('user_id', c.user_id).single()
    return reply(chat, `¡Listo, ${esc(m?.display_name ?? '')}! Quedamos conectados. Te voy a avisar los vencimientos por acá.\n\n${HELP}`)
  }

  const u = await linkedUser(db, chat)
  if (!u) return reply(chat, 'Todavía no estamos conectados. Entrá a la app → Ajustes → Telegram → Conectar.')

  if (text === '/ayuda' || text === '/help') return reply(chat, HELP)

  if (text === '/pendientes') {
    const lines = (await monthLines(db, u.household_id)).filter((l) => l.kind === 'fixed' && l.paid < l.amount).sort((a, b) => (a.day ?? 99) - (b.day ?? 99))
    if (!lines.length) return reply(chat, 'No queda nada por pagar este mes. 🎉')
    return reply(chat, '<b>Falta pagar</b>\n' + lines.map((l) => `• ${esc(l.name)}: ${money(l.amount - l.paid)}${l.day ? ` (vence el ${l.day})` : ''}`).join('\n'))
  }

  if (text === '/resumen') {
    const lines = await monthLines(db, u.household_id)
    if (!lines.length) return reply(chat, 'Todavía no planificaron este mes. Se arma desde la app, en Plan.')
    const cobrado = lines.filter((l) => l.kind === 'income').reduce((a, l) => a + l.received, 0)
    const pagado = lines.filter((l) => l.kind === 'fixed').reduce((a, l) => a + l.paid, 0)
    const gastado = lines.filter((l) => l.kind === 'envelope').reduce((a, l) => a + l.spent, 0)
    const over = lines.filter((l) => l.kind === 'envelope' && l.amount > 0 && l.spent > l.amount)
    return reply(chat, `<b>Disponible hoy:</b> ${money(cobrado - pagado - gastado)}\nCobrado ${money(cobrado)} · pagado ${money(pagado)} · gastado ${money(gastado)}` +
      (over.length ? `\n\nSobres pasados: ${over.map((l) => `${esc(l.name)} (+${money(l.spent - l.amount)})`).join(', ')}` : ''))
  }

  if (text === '/deshacer') {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const [{ data: e }, { data: p }] = await Promise.all([
      db.from('expenses').select('id, amount, created_at, line_id').eq('spent_by', u.user_id).eq('source', 'telegram').gte('created_at', since).order('created_at', { ascending: false }).limit(1),
      db.from('payments').select('id, amount, created_at, line_id').eq('paid_by', u.user_id).eq('source', 'telegram').gte('created_at', since).order('created_at', { ascending: false }).limit(1),
    ])
    const last = [...(e ?? []).map((x) => ({ ...x, t: 'expenses' })), ...(p ?? []).map((x) => ({ ...x, t: 'payments' }))].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    if (!last) return reply(chat, 'No encontré nada cargado por acá en las últimas 24 horas.')
    await db.from(last.t).delete().eq('id', last.id)
    const { data: l } = await db.from('plan_lines').select('name').eq('id', last.line_id).single()
    return reply(chat, `Borrado: ${esc(l?.name ?? '')} ${money(Number(last.amount))}.`)
  }

  if (text.startsWith('/')) return reply(chat, HELP)

  const parsed = parseMessage(text)
  if (!parsed) return reply(chat, `No entendí el monto. ${HELP}`)
  const lines = (await monthLines(db, u.household_id)).filter((l) => l.kind !== 'income')
  if (!lines.length) return reply(chat, 'Todavía no planificaron este mes. Se arma desde la app, en Plan.')
  const found = matchLines(parsed.query, lines)
  if (found.length === 1) return reply(chat, await save(db, u, found[0], parsed.amount, parsed.note))
  const options = (found.length ? found : lines).slice(0, 8)
  return reply(chat, found.length ? `¿En cuál va ${money(parsed.amount)}?` : `No encontré "${esc(parsed.query)}" en el plan. ¿En cuál va ${money(parsed.amount)}?`, {
    reply_markup: { inline_keyboard: options.map((l) => [{ text: `${l.name}${l.kind === 'fixed' ? ' (fijo)' : ''}`, callback_data: `p|${l.id}|${parsed.amount}` }]) },
  })
}

async function onCallback(db: DB, cq: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } }) {
  const chat = cq.message?.chat.id
  const [tag, lineId, amount] = (cq.data ?? '').split('|')
  if (!chat || tag !== 'p') return telegram('answerCallbackQuery', { callback_query_id: cq.id })
  const u = await linkedUser(db, chat)
  if (!u) return telegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'No estamos conectados.' })
  const { data: row } = await db.from('month_lines').select('*').eq('id', lineId).eq('household_id', u.household_id).maybeSingle()
  if (!row) return telegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'Esa opción ya no existe.' })
  const text = await save(db, u, toLine(row), Number(amount), '')
  await telegram('answerCallbackQuery', { callback_query_id: cq.id })
  return telegram('editMessageText', { chat_id: chat, message_id: cq.message!.message_id, text, parse_mode: 'HTML' })
}

async function save(db: DB, u: { user_id: string; household_id: string }, l: Line, amount: number, note: string): Promise<string> {
  const base = { household_id: u.household_id, line_id: l.id, amount, note: note || null, source: 'telegram' }
  if (l.kind === 'fixed') {
    const { error } = await db.from('payments').insert({ ...base, paid_by: u.user_id })
    if (error) throw error
    const total = l.paid + amount
    return `✅ Pago de <b>${esc(l.name)}</b>: ${money(amount)}` + (total >= l.amount ? ' · queda pagado' : ` · faltan ${money(l.amount - total)}`)
  }
  const { error } = await db.from('expenses').insert({ ...base, spent_by: u.user_id })
  if (error) throw error
  const left = l.amount - (l.spent + amount)
  return `✅ <b>${esc(l.name)}</b>: ${money(amount)}` + (l.amount > 0 ? (left >= 0 ? ` · quedan ${money(left)} de ${money(l.amount)}` : ` · ⚠️ se pasó ${money(-left)} del sobre`) : '') + (note ? `\n<i>${esc(note)}</i>` : '') + '\n\n/deshacer si fue un error'
}
