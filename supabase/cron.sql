-- =====================================================================
-- Rappels à l'heure, même appli fermée
-- À lancer dans Supabase > SQL Editor APRÈS avoir déployé la fonction "reminders".
-- Remplace TON-PROJET et TA-CLE-SERVICE-ROLE (Project Settings > API).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Supprime l'ancienne tâche si tu relances le script
select cron.unschedule('nous-deux-rappels')
where exists (select 1 from cron.job where jobname = 'nous-deux-rappels');

select cron.schedule(
  'nous-deux-rappels',
  '* * * * *',  -- chaque minute
  $$
  select net.http_post(
    url     := 'https://TON-PROJET.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer TA-CLE-SERVICE-ROLE'
    ),
    body    := '{}'::jsonb
  );
  $$
);
