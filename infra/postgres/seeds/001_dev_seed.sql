insert into customers (
  id,
  tenant_id,
  external_ref,
  email,
  full_name,
  status,
  metadata
) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cust-dev-001',
  'ada@example.com',
  'Ada Lovelace',
  'active',
  '{"tier":"sandbox"}'::jsonb
)
on conflict (tenant_id, external_ref) do nothing;

insert into orders (
  id,
  tenant_id,
  customer_id,
  order_number,
  status,
  amount_cents,
  currency,
  metadata
) values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'ORD-DEV-001',
  'confirmed',
  1299,
  'USD',
  '{"channel":"seed"}'::jsonb
)
on conflict (tenant_id, order_number) do nothing;

insert into agent_sessions (
  id,
  tenant_id,
  customer_id,
  order_id,
  status,
  trace_id,
  channel,
  context_summary
) values (
  '33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'active',
  'trace-seed-001',
  'api',
  '{"mode":"local-dev"}'::jsonb
)
on conflict (id) do nothing;

insert into ingestion_requests (
  id,
  tenant_id,
  source,
  request_type,
  status,
  trace_id,
  idempotency_key,
  payload
) values (
  '44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'seed-script',
  'customer-bootstrap',
  'completed',
  'trace-seed-001',
  'seed-ingestion-001',
  '{"records":1}'::jsonb
)
on conflict do nothing;

insert into idempotency_keys (
  id,
  tenant_id,
  scope,
  idempotency_key,
  request_hash,
  resource_type,
  resource_id
) values (
  '55555555-5555-4555-8555-555555555555',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ingestion_request',
  'seed-ingestion-001',
  'seed-hash-001',
  'ingestion_request',
  '44444444-4444-4444-8444-444444444444'
)
on conflict (tenant_id, scope, idempotency_key) do nothing;

insert into agent_audit_logs (
  id,
  tenant_id,
  agent_session_id,
  event_type,
  actor_id,
  entity_type,
  entity_id,
  trace_id,
  payload,
  occurred_at
) values (
  '66666666-6666-4666-8666-666666666666',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333',
  'audit.recorded',
  null,
  'agent_session',
  '33333333-3333-4333-8333-333333333333',
  'trace-seed-001',
  '{"message":"seeded audit record","severity":"info"}'::jsonb,
  now()
)
on conflict (id) do nothing;

insert into outbox_events (
  event_id,
  tenant_id,
  topic,
  partition_key,
  event_name,
  event_version,
  trace_id,
  actor_id,
  entity_type,
  entity_id,
  idempotency_key,
  payload,
  headers,
  occurred_at,
  available_at,
  publish_status
) values (
  '77777777-7777-4777-8777-777777777777',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'customer-events',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111',
  'customer.created',
  1,
  'trace-seed-001',
  null,
  'customer',
  '11111111-1111-4111-8111-111111111111',
  'seed-ingestion-001',
  '{"customer_id":"11111111-1111-4111-8111-111111111111","external_ref":"cust-dev-001","email":"ada@example.com","full_name":"Ada Lovelace","status":"active"}'::jsonb,
  '{"seed":true}'::jsonb,
  now(),
  now(),
  'pending'
)
on conflict (event_id) do nothing;
