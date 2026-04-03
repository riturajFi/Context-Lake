create table if not exists customer_context_view (
  tenant_id uuid not null,
  customer_id uuid not null,
  external_ref text not null,
  email text not null,
  full_name text not null,
  status text not null,
  customer_metadata jsonb not null default '{}'::jsonb,
  source_event_id uuid not null,
  source_event_version integer not null,
  source_occurred_at timestamptz not null,
  projection_updated_at timestamptz not null default now(),
  primary key (tenant_id, customer_id)
);

create table if not exists order_context_view (
  tenant_id uuid not null,
  order_id uuid not null,
  customer_id uuid not null,
  order_number text not null,
  status text not null,
  amount_cents integer not null,
  currency char(3) not null,
  order_metadata jsonb not null default '{}'::jsonb,
  source_event_id uuid not null,
  source_event_version integer not null,
  source_occurred_at timestamptz not null,
  projection_updated_at timestamptz not null default now(),
  primary key (tenant_id, order_id)
);

create table if not exists agent_session_context_view (
  tenant_id uuid not null,
  agent_session_id uuid not null,
  customer_id uuid,
  order_id uuid,
  status text,
  channel text,
  last_context_request_id uuid,
  last_context_query_text text,
  last_context_scope jsonb not null default '[]'::jsonb,
  last_response_id uuid,
  last_response_model text,
  last_response_token_count integer,
  session_summary jsonb not null default '{}'::jsonb,
  source_event_id uuid not null,
  source_event_version integer not null,
  source_occurred_at timestamptz not null,
  projection_updated_at timestamptz not null default now(),
  primary key (tenant_id, agent_session_id)
);

create table if not exists projection_event_applications (
  consumer_name text not null,
  topic text not null,
  partition integer not null,
  kafka_offset bigint not null,
  event_id uuid not null,
  event_type text not null,
  tenant_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  processed_at timestamptz not null default now(),
  primary key (consumer_name, event_id)
);

create table if not exists projection_dead_letters (
  id uuid primary key default gen_random_uuid(),
  consumer_name text not null,
  topic text not null,
  partition integer not null,
  kafka_offset bigint not null,
  event_id uuid,
  event_type text,
  tenant_id uuid,
  trace_id text,
  failure_reason text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_context_view_tenant_status_idx
  on customer_context_view (tenant_id, status, projection_updated_at desc);
create index if not exists order_context_view_tenant_status_idx
  on order_context_view (tenant_id, status, projection_updated_at desc);
create index if not exists order_context_view_tenant_customer_idx
  on order_context_view (tenant_id, customer_id, projection_updated_at desc);
create index if not exists agent_session_context_view_tenant_customer_idx
  on agent_session_context_view (tenant_id, customer_id, projection_updated_at desc);
create index if not exists agent_session_context_view_tenant_order_idx
  on agent_session_context_view (tenant_id, order_id, projection_updated_at desc);
create index if not exists projection_event_applications_lookup_idx
  on projection_event_applications (consumer_name, topic, partition, kafka_offset desc);
create index if not exists projection_dead_letters_consumer_idx
  on projection_dead_letters (consumer_name, created_at desc);
