-- Rack Planner: the two lists the app shares between people.
-- Run this once in the Supabase SQL editor of whichever project you point
-- config.js at. Everything is prefixed rack_ so it can sit beside the tables
-- of another system without getting in their way.

create table if not exists rack_racks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  length_cm   numeric not null check (length_cm > 0),
  width_cm    numeric not null check (width_cm > 0),
  height_cm   numeric not null check (height_cm > 0),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table rack_racks is
  'Shelf sizes people can pick from. The usable opening, not the outside of the frame.';

create table if not exists rack_box_presets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  length_cm   numeric not null check (length_cm > 0),
  width_cm    numeric not null check (width_cm > 0),
  height_cm   numeric not null check (height_cm > 0),
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table rack_box_presets is
  'Carton sizes worth keeping, so nobody retypes them.';

-- The rack everybody starts from.
insert into rack_racks (name, length_cm, width_cm, height_cm, is_default)
values ('Standard Rack', 240, 120, 85, true)
on conflict (name) do nothing;

-- Access. The app has no sign-in of its own, so it reaches these tables with
-- the publishable key as the anonymous role. That means anyone who can open
-- the page can add or remove a rack or a preset. These two lists hold nothing
-- but measurements, which is why that trade is acceptable here -- if the app
-- ever gains a login, replace `anon` below with `authenticated`.
alter table rack_racks enable row level security;
alter table rack_box_presets enable row level security;

drop policy if exists rack_racks_all on rack_racks;
create policy rack_racks_all on rack_racks
  for all to anon, authenticated using (true) with check (true);

drop policy if exists rack_box_presets_all on rack_box_presets;
create policy rack_box_presets_all on rack_box_presets
  for all to anon, authenticated using (true) with check (true);

-- Imported SKU sheets. The newest import is what the racks dashboard lays
-- out; where each SKU lands is worked out in the browser from these rows and
-- the import's rules, never stored, so changing a rule is instant and every
-- PC agrees.

create table if not exists rack_imports (
  id           uuid primary key default gen_random_uuid(),
  file_name    text not null,
  row_count    integer not null default 0,
  rules        jsonb not null default '{}'::jsonb,
  imported_at  timestamptz not null default now()
);

create table if not exists rack_skus (
  id              bigint generated always as identity primary key,
  import_id       uuid not null references rack_imports(id) on delete cascade,
  line_no         integer not null,
  tier            text,
  category        text,
  sku             text not null,
  sold_per_day    numeric,
  quantity        numeric,
  length_cm       numeric,
  width_cm        numeric,
  height_cm       numeric,
  needed_qty_15d  numeric,   -- no longer read or written: sold per day x days
  qty_per_box     numeric,
  total_boxes     numeric    -- no longer read or written: needed qty / qty per box
);

create index if not exists rack_skus_import_line on rack_skus (import_id, line_no);
create index if not exists rack_imports_newest on rack_imports (imported_at desc);

alter table rack_imports enable row level security;
alter table rack_skus enable row level security;

drop policy if exists rack_imports_all on rack_imports;
create policy rack_imports_all on rack_imports
  for all to anon, authenticated using (true) with check (true);

drop policy if exists rack_skus_all on rack_skus;
create policy rack_skus_all on rack_skus
  for all to anon, authenticated using (true) with check (true);

-- Which SKUs sit on which 4KB shelf, chosen by hand. One row per SKU on a
-- shelf; several SKUs may share one.
create table if not exists rack_shelves (
  import_id    uuid not null references rack_imports(id) on delete cascade,
  label        text not null,
  sku_id       bigint not null references rack_skus(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  primary key (import_id, label, sku_id)
);

create index if not exists rack_shelves_sku on rack_shelves (sku_id);

alter table rack_shelves enable row level security;

drop policy if exists rack_shelves_all on rack_shelves;
create policy rack_shelves_all on rack_shelves
  for all to anon, authenticated using (true) with check (true);
