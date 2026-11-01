# Cuentas de la familia

App para llevar las cuentas de la casa entre dos: **plan del mes** (ingresos, gastos fijos con vencimiento y sobres estimados), **carga rápida** de gastos y pagos, **cierre** pensado vs. real, **avisos por mail** y un **bot de Telegram** para cargar escribiendo `super 8500`.

**Stack:** Vite + React 19 + TypeScript + Tailwind v4 (PWA instalable) · Supabase (Postgres con RLS, login con Google, Realtime, Edge Functions, pg_cron) · Resend (mails) · Telegram Bot API · Vercel.

## Cómo está armado

```
src/
  lib/          cliente de Supabase, formato de pesos/fechas, hooks de datos en vivo
  components/   barra superior, navegación, campo de pesos
  pages/        Login, Onboarding (crear/sumarse al hogar), Mes, Plan, Cargar, Cierre, Ajustes
supabase/
  migrations/   esquema, permisos (RLS) y funciones
  functions/    daily-reminders (avisos diarios) · telegram-webhook (bot)
  cron.sql      programa los avisos todos los días a las 8:30
scripts/
  importar-desde-claude.mjs   pasa los datos de la versión en Claude a Supabase
```

**Modelo de datos.** Un `household` (hogar) con sus `household_members`. Cada mes tiene un `month_plan` con `plan_lines` de tres tipos: `income`, `fixed` y `envelope`. Sobre esas líneas se cargan `income_receipts` (cobros), `payments` (pagos, se permiten parciales) y `expenses` (gastos de un sobre). `item_key` mantiene la identidad de una línea entre meses: así "Luz" de octubre y "Luz" de noviembre se comparan. La vista `month_lines` trae cada línea con lo pagado, cobrado y gastado.

**Permisos.** Todas las tablas tienen RLS: solo los miembros del hogar leen y escriben sus datos. Crear el hogar, invitar, sumarse y guardar el plan pasan por funciones (`create_household`, `create_invite`, `join_household`, `save_month_plan`). No se puede quitar del plan una línea que ya tiene movimientos.

## Puesta en marcha

Las claves secretas **nunca** van al repo ni al front. Solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` son públicas.

### 1. Supabase
1. Crear el proyecto en [supabase.com](https://supabase.com) (región São Paulo).
2. **SQL Editor** → pegar y correr `supabase/migrations/20261101000000_init.sql`.
   (O con la CLI: `supabase link --project-ref <ref>` y `supabase db push`.)
3. **Project Settings → API**: copiar la *Project URL* y la *anon public key*.

### 2. Login con Google
1. En [Google Cloud Console](https://console.cloud.google.com) → APIs y servicios → Credenciales → **Crear ID de cliente OAuth** (aplicación web).
2. *URI de redirección autorizado*: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`.
3. En Supabase → **Authentication → Providers → Google**: activar y pegar el Client ID y el Secret.
4. En Supabase → **Authentication → URL Configuration**: *Site URL* = la URL de Vercel (y agregar `http://localhost:5173` en *Redirect URLs* para desarrollo).

### 3. Correr en la compu
```bash
cp .env.example .env.local   # completar URL y anon key
npm install
npm run dev
```

### 4. Deploy en Vercel
1. Importar el repo en Vercel (framework: Vite).
2. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT`.
3. Cada push a `main` despliega solo.

### 5. Avisos por mail (Resend)
1. En Resend: verificar un dominio (por ejemplo `vortia.com.ar`) y crear una API key.
2. Secretos de las funciones (Supabase → **Edge Functions → Secrets**, o con la CLI):
   ```bash
   supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="Cuentas <avisos@vortia.com.ar>" \
     APP_URL=https://<tu-app>.vercel.app CRON_SECRET=<un texto largo al azar>
   ```
3. Desplegar: `supabase functions deploy daily-reminders`.
4. Programar: abrir `supabase/cron.sql`, reemplazar `<PROJECT_REF>` y `<CRON_SECRET>`, y correrlo en el SQL Editor.

### 6. Bot de Telegram
1. Con @BotFather: `/newbot` → guardar el **token** y el **usuario** del bot.
2. Secretos:
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<otro texto largo al azar>
   supabase functions deploy telegram-webhook
   ```
3. Conectar el webhook (una vez):
   ```bash
   curl "https://api.telegram.org/bot<token>/setWebhook" \
     -d url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
4. Poner `VITE_TELEGRAM_BOT=<usuario_del_bot>` en Vercel. Cada uno conecta su Telegram desde **Ajustes → Telegram → Conectar**.

**Qué entiende el bot:** `super 8500`, `nafta 12.000 ypf ruta` (lo de después del monto es nota), `carni 8,5k`, `luz 130 mil` (si es fijo, lo marca pagado). Si el nombre coincide con varias líneas, ofrece botones para elegir. Comandos: `/pendientes`, `/resumen`, `/deshacer`.

### 7. Pasar los datos de la versión en Claude
1. En la app de Claude: **Ajustes → Descargar mis datos**.
2. En la app nueva: entran los dos con Google; uno crea el hogar y el otro se suma con el código de **Ajustes → Invitar**.
3. Probar y después importar:
   ```bash
   node scripts/importar-desde-claude.mjs --archivo cuentas-familia-AAAA-MM-DD.json --kevin <mail> --celeste <mail> --probar
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/importar-desde-claude.mjs --archivo ... --kevin <mail> --celeste <mail>
   ```

## Avisos: cuándo llegan
Una vez por día, por cada gasto fijo del mes sin pagar del todo: **3 días antes o menos** ("vence pronto"), **el día del vencimiento** y **el día después** si sigue sin pagar. Cada aviso se manda una sola vez. Si la plata disponible no alcanza para lo que vence, el aviso lo dice y menciona el próximo cobro pendiente.
