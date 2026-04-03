create extension if not exists pgcrypto;

create or replace function set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  external_ref text not null,
  email text not null,
  full_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_ref)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null references customers (id),
  order_number text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  amount_cents integer not null check (amount_cents >= 0),
  currency char(3) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_number)
);

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid references customers (id),
  order_id uuid references orders (id),
  status text not null default 'active' check (status in ('active', 'completed', 'failed')),
  trace_id text not null,
  channel text not null check (channel in ('api', 'cli', 'worker')),
  context_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_session_id uuid references agent_sessions (id),
  event_type text not null,
  actor_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  trace_id text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists ingestion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source text not null,
  request_type text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  trace_id text not null,
  idempotency_key text,
  payload jsonb not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  scope text not null,
  idempotency_key text not null,
  request_hash text not null,
  resource_type text,
  resource_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, scope, idempotency_key)
);

create table if not exists outbox_events (
  event_id uuid primary key,
  tenant_id uuid not null,
  topic text not null check (topic in ('customer-events', 'order-events', 'agent-events', 'audit-events')),
  partition_key text not null,
  event_name text not null,
  event_version integer not null,
  trace_id text not null,
  actor_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  idempotency_key text,
  payload jsonb not null,
  headers jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  available_at timestamptz not null default now(),
  publish_status text not null default 'pending' check (publish_status in ('pending', 'processing', 'published', 'failed')),
  attempt_count integer not null default 0,
  last_error text,
  locked_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists ingestion_requests_tenant_idempotency_key_udx
  on ingestion_requests (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists customers_tenant_created_idx on customers (tenant_id, created_at desc);
create index if not exists customers_tenant_email_idx on customers (tenant_id, email);
create index if not exists orders_tenant_created_idx on orders (tenant_id, created_at desc);
create index if not exists orders_tenant_customer_idx on orders (tenant_id, customer_id);
create index if not exists agent_sessions_tenant_created_idx on agent_sessions (tenant_id, created_at desc);
create index if not exists agent_sessions_tenant_trace_idx on agent_sessions (tenant_id, trace_id);
create index if not exists agent_audit_logs_tenant_entity_idx on agent_audit_logs (tenant_id, entity_type, entity_id, created_at desc);
create index if not exists agent_audit_logs_tenant_session_idx on agent_audit_logs (tenant_id, agent_session_id, created_at desc);
create index if not exists ingestion_requests_tenant_created_idx on ingestion_requests (tenant_id, created_at desc);
create index if not exists idempotency_keys_tenant_lookup_idx on idempotency_keys (tenant_id, scope, idempotency_key);
create index if not exists idempotency_keys_expires_at_idx on idempotency_keys (expires_at);
create index if not exists outbox_events_entity_lookup_idx on outbox_events (tenant_id, entity_type, entity_id);
create index if not exists outbox_events_status_available_idx on outbox_events (publish_status, available_at, created_at)
  where publish_status in ('pending', 'failed');
create index if not exists outbox_events_tenant_created_idx on outbox_events (tenant_id, created_at desc);
create index if not exists outbox_events_idempotency_key_idx on outbox_events (tenant_id, idempotency_key)
  where idempotency_key is not null;

drop trigger if exists customers_set_updated_at on customers;
create trigger customers_set_updated_at
before update on customers
for each row execute function set_updated_at_timestamp();

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
before update on orders
for each row execute function set_updated_at_timestamp();

drop trigger if exists agent_sessions_set_updated_at on agent_sessions;
create trigger agent_sessions_set_updated_at
before update on agent_sessions
for each row execute function set_updated_at_timestamp();

drop trigger if exists ingestion_requests_set_updated_at on ingestion_requests;
create trigger ingestion_requests_set_updated_at
before update on ingestion_requests
for each row execute function set_updated_at_timestamp();
