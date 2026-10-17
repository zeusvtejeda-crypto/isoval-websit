-- =============================================================================
-- Bitácora de los catálogos geográficos (editables en Administración →
-- Catálogos geográficos). Solo administración ve estos eventos (facility_id nulo).
-- =============================================================================
create trigger states_audit after insert or update or delete on public.states
  for each row execute function app.audit_row();
create trigger municipalities_audit after insert or update or delete on public.municipalities
  for each row execute function app.audit_row();
