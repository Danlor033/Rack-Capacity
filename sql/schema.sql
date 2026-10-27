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
