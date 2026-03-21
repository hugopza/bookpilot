create table internal_api_token_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in ('token_issued', 'token_rotated', 'token_revoked')
  ),
  actor_token_id uuid not null,
  actor_role text not null check (
    actor_role in ('platform_admin', 'organization_operator')
  ),
  actor_organization_id uuid,
  target_token_id uuid not null,
  target_role text not null check (
    target_role in ('platform_admin', 'organization_operator')
  ),
  target_organization_id uuid,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index internal_api_token_audit_events_occurred_at_idx
  on internal_api_token_audit_events (occurred_at desc, id desc);

create index internal_api_token_audit_events_target_scope_idx
  on internal_api_token_audit_events (target_organization_id, occurred_at desc);

create index internal_api_token_audit_events_target_token_idx
  on internal_api_token_audit_events (target_token_id, occurred_at desc);

create function internal_api_token_audit_events_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'internal_api_token_audit_events are immutable';
end;
$$;

create trigger internal_api_token_audit_events_no_update
before update on internal_api_token_audit_events
for each row execute function internal_api_token_audit_events_block_mutation();

create trigger internal_api_token_audit_events_no_delete
before delete on internal_api_token_audit_events
for each row execute function internal_api_token_audit_events_block_mutation();
