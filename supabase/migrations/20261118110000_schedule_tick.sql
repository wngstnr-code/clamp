-- Every 15 minutes, call the backend tick (docs/architecture.md section 5).
-- The cron secret is not in this file: it lives in Supabase Vault under the
-- name 'clamp_cron_secret' and is created once by the user (build-and-deploy.md).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'clamp-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://clamp-backend.vercel.app/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'clamp_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
