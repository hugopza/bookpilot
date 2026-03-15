alter table notification_jobs
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column max_attempts integer not null default 3 check (max_attempts > 0),
  add column next_attempt_at timestamptz not null default now(),
  add column processing_token text,
  add column processing_started_at timestamptz,
  add column last_error_code text,
  add column last_error_message text,
  add column updated_at timestamptz not null default now(),
  drop constraint notification_jobs_status_check,
  add constraint notification_jobs_status_check check (
    status in ('pending', 'processing', 'succeeded', 'failed')
  );

create table notification_job_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_job_id uuid not null references notification_jobs (id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  processing_token text not null,
  status text not null check (status in ('processing', 'succeeded', 'failed')),
  outcome_code text,
  outcome_message text,
  outcome_payload jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (notification_job_id, attempt_number),
  unique (processing_token)
);

drop index if exists notification_jobs_status_idx;
create index notification_jobs_claim_idx
  on notification_jobs (status, next_attempt_at asc, created_at asc);

create index notification_jobs_processing_idx
  on notification_jobs (status, processing_started_at asc)
  where status = 'processing';

create index notification_job_attempts_job_id_idx
  on notification_job_attempts (notification_job_id, attempt_number desc);
