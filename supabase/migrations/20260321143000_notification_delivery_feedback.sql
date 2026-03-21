alter table notification_job_attempts
  add column provider_key text,
  add column provider_message_id text,
  add column delivery_status text check (
    delivery_status in (
      'accepted',
      'delivered',
      'deferred',
      'bounced',
      'complained',
      'opened',
      'clicked',
      'failed',
      'unknown'
    )
  ),
  add column delivery_status_updated_at timestamptz,
  add column delivery_status_metadata jsonb not null default '{}'::jsonb;

create unique index notification_job_attempts_provider_message_idx
  on notification_job_attempts (provider_key, provider_message_id)
  where provider_key is not null and provider_message_id is not null;

update notification_job_attempts
set
  provider_key = coalesce(
    provider_key,
    nullif(outcome_payload #>> '{providerDelivery,provider}', '')
  ),
  provider_message_id = coalesce(
    provider_message_id,
    nullif(outcome_payload #>> '{providerDelivery,result,providerMessageId}', '')
  ),
  delivery_status = coalesce(
    delivery_status,
    case
      when nullif(outcome_payload #>> '{providerDelivery,result,providerMessageId}', '') is not null
        then 'accepted'
      else null
    end
  ),
  delivery_status_updated_at = coalesce(
    delivery_status_updated_at,
    case
      when nullif(outcome_payload #>> '{providerDelivery,result,providerMessageId}', '') is not null
        then finished_at
      else null
    end
  ),
  delivery_status_metadata = case
    when
      delivery_status_metadata = '{}'::jsonb
      and nullif(outcome_payload #>> '{providerDelivery,result,providerMessageId}', '') is not null
      then jsonb_build_object(
        'providerStatus',
        nullif(outcome_payload #>> '{providerDelivery,result,providerStatus}', ''),
        'providerEventId',
        null,
        'occurredAt',
        finished_at
      )
    else delivery_status_metadata
  end;

create table notification_delivery_feedback_events (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  provider_event_id text not null,
  provider_message_id text not null,
  provider_status text not null,
  normalized_status text not null check (
    normalized_status in (
      'accepted',
      'delivered',
      'deferred',
      'bounced',
      'complained',
      'opened',
      'clicked',
      'failed',
      'unknown'
    )
  ),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  organization_id uuid references organizations (id) on delete set null,
  notification_job_id uuid references notification_jobs (id) on delete set null,
  notification_job_attempt_id uuid references notification_job_attempts (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  unique (provider_key, provider_event_id)
);

create index notification_delivery_feedback_events_attempt_idx
  on notification_delivery_feedback_events (
    notification_job_attempt_id,
    occurred_at desc
  );

create index notification_delivery_feedback_events_provider_message_idx
  on notification_delivery_feedback_events (
    provider_key,
    provider_message_id,
    occurred_at desc
  );
