-- =============================================================================
-- Integridad de datos y bitácora de auditoría
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuración: lectura de valores numéricos con valor por omisión
-- -----------------------------------------------------------------------------
create or replace function app.setting_int(p_key text, p_field text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value ->> p_field)::integer from public.app_settings s where s.key = p_key),
    p_default
  )
$$;

-- -----------------------------------------------------------------------------
-- Marcas de tiempo y motivo de cambio
-- -----------------------------------------------------------------------------
create or replace function app.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_has_reason boolean;
begin
  new.updated_at := now();
  -- Si el motivo no cambió en esta actualización, no se arrastra el anterior.
  v_has_reason := to_jsonb(new) ? 'change_reason';
  if v_has_reason and tg_op = 'UPDATE' then
    if (to_jsonb(new) ->> 'change_reason') is not distinct from (to_jsonb(old) ->> 'change_reason') then
      new := jsonb_populate_record(new, jsonb_build_object('change_reason', null));
    end if;
  end if;
  if to_jsonb(new) ? 'updated_by' and auth.uid() is not null then
    new := jsonb_populate_record(new, jsonb_build_object('updated_by', auth.uid()));
  end if;
  return new;
end;
$$;

create trigger facility_categories_touch before update on public.facility_categories
  for each row execute function app.touch_row();
create trigger facilities_touch before update on public.facilities
  for each row execute function app.touch_row();
create trigger workers_touch before update on public.workers
  for each row execute function app.touch_row();
create trigger worker_private_touch before update on public.worker_private
  for each row execute function app.touch_row();
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_row();
create trigger shifts_touch before update on public.shifts
  for each row execute function app.touch_row();
create trigger shift_assignments_touch before update on public.shift_assignments
  for each row execute function app.touch_row();
create trigger incident_notes_touch before update on public.incident_notes
  for each row execute function app.touch_row();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function app.touch_row();

-- -----------------------------------------------------------------------------
-- Zona horaria válida
-- -----------------------------------------------------------------------------
create or replace function app.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tz text := to_jsonb(new) ->> coalesce(tg_argv[0], 'timezone');
begin
  if v_tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'Zona horaria no válida: %', v_tz using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger facilities_timezone before insert or update of timezone on public.facilities
  for each row execute function app.validate_timezone('timezone');
create trigger states_timezone before insert or update of default_timezone on public.states
  for each row execute function app.validate_timezone('default_timezone');
create trigger municipalities_timezone before insert or update of timezone on public.municipalities
  for each row execute function app.validate_timezone('timezone');

-- -----------------------------------------------------------------------------
-- Asignaciones: cupo máximo y trabajador activo
-- -----------------------------------------------------------------------------
create or replace function app.check_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_count integer;
  v_active boolean;
begin
  if tg_op = 'INSERT' or new.worker_id <> old.worker_id then
    select w.active into v_active from public.workers w where w.id = new.worker_id;
    if not coalesce(v_active, false) then
      raise exception 'El trabajador está inactivo y no puede asignarse' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.shift_id <> old.shift_id then
    raise exception 'Una asignación no puede moverse a otra guardia; crea una nueva' using errcode = '22023';
  end if;

  if new.status = 'asignado' and (tg_op = 'INSERT' or old.status <> 'asignado') then
    select s.max_staff into v_max from public.shifts s where s.id = new.shift_id for update;
    if v_max is not null then
      select count(*) into v_count
      from public.shift_assignments a
      where a.shift_id = new.shift_id and a.status = 'asignado' and a.id <> new.id;
      if v_count + 1 > v_max then
        raise exception 'La guardia alcanzó su cupo máximo (%)', v_max using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger shift_assignments_check before insert or update on public.shift_assignments
  for each row execute function app.check_assignment();

-- -----------------------------------------------------------------------------
-- Asistencia: coherencia, inmutabilidad y protección contra borrado
-- -----------------------------------------------------------------------------
create or replace function app.attendance_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker uuid;
  v_shift uuid;
  v_facility uuid;
begin
  select a.worker_id, a.shift_id, s.facility_id
    into v_worker, v_shift, v_facility
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  where a.id = new.assignment_id;

  if v_worker is null then
    raise exception 'Asignación inexistente' using errcode = '23503';
  end if;
  -- Los campos derivados siempre se toman de la asignación.
  new.worker_id := v_worker;
  new.shift_id := v_shift;
  new.facility_id := v_facility;
  new.created_at := now();
  return new;
