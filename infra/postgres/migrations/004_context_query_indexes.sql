create index if not exists agent_audit_logs_tenant_entity_occurred_idx
  on agent_audit_logs (tenant_id, entity_type, entity_id, occurred_at desc, created_at desc);

create index if not exists agent_audit_logs_tenant_session_occurred_idx
  on agent_audit_logs (tenant_id, agent_session_id, occurred_at desc, created_at desc);
