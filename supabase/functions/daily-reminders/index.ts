// Corre una vez por día (pg_cron). Avisa por mail y Telegram los gastos fijos que vencen pronto,
// vencen hoy o quedaron vencidos sin pagar. Cada aviso se manda una sola vez (reminder_log).
import { admin, esc, json, MONTHS, money, telegram, todayIn, toLine, type Line } from '../_shared/util.ts'

type Kind = 'pre' | 'due' | 'overdue'
const LABEL: Record<Kind, string> = { pre: 'Vence pronto', due: 'Vence hoy', overdue: 'Venció y sigue sin pagar' }

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'no autorizado' }, 401)
  const db = admin()
  const { data: households, error } = await db.from('households').select('id, name, timezone')
  if (error) return json({ error: error.message }, 500)

  const report: Record<string, number> = {}
  for (const h of households ?? []) {
    const today = todayIn(h.timezone)
    const month = `${today.slice(0, 7)}-01`, day = Number(today.slice(8, 10))
    const { data: rows } = await db.from('month_lines').select('*').eq('household_id', h.id).eq('month', month)
    const lines = (rows ?? []).map(toLine)
    if (!lines.length) continue

    // Qué toca avisar hoy
    const due: { line: Line; kind: Kind; left: number }[] = []
    for (const l of lines) {
      if (l.kind !== 'fixed' || !l.day || l.paid >= l.amount) continue
      const left = l.day - day
      const kind: Kind | null = left >= 1 && left <= 3 ? 'pre' : left === 0 ? 'due' : left < 0 && left >= -7 ? 'overdue' : null
      if (kind) due.push({ line: l, kind, left })
    }
    if (!due.length) continue
    const { data: sent } = await db.from('reminder_log').select('line_id, kind').in('line_id', due.map((x) => x.line.id))
    const already = new Set((sent ?? []).map((s) => `${s.line_id}:${s.kind}`))
    const items = due.filter((x) => !already.has(`${x.line.id}:${x.kind}`)).sort((a, b) => a.left - b.left)
    if (!items.length) continue

    const cobrado = lines.filter((l) => l.kind === 'income').reduce((a, l) => a + l.received, 0)
    const salio = lines.reduce((a, l) => a + (l.kind === 'fixed' ? l.paid : l.kind === 'envelope' ? l.spent : 0), 0)
    const disponible = cobrado - salio
    const pendientes = items.reduce((a, x) => a + (x.line.amount - x.line.paid), 0)
    const pendingIncome = lines.filter((l) => l.kind === 'income' && l.received <= 0 && l.day && l.day > day).sort((a, b) => (a.day ?? 0) - (b.day ?? 0))[0]

    const when = (x: (typeof items)[number]) => x.kind === 'pre' ? `vence el ${x.line.day} (en ${x.left} ${x.left === 1 ? 'día' : 'días'})` : x.kind === 'due' ? 'vence hoy' : `venció el ${x.line.day}`
    const short = (x: (typeof items)[number]) => `${x.line.name}: ${money(x.line.amount - x.line.paid)}, ${when(x)}`
    const warnCash = disponible < pendientes
      ? `Ojo: hoy tienen ${money(disponible)} disponibles y esto suma ${money(pendientes)}.${pendingIncome ? ` Falta cobrar ${pendingIncome.name} (día ${pendingIncome.day}).` : ''}`
      : ''
    const appUrl = Deno.env.get('APP_URL') ?? ''

    // Mail
    const { data: members } = await db.from('household_members').select('email, display_name, notify_email').eq('household_id', h.id)
    const to = (members ?? []).filter((m) => m.notify_email && m.email).map((m) => m.email as string)
    const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('MAIL_FROM')
    if (to.length && key && from) {
      const subject = items.length === 1 ? `${items[0].line.name}: ${when(items[0])}` : `${items.length} pagos para tener en cuenta`
      const rowsHtml = items.map((x) => `<tr><td style="padding:10px 0;border-bottom:1px solid #E6EAE7"><b>${esc(x.line.name)}</b><br><span style="color:${x.kind === 'pre' ? '#56615B' : '#B45309'};font-size:13px">${LABEL[x.kind]} · ${when(x)}</span></td><td style="padding:10px 0;border-bottom:1px solid #E6EAE7;text-align:right;font-weight:700">${money(x.line.amount - x.line.paid)}</td></tr>`).join('')
      const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#17201C">
        <p style="color:#56615B;font-size:13px;margin:0">Cuentas de la familia · ${MONTHS[Number(today.slice(5, 7)) - 1]}</p>
        <h1 style="font-size:22px;margin:4px 0 16px">${esc(subject)}</h1>
        <table style="width:100%;border-collapse:collapse;font-size:15px">${rowsHtml}</table>
        ${warnCash ? `<p style="background:#FBEBD9;color:#7E3905;padding:12px 14px;border-radius:12px;font-size:14px">${esc(warnCash)}</p>` : ''}
        ${appUrl ? `<p><a href="${appUrl}" style="display:inline-block;background:#1E6B4E;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700">Abrir la app</a></p>` : ''}
        <p style="color:#56615B;font-size:12px">Te llega porque tenés activados los avisos por mail. Se apagan en Ajustes.</p></div>`
      const text = items.map(short).join('\n') + (warnCash ? `\n\n${warnCash}` : '') + (appUrl ? `\n\n${appUrl}` : '')
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html, text }),
      })
      if (!r.ok) console.error('resend', r.status, await r.text())
    }

    // Telegram
    const { data: chats } = await db.from('telegram_links').select('chat_id').eq('household_id', h.id)
    const msg = `🔔 <b>Para pagar</b>\n` + items.map((x) => `• ${esc(short(x))}`).join('\n') + (warnCash ? `\n\n${esc(warnCash)}` : '') + `\n\nCuando pagues, escribime por ejemplo: <i>${esc(items[0].line.name.toLowerCase())} ${items[0].line.amount - items[0].line.paid}</i>`
    for (const c of chats ?? []) await telegram('sendMessage', { chat_id: c.chat_id, text: msg, parse_mode: 'HTML' })

    await db.from('reminder_log').upsert(items.map((x) => ({ line_id: x.line.id, kind: x.kind })))
    report[h.id] = items.length
  }
  return json({ ok: true, avisos: report })
})
