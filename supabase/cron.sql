-- Programa los avisos diarios a las 8:30 de Argentina (11:30 UTC).
-- Correr UNA vez en Supabase → SQL Editor, después de desplegar la función daily-reminders.
-- Reemplazá <PROJECT_REF> y <CRON_SECRET> (el mismo valor que cargaste como secreto CRON_SECRET).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'cron_secret');

select cron.schedule(
  'avisos-vencimientos',
  '30 11 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