end;
$$;

create trigger attendance_before_insert before insert on public.attendance_sessions
  for each row execute function app.attendance_before_insert();

create or replace function app.attendance_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.record_status <> 'vigente' then
    raise exception 'Un registro corregido o anulado no se modifica' using errcode = '42501';
  end if;

  if new.id <> old.id
     or new.assignment_id <> old.assignment_id
     or new.shift_id <> old.shift_id
     or new.worker_id <> old.worker_id
     or new.facility_id <> old.facility_id
     or new.check_in_at <> old.check_in_at
     or new.check_in_method <> old.check_in_method
     or new.check_in_by <> old.check_in_by
     or new.check_in_reason is distinct from old.check_in_reason
     or new.check_in_request_id <> old.check_in_request_id
     or new.supersedes_id is distinct from old.supersedes_id
     or new.created_at <> old.created_at then
    raise exception 'La entrada original no se modifica; registra una corrección' using errcode = '42501';
  end if;

  if new.record_status <> old.record_status then
    -- Cambio de estado (corrección/anulación): solo campos de estado.
    if new.check_out_at is distinct from old.check_out_at
       or new.check_out_method is distinct from old.check_out_method
       or new.check_out_by is distinct from old.check_out_by
       or new.check_out_request_id is distinct from old.check_out_request_id
       or new.check_out_reason is distinct from old.check_out_reason then
      raise exception 'Una corrección no modifica el registro original' using errcode = '42501';
    end if;
    if new.status_changed_at is null then
      new.status_changed_at := now();
    end if;
    return new;
  end if;

  if old.check_out_at is not null and (
       new.check_out_at is distinct from old.check_out_at
       or new.check_out_method is distinct from old.check_out_method
       or new.check_out_by is distinct from old.check_out_by
       or new.check_out_request_id is distinct from old.check_out_request_id
       or new.check_out_reason is distinct from old.check_out_reason) then
    raise exception 'La salida ya fue registrada; registra una corrección' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger attendance_guard_update before update on public.attendance_sessions
  for each row execute function app.attendance_guard_update();

create or replace function app.block_delete_unless_purge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_purge', true), '') <> 'on' then
    raise exception 'Los registros de % no se eliminan; usa anulación o corrección', tg_table_name
      using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger attendance_block_delete before delete on public.attendance_sessions
  for each row execute function app.block_delete_unless_purge();

-- -----------------------------------------------------------------------------
-- Cuentas: no dejar el sistema sin administrador activo
-- -----------------------------------------------------------------------------
create or replace function app.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'admin' and p.active and p.id <> old.id
    ) then
      raise exception 'Debe existir al menos un administrador activo' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_admin before update or delete on public.profiles
  for each row execute function app.protect_last_admin();

-- Crea el perfil al registrar un usuario en Auth. El rol solo puede venir de
-- app_metadata (que únicamente la llave de servicio puede escribir).
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := 'trabajador';
  v_worker uuid;
begin
  begin
    v_role := coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'trabajador');
  exception when invalid_text_representation then
    v_role := 'trabajador';
  end;
  begin
    v_worker := (new.raw_app_meta_data ->> 'worker_id')::uuid;
  exception when invalid_text_representation then
    v_worker := null;
  end;
  if v_worker is not null and not exists (select 1 from public.workers w where w.id = v_worker) then
    v_worker := null;
  end if;

  insert into public.profiles (id, role, display_name, worker_id)
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    v_worker
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- -----------------------------------------------------------------------------
-- Bitácora
-- -----------------------------------------------------------------------------
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

do $$
declare
  t text;
begin
  foreach t in array array[
    'facility_categories', 'facilities', 'workers', 'worker_private', 'profiles',
    'user_facility_scopes', 'shifts', 'shift_assignments', 'attendance_sessions',
    'correction_requests', 'incident_notes', 'app_settings'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- La bitácora no se modifica ni se borra (salvo depuración por conservación).
create or replace function app.audit_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'La bitácora no se modifica' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.allow_purge', true), '') <> 'on' then
    raise exception 'La bitácora no se elimina' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger audit_log_guard before update or delete on public.audit_log
  for each row execute function app.audit_log_guard();

create or replace function app.block_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'TRUNCATE no está permitido en %', tg_table_name using errcode = '42501';
end;
$$;

create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.block_truncate();
create trigger attendance_no_truncate before truncate on public.attendance_sessions
  for each statement execute function app.block_truncate();
