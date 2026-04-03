alter table ingestion_requests
  add column if not exists resource_type text,
  add column if not exists resource_id uuid;

create index if not exists ingestion_requests_tenant_resource_idx
  on ingestion_requests (tenant_id, resource_type, resource_id);
