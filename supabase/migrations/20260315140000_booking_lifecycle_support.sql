create table booking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  booking_id uuid not null references bookings (id) on delete cascade,
  event_type text not null check (
    event_type in ('booking_created', 'booking_cancelled', 'booking_rescheduled')
  ),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table notification_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  booking_id uuid not null references bookings (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  event_type text not null check (
    event_type in ('booking_created', 'booking_cancelled', 'booking_rescheduled')
  ),
  status text not null default 'pending' check (status in ('pending')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index booking_events_booking_id_idx
  on booking_events (booking_id, occurred_at desc);

create index booking_events_organization_id_idx
  on booking_events (organization_id, occurred_at desc);

create index notification_jobs_status_idx
  on notification_jobs (status, created_at asc);

create index notification_jobs_booking_id_idx
  on notification_jobs (booking_id, created_at desc);
