create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  time_zone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table staff_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_member_id uuid references staff_members (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

create table time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_member_id uuid references staff_members (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id uuid not null references services (id) on delete restrict,
  customer_id uuid not null references customers (id) on delete restrict,
  staff_member_id uuid not null references staff_members (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  channel_origin text not null default 'api' check (channel_origin in ('api', 'web', 'whatsapp', 'voice', 'dashboard')),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create unique index customers_unique_phone_per_org
  on customers (organization_id, phone)
  where phone is not null;

create unique index customers_unique_email_per_org
  on customers (organization_id, lower(email))
  where email is not null;

create index services_organization_id_idx on services (organization_id);
create index staff_members_organization_id_idx on staff_members (organization_id);
create index customers_organization_id_idx on customers (organization_id);
create index availability_rules_lookup_idx
  on availability_rules (organization_id, day_of_week, staff_member_id)
  where is_active = true;
create index time_off_lookup_idx
  on time_off (organization_id, starts_at, ends_at, staff_member_id);
create index bookings_lookup_idx
  on bookings (organization_id, staff_member_id, starts_at, ends_at)
  where status <> 'cancelled';

alter table bookings
  add constraint bookings_no_staff_overlap
  exclude using gist (
    organization_id with =,
    staff_member_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status <> 'cancelled');
