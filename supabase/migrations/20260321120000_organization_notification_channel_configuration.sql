alter table notification_jobs
  add column delivery_channel text not null default 'email',
  add constraint notification_jobs_delivery_channel_check check (
    delivery_channel in ('whatsapp', 'sms', 'email', 'push', 'voice')
  );

create table organization_notification_channel_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'sms', 'email', 'push', 'voice')),
  enabled boolean not null default false,
  notification_provider_key text,
  provider_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel),
  check (
    enabled = false
    or (
      notification_provider_key is not null
      and char_length(trim(notification_provider_key)) > 0
    )
  )
);

create index organization_notification_channel_configurations_org_id_idx
  on organization_notification_channel_configurations (organization_id, channel);
