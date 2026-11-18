-- Reporter 2 runs on GitHub Actions, but GitHub's own scheduler did not start
-- the workflow of the new repo (no scheduled run in three hours on 2026-11-18).
-- This job starts the workflow through the GitHub API instead, five minutes
-- after reporter 1. The token (fine-grained, Actions write on
-- wngstnr-code/clamp-reporter only) lives in Supabase Vault as
-- 'github_dispatch_token'; it is not in this file. GitHub answers 204.

select cron.schedule(
  'clamp-reporter-2',
  '5,20,35,50 * * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/wngstnr-code/clamp-reporter/actions/workflows/report.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'clamp-cron'
    ),
    timeout_milliseconds := 30000
  );
  $$
);
