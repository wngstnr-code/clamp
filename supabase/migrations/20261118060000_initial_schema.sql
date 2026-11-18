-- Clamp initial schema (docs/architecture.md section 5.1).
-- Everyone can read. Only the service role (the backend worker) can write.
-- Units follow docs/product-spec.md section 5: prices in micro-USD per GPU-hour,
-- fractions in ppm, timestamps from chain unix seconds stored as timestamptz.

-- What each reporter saw from each source at each tick.
create table public.source_ticks (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null,
  class_id    smallint    not null check (class_id >= 0),
  source_id   smallint    not null check (source_id >= 0),
  reporter    text        not null,                        -- reporter public key (base58)
  price_micro bigint      check (price_micro > 0),
  capacity    integer     check (capacity >= 0),
  ok          boolean     not null,
  error       text,
  raw_path    text,                                         -- path in the storage bucket "raw"
  raw_sha256  text        check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  signature   text,                                         -- submit_report transaction
  created_at  timestamptz not null default now(),
  constraint source_ticks_ok_has_price check (not ok or price_micro is not null),
  constraint source_ticks_failed_has_error check (ok or error is not null),
  constraint source_ticks_unique unique (reporter, class_id, source_id, ts)
);
create index source_ticks_class_ts on public.source_ticks (class_id, ts desc);

-- Every accepted on-chain index update, read from the transaction events.
create table public.index_updates (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null,
  class_id        smallint    not null check (class_id >= 0),
  price_micro     bigint      not null check (price_micro > 0),
  candidate_micro bigint      not null check (candidate_micro > 0),
  reporter_count  smallint    not null check (reporter_count > 0),
  sources         jsonb       not null,                     -- [{ "id", "price", "weight" }]
  signature       text        not null,
  slot            bigint      not null check (slot >= 0),
  created_at      timestamptz not null default now(),
  constraint index_updates_unique unique (signature, class_id)
);
create index index_updates_class_ts on public.index_updates (class_id, ts desc);

-- Mirror of the on-chain series accounts, for lists in the web app.
create table public.series (
  address          text        primary key,
  class_id         smallint    not null check (class_id >= 0),
  kind             smallint    not null check (kind >= 0),
  start_ts         timestamptz not null,
  close_ts         timestamptz not null,
  expiry_ts        timestamptz not null,
  center           bigint      not null check (center > 0),
  lower            bigint      not null check (lower > 0),
  upper            bigint      not null,
  settled          boolean     not null default false,
  avg              bigint      check (avg > 0),
  up_value         integer     check (up_value between 0 and 1000000),
  coverage_ppm     integer     check (coverage_ppm between 0 and 1000000),
  settle_signature text,
  updated_at       timestamptz not null default now(),
  constraint series_band check (lower < upper),
  constraint series_times check (start_ts < close_ts and close_ts <= expiry_ts),
  constraint series_settled_values check (
    not settled or (avg is not null and up_value is not null and coverage_ppm is not null)
  )
);
create index series_class_expiry on public.series (class_id, expiry_ts desc);

-- Worker log: one row per tick step or crank action.
create table public.crank_runs (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  action     text        not null,
  ok         boolean     not null,
  detail     text,
  signature  text
);
create index crank_runs_ts on public.crank_runs (ts desc);

-- Access: public read, writes only through the service role (which bypasses RLS).
alter table public.source_ticks  enable row level security;
alter table public.index_updates enable row level security;
alter table public.series        enable row level security;
alter table public.crank_runs    enable row level security;

create policy "public read" on public.source_ticks  for select to anon, authenticated using (true);
create policy "public read" on public.index_updates for select to anon, authenticated using (true);
create policy "public read" on public.series        for select to anon, authenticated using (true);
create policy "public read" on public.crank_runs    for select to anon, authenticated using (true);

-- New tables are not exposed automatically on this project, so grant explicitly.
revoke all on public.source_ticks, public.index_updates, public.series, public.crank_runs
  from anon, authenticated;
grant select on public.source_ticks, public.index_updates, public.series, public.crank_runs
  to anon, authenticated;
grant all on public.source_ticks, public.index_updates, public.series, public.crank_runs
  to service_role;

-- Raw API responses, stored as the exact bytes that were hashed.
-- Public read through public URLs. Uploads only with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('raw', 'raw', true, 5242880, array['application/json'])
on conflict (id) do nothing;
