-- The crank may wait up to 2 minutes for a series that expires right after the
-- tick (backend/src/crank-plan.ts, expiryWait), so the tick call gets 280 s.
-- The Vercel function limit is 300 s. Same job name, so this replaces it.

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
    timeout_milliseconds := 280000
  );
  $$
);
