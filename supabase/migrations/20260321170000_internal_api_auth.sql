create table internal_api_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  role text not null check (role in ('platform_admin', 'organization_operator')),
  organization_id uuid references organizations (id) on delete cascade,
  description text,
  active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (role = 'platform_admin' and organization_id is null)
    or (role = 'organization_operator' and organization_id is not null)
  )
);

create index internal_api_tokens_active_lookup_idx
  on internal_api_tokens (token_hash)
  where active = true;

create index internal_api_tokens_organization_role_idx
  on internal_api_tokens (organization_id, role)
  where organization_id is not null;
