-- Bitácora: el motivo también se toma de las columnas donde ciertos registros
-- guardan su motivo obligatorio: solicitudes de corrección (motivo de la
-- solicitud o de la revisión), justificaciones de incidencias (nota) y
-- cancelación de guardias. Antes esos eventos quedaban «sin motivo registrado».
-- Misma función que en 20261017000200, solo con esa fuente adicional.

create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changed text[];
  v_reason text;
  v_facility uuid;
  v_record text;
  v_role text;
begin
  -- Durante una depuración autorizada por la política de conservación no se
  -- copian datos personales a la bitácora (se registra un resumen aparte).
  if coalesce(current_setting('app.allow_purge', true), '') = 'on' then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key)
      and n.key not in ('updated_at', 'updated_by', 'change_reason');
    if v_changed is null then
      return null;
    end if;
  end if;

  v_reason := coalesce(
    nullif(current_setting('app.change_reason', true), ''),
    nullif(v_new ->> 'change_reason', ''),
    nullif(v_new ->> 'status_reason', ''),
    -- Registros cuyo motivo obligatorio vive en una columna propia.
    case tg_table_name
      when 'correction_requests' then coalesce(nullif(v_new ->> 'review_notes', ''), nullif(v_new ->> 'reason', ''))
      when 'incident_notes' then nullif(v_new ->> 'note', '')
      when 'shifts' then nullif(v_new ->> 'cancel_reason', '')
    end,
    case when tg_op = 'DELETE' then nullif(v_old ->> 'change_reason', '') end
  );

  v_facility := case tg_table_name
    when 'facilities' then (v_row ->> 'id')::uuid
    when 'workers' then (v_row ->> 'facility_id')::uuid
    when 'shifts' then (v_row ->> 'facility_id')::uuid
    when 'attendance_sessions' then (v_row ->> 'facility_id')::uuid
    when 'correction_requests' then (v_row ->> 'facility_id')::uuid
    when 'incident_notes' then (v_row ->> 'facility_id')::uuid
    when 'user_facility_scopes' then (v_row ->> 'facility_id')::uuid
    when 'shift_assignments' then (select s.facility_id from public.shifts s where s.id = (v_row ->> 'shift_id')::uuid)
    when 'worker_private' then (select w.facility_id from public.workers w where w.id = (v_row ->> 'worker_id')::uuid)
    when 'profiles' then (select w.facility_id from public.workers w where w.id = (v_row ->> 'worker_id')::uuid)
    else null
  end;

  v_record := coalesce(
    v_row ->> 'id',
    v_row ->> 'worker_id',
    v_row ->> 'key',
    (v_row ->> 'user_id') || ':' || (v_row ->> 'facility_id')
  );

  select p.role::text into v_role from public.profiles p where p.id = auth.uid();

  insert into public.audit_log
    (actor_id, actor_role, table_name, record_id, action, old_data, new_data, changed_fields, reason, facility_id)
  values
    (auth.uid(), coalesce(v_role, current_user::text), tg_table_name, v_record, tg_op, v_old, v_new, v_changed, v_reason, v_facility);

  return null;
end;
$$;
