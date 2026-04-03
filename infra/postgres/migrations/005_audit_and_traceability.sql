alter table outbox_events
  add column if not exists request_id uuid;

update outbox_events
set request_id = (headers ->> 'request_id')::uuid
where request_id is null
  and headers ->> 'request_id' is not null
  and headers ->> 'request_id' <> '';

create index if not exists outbox_events_request_id_idx
  on outbox_events (tenant_id, request_id);

alter table agent_audit_logs
  add column if not exists source_event_id uuid,
  add column if not exists request_id uuid,
  add column if not exists service_name text,
  add column if not exists trace_path jsonb not null default '[]'::jsonb;

create unique index if not exists agent_audit_logs_source_event_udx
  on agent_audit_logs (source_event_id)
  where source_event_id is not null;

create index if not exists agent_audit_logs_request_idx
  on agent_audit_logs (tenant_id, request_id, created_at desc)
  where request_id is not null;
