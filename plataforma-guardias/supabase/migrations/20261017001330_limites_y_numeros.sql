-- =============================================================================
-- Límites de texto y números de trabajador
-- 1. Longitud máxima en todos los textos libres que escribe una cuenta: antes
--    solo había mínimos y una llamada directa a las RPC podía guardar textos
--    enormes (que además se copian a la bitácora y hacen lentas las
--    exportaciones). Restricciones CHECK con máximos generosos (iguales o
--    mayores que los de los formularios) y comprobación temprana en las RPC
--    que reciben texto libre, con mensaje en español.
-- 2. Números de trabajador: authenticated ya no escribe
--    worker_private.employee_number directamente (el índice único revelaba si
--    un número existe en otra sede sin consumir la cuota diaria). Se escribe
--    con set_employee_number(), create_worker() y create_workers(), que cobran
--    la cuota y la conservan aunque el número ya esté registrado.
-- 3. profiles.change_reason deja de ser legible para las cuentas autenticadas
--    (mismo patrón que 20261017001290): solo lo conserva la bitácora.
-- 4. Solicitudes de corrección: una sola solicitud pendiente de registro nuevo
--    por asignación.
-- 5. Responsable de la guardia: trabajador activo de la misma sede, también
--    para escrituras directas (app.can_see_worker lo usa para dar visibilidad).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Límites de longitud
-- -----------------------------------------------------------------------------
create or replace function app.assert_max_length(p_value text, p_max integer, p_label text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is not null and char_length(p_value) > p_max then
    raise exception '% admite como máximo % caracteres.', p_label, p_max using errcode = '22001';
  end if;
end;
$$;
comment on function app.assert_max_length(text, integer, text) is
  'Rechaza (22001, mensaje en español) un texto libre más largo que el máximo. Las RPC la llaman antes de cualquier otra validación.';
revoke all on function app.assert_max_length(text, integer, text) from public, anon;
grant execute on function app.assert_max_length(text, integer, text) to authenticated, service_role;

-- Lista de textos (servicios de una instalación): cantidad y longitud de cada elemento.
create or replace function app.text_array_fits(p_values text[], p_max_items integer, p_max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_values), 0) <= p_max_items
    and not exists (select 1 from unnest(p_values) as v where char_length(v) > p_max_length)
$$;
revoke all on function app.text_array_fits(text[], integer, integer) from public, anon;
grant execute on function app.text_array_fits(text[], integer, integer) to authenticated, service_role;

-- Máximos por columna. Donde el formulario ya tiene un límite (zod) se usa el
-- mismo o uno mayor, nunca menor. Las columnas que ya tenían un máximo
-- (workers.full_name, facilities.official_name y unit_key, shifts.meeting_point,
-- facility_categories.name, worker_private.employee_number) no se repiten.
create temporary table limites_texto (tabla text not null, columna text not null, maximo integer not null);
insert into limites_texto (tabla, columna, maximo) values
  -- Asistencia. Cada llamada admite hasta 1000 caracteres por nota o motivo,
  -- pero las columnas guardan textos compuestos: la salida agrega su nota a la
  -- de la entrada (1000 + salto de línea + 1000) y aprobar una corrección
  -- compone «Solicitud de corrección aprobada: <motivo> / Revisión: <nota>»
  -- (34 + 1000 + 13 + 1000).
  ('attendance_sessions', 'notes', 2500),
  ('attendance_sessions', 'check_in_reason', 2500),
  ('attendance_sessions', 'check_out_reason', 2500),
  ('attendance_sessions', 'status_reason', 2500),
  -- Correcciones (formulario: motivo 500, nota de revisión 1000).
  ('correction_requests', 'reason', 1000),
  ('correction_requests', 'review_notes', 1000),
  -- Justificaciones (formulario: 1000).
  ('incident_notes', 'note', 1000),
  -- Asignaciones (formulario: punto 200, notas 500). status_reason también
  -- recibe el texto compuesto al revertir una ausencia (≈ 102 + 1000 + 13 + 1000).
  ('shift_assignments', 'assigned_point', 200),
  ('shift_assignments', 'notes', 1000),
  ('shift_assignments', 'status_reason', 2500),
  ('shift_assignments', 'change_reason', 1000),
  -- Guardias (formulario: título 200, instrucciones 2000, motivos 500).
  ('shifts', 'title', 200),
  ('shifts', 'instructions', 2000),
  ('shifts', 'cancel_reason', 1000),
  ('shifts', 'change_reason', 1000),
  -- Trabajadores (formulario: área y puesto 120).
  ('workers', 'area', 120),
  ('workers', 'position', 120),
  ('workers', 'usual_shift', 120),
  ('workers', 'internal_code', 40),
  ('workers', 'change_reason', 1000),
  ('worker_private', 'change_reason', 1000),
  -- Instalaciones (mismos máximos que src/lib/validation/facility.ts).
  ('facilities', 'description', 2000),
  ('facilities', 'address', 500),
  ('facilities', 'phone', 100),
  ('facilities', 'schedule', 500),
  ('facilities', 'source', 300),
  ('facilities', 'source_url', 1000),
  ('facilities', 'notes', 2000),
  ('facilities', 'internal_code', 40),
  ('facilities', 'change_reason', 1000),
  -- Categorías (formulario: identificador 60, descripción 500).
  ('facility_categories', 'slug', 60),
  ('facility_categories', 'description', 500),
  ('facility_categories', 'icon', 60),
  ('facility_categories', 'change_reason', 1000),
  -- Catálogos (formulario: nombre de municipio 150).
  ('states', 'name', 150),
  ('states', 'abbreviation', 10),
  ('states', 'change_reason', 1000),
  ('municipalities', 'name', 150),
  ('municipalities', 'change_reason', 1000),
  -- Cuentas: el formulario admite 120, pero app.handle_new_user usa la parte
  -- local del correo cuando no hay nombre (correo de hasta 254 caracteres).
  ('profiles', 'display_name', 254),
  ('profiles', 'change_reason', 1000),
  ('user_facility_scopes', 'change_reason', 1000),
  -- Configuración.
  ('app_settings', 'key', 64),
  ('app_settings', 'description', 500),
  ('app_settings', 'change_reason', 1000);

do $$
declare
  r record;
  v_count bigint;
  v_problems text := '';
begin
  -- Primero se comprueba que ningún registro existente exceda su límite.
  for r in select * from limites_texto order by tabla, columna loop
    execute format('select count(*) from public.%I where char_length(%I) > %s', r.tabla, r.columna, r.maximo) into v_count;
    if v_count > 0 then
      v_problems := v_problems || format(E'\n- %s.%s: %s registro(s) con más de %s caracteres', r.tabla, r.columna, v_count, r.maximo);
    end if;
  end loop;
  if (select count(*) from public.app_settings where char_length(value::text) > 50000) > 0 then
    v_problems := v_problems || E'\n- app_settings.value: valor con más de 50000 caracteres';
  end if;
  if (select count(*) from public.facilities where not app.text_array_fits(services, 60, 200)) > 0 then
    v_problems := v_problems || E'\n- facilities.services: más de 60 servicios o alguno con más de 200 caracteres';
  end if;
  if v_problems <> '' then
    raise exception 'Hay textos más largos que los nuevos límites; recórtalos antes de aplicar esta migración:%', v_problems
      using errcode = '23514';
  end if;

  for r in select * from limites_texto order by tabla, columna loop
    execute format('alter table public.%I add constraint %I check (char_length(%I) <= %s)',
      r.tabla, r.tabla || '_' || r.columna || '_max_len', r.columna, r.maximo);
  end loop;
end;
$$;

drop table limites_texto;

-- Aviso de privacidad: el cuerpo admite 20 000 caracteres (formulario); el JSON
-- con escapes y los demás campos caben en 50 000.
alter table public.app_settings
  add constraint app_settings_value_max_len check (char_length(value::text) <= 50000);
-- Servicios de la instalación (formulario: 60 servicios de hasta 200 caracteres).
alter table public.facilities
  add constraint facilities_services_max_len check (app.text_array_fits(services, 60, 200));

-- -----------------------------------------------------------------------------
-- 4. Una sola solicitud pendiente de registro nuevo por asignación
--    (los registros existentes ya tenían una por sesión).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.correction_requests
    where status = 'pendiente' and session_id is null
    group by assignment_id
    having count(*) > 1
  ) then
    raise exception 'Hay asignaciones con más de una solicitud pendiente de registro nuevo: revisa o rechaza las repetidas antes de aplicar esta migración'
      using errcode = '23505';
  end if;
end;
$$;

create unique index correction_requests_one_pending_new_per_assignment
  on public.correction_requests (assignment_id)
  where status = 'pendiente' and session_id is null;

-- -----------------------------------------------------------------------------
-- 5. Responsable de la guardia: trabajador activo de la sede (misma regla que
--    saveShift). Se revisa al fijarlo o cambiarlo y al cambiar la sede; un
--    responsable que después se desactiva no bloquea otras ediciones.
-- -----------------------------------------------------------------------------
create or replace function app.check_shift_responsible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.responsible_worker_id is not null
     and (tg_op = 'INSERT'
          or new.responsible_worker_id is distinct from old.responsible_worker_id
          or new.facility_id is distinct from old.facility_id) then
    if not exists (
      select 1 from public.workers w
      where w.id = new.responsible_worker_id and w.active and w.facility_id = new.facility_id
    ) then
      raise exception 'El responsable debe ser un trabajador activo de la sede.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.check_shift_responsible() from public, anon, authenticated;

create trigger shifts_responsible_check
  before insert or update of responsible_worker_id, facility_id on public.shifts
  for each row execute function app.check_shift_responsible();

-- -----------------------------------------------------------------------------
-- 1 (cont.). RPC con texto libre: rechazo temprano de textos demasiado largos.
-- Definiciones vigentes (pg_get_functiondef) con las líneas
-- `perform app.assert_max_length(...)` al inicio; request_correction además
-- distingue la solicitud pendiente de registro nuevo.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_in(p_assignment_id uuid, p_request_id uuid, p_notes text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_existing public.attendance_sessions;
  v_session public.attendance_sessions;
  v_is_self boolean;
  v_is_manager boolean;
  v_worker_active boolean;
  v_window interval;
begin
  perform app.assert_max_length(p_notes, 1000, 'La nota');
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  v_profile := app.require_profile();
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;

  select * into v_assignment from public.shift_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;

  v_is_self := v_profile.worker_id is not null and v_profile.worker_id = v_assignment.worker_id;
  v_is_manager := app.can_manage(v_shift.facility_id);
  if not (v_is_self or v_is_manager) then
    raise exception 'No tienes permiso para registrar esta asistencia' using errcode = '42501';
  end if;

  select * into v_existing from public.attendance_sessions where check_in_request_id = p_request_id;
  if found then
    if v_existing.assignment_id <> p_assignment_id then
      raise exception 'El identificador de solicitud ya se usó para otra asignación' using errcode = '22023';
    end if;
    return app.session_result('duplicate', v_existing);
  end if;

  if not v_is_self and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indica el motivo para registrar en nombre de otra persona' using errcode = '22023';
  end if;
  if v_shift.status = 'cancelada' then
    raise exception 'La guardia está cancelada' using errcode = '22023';
  end if;
  if v_assignment.status <> 'asignado' then
    raise exception 'La asignación no está activa (estado: %)', v_assignment.status using errcode = '22023';
  end if;
  select w.active into v_worker_active from public.workers w where w.id = v_assignment.worker_id;
  if not coalesce(v_worker_active, false) then
    raise exception 'El trabajador está inactivo' using errcode = '22023';
  end if;

  v_window := make_interval(mins => app.setting_int('attendance', 'checkin_window_before_minutes', 120));
  if now() < v_shift.starts_at - v_window then
    raise exception 'Todavía no abre el registro de esta guardia' using errcode = '22023';
  end if;
  if now() >= v_shift.ends_at then
    raise exception 'La guardia ya terminó. Solicita una corrección a coordinación.' using errcode = '22023';
  end if;

  select * into v_existing
  from public.attendance_sessions
  where worker_id = v_assignment.worker_id and check_out_at is null and record_status = 'vigente'
  limit 1;
  if found then
    return app.session_result(
      case when v_existing.assignment_id = p_assignment_id then 'already_open' else 'open_elsewhere' end,
      -- Solo se devuelve la sesión si quien consulta puede verla.
      case
        when v_is_self or v_existing.assignment_id = p_assignment_id or app.has_scope(v_existing.facility_id)
          then v_existing
        else null::public.attendance_sessions
      end
    );
  end if;

  perform set_config('app.change_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);

  insert into public.attendance_sessions (
    assignment_id, shift_id, worker_id, facility_id,
    check_in_at, check_in_method, check_in_by, check_in_reason, check_in_request_id, notes
  ) values (
    v_assignment.id, v_shift.id, v_assignment.worker_id, v_shift.facility_id,
    now(),
    case
      when not v_is_self then 'coordinador'::public.attendance_method
      when coalesce(current_setting('app.attendance_method', true), '') = 'qr' then 'qr'::public.attendance_method
      else 'propio'::public.attendance_method
    end,
    v_profile.id,
    case when v_is_self then nullif(btrim(p_reason), '') else btrim(p_reason) end,
    p_request_id,
    nullif(btrim(p_notes), '')
  )
  returning * into v_session;

  return app.session_result('created', v_session);
exception
  when unique_violation or exclusion_violation then
    select * into v_existing from public.attendance_sessions where check_in_request_id = p_request_id;
    if found and v_existing.assignment_id = p_assignment_id then
      return app.session_result('duplicate', v_existing);
    end if;
    raise exception 'Ya existe una entrada abierta o traslapada para esta persona' using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_out(p_assignment_id uuid, p_request_id uuid, p_notes text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_existing public.attendance_sessions;
  v_open public.attendance_sessions;
  v_session public.attendance_sessions;
  v_is_self boolean;
  v_is_manager boolean;
  v_grace interval;
begin
  perform app.assert_max_length(p_notes, 1000, 'La nota');
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  v_profile := app.require_profile();
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;

  select * into v_assignment from public.shift_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;

  v_is_self := v_profile.worker_id is not null and v_profile.worker_id = v_assignment.worker_id;
  v_is_manager := app.can_manage(v_shift.facility_id);
  if not (v_is_self or v_is_manager) then
    raise exception 'No tienes permiso para registrar esta asistencia' using errcode = '42501';
  end if;

  select * into v_existing from public.attendance_sessions where check_out_request_id = p_request_id;
  if found then
    if v_existing.assignment_id <> p_assignment_id then
      raise exception 'El identificador de solicitud ya se usó para otra asignación' using errcode = '22023';
    end if;
    return app.session_result('duplicate', v_existing);
  end if;

  if not v_is_self and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indica el motivo para registrar en nombre de otra persona' using errcode = '22023';
  end if;

  select * into v_open
  from public.attendance_sessions
  where assignment_id = p_assignment_id and check_out_at is null and record_status = 'vigente'
  for update;
  if not found then
    return app.session_result('no_open_session', null::public.attendance_sessions);
  end if;

  -- Fuera del margen nadie registra la salida con la hora actual: se inventaría.
  v_grace := make_interval(mins => app.setting_int('attendance', 'open_session_grace_minutes', 240));
  if now() > v_shift.ends_at + v_grace then
    raise exception 'Esta entrada quedó sin salida y requiere revisión. Usa «Corregir registro» con la hora real o solicita una corrección.'
      using errcode = '22023';
  end if;

  if now() <= v_open.check_in_at then
    raise exception 'La salida no puede ser anterior o igual a la entrada' using errcode = '22023';
  end if;

  perform set_config('app.change_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);

  update public.attendance_sessions
  set check_out_at = now(),
      check_out_method = case
        when not v_is_self then 'coordinador'::public.attendance_method
        when coalesce(current_setting('app.attendance_method', true), '') = 'qr' then 'qr'::public.attendance_method
        else 'propio'::public.attendance_method
      end,
      check_out_by = v_profile.id,
      check_out_reason = case when v_is_self then nullif(btrim(p_reason), '') else btrim(p_reason) end,
      check_out_request_id = p_request_id,
      notes = case
        when nullif(btrim(p_notes), '') is null then notes
        when notes is null then btrim(p_notes)
        else notes || E'\n' || btrim(p_notes)
      end
  where id = v_open.id
  returning * into v_session;

  return app.session_result('created', v_session);
exception
  when unique_violation then
    select * into v_existing from public.attendance_sessions where check_out_request_id = p_request_id;
    if found and v_existing.assignment_id = p_assignment_id then
      return app.session_result('duplicate', v_existing);
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_in_qr(p_token text, p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.attendance_sessions;
  v_token_id uuid;
  v_shift uuid;
  v_result jsonb;
begin
  perform app.assert_max_length(p_notes, 1000, 'La nota');
  perform app.require_profile();
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;
  select * into v_existing from public.attendance_sessions
  where check_in_request_id = p_request_id and worker_id = app.my_worker_id();
  if found then
    return app.session_result('duplicate', v_existing);
  end if;

  v_token_id := app.valid_qr_token_id(p_token);
  select shift_id into v_shift from public.attendance_qr_tokens where id = v_token_id;
  perform set_config('app.attendance_method', 'qr', true);
  perform set_config('app.qr_token_id', v_token_id::text, true);
  v_result := public.check_in(app.my_assignment_in_shift(v_shift), p_request_id, p_notes, null);
  perform set_config('app.attendance_method', '', true);
  perform set_config('app.qr_token_id', '', true);
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_out_qr(p_token text, p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.attendance_sessions;
  v_token_id uuid;
  v_shift uuid;
  v_result jsonb;
begin
  perform app.assert_max_length(p_notes, 1000, 'La nota');
  perform app.require_profile();
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;
  select * into v_existing from public.attendance_sessions
  where check_out_request_id = p_request_id and worker_id = app.my_worker_id();
  if found then
    return app.session_result('duplicate', v_existing);
  end if;

  v_token_id := app.valid_qr_token_id(p_token);
  select shift_id into v_shift from public.attendance_qr_tokens where id = v_token_id;
  perform set_config('app.attendance_method', 'qr', true);
  perform set_config('app.qr_token_id', v_token_id::text, true);
  v_result := public.check_out(app.my_assignment_in_shift(v_shift), p_request_id, p_notes, null);
  perform set_config('app.attendance_method', '', true);
  perform set_config('app.qr_token_id', '', true);
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_manual_attendance(p_assignment_id uuid, p_check_in_at timestamp with time zone, p_check_out_at timestamp with time zone, p_reason text, p_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_existing public.attendance_sessions;
  v_new public.attendance_sessions;
begin
  -- Hasta 2500: review_correction compone el motivo de la solicitud con la nota de revisión.
  perform app.assert_max_length(p_reason, 2500, 'El motivo');
  perform app.assert_max_length(p_notes, 1000, 'La nota');
  v_profile := app.require_profile();
  select * into v_assignment from public.shift_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;
  if not app.can_manage(v_shift.facility_id) then
    raise exception 'No tienes permiso para registrar asistencia en esta sede' using errcode = '42501';
  end if;
  perform app.assert_not_own_record(v_assignment.worker_id);
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;
  select * into v_existing from public.attendance_sessions where check_in_request_id = p_request_id;
  if found then
    if v_existing.assignment_id <> p_assignment_id then
      raise exception 'El identificador de solicitud ya se usó para otra asignación' using errcode = '22023';
    end if;
    return app.session_result('duplicate', v_existing);
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'El motivo es obligatorio (mínimo 5 caracteres)' using errcode = '22023';
  end if;
  if v_shift.status = 'cancelada' then
    raise exception 'La guardia está cancelada' using errcode = '22023';
  end if;
  if v_assignment.status <> 'asignado' then
    raise exception 'La asignación no está activa (estado: %)', v_assignment.status using errcode = '22023';
  end if;
  if p_check_in_at is null or p_check_out_at is null then
    raise exception 'El registro manual requiere hora de entrada y de salida' using errcode = '22023';
  end if;
  if p_check_out_at <= p_check_in_at then
    raise exception 'La salida no puede ser anterior o igual a la entrada' using errcode = '22023';
  end if;
  if p_check_out_at > now() then
    raise exception 'No se pueden registrar horas futuras' using errcode = '22023';
  end if;
  perform app.assert_within_shift(v_shift, p_check_in_at, p_check_out_at);

  perform set_config('app.change_reason', btrim(p_reason), true);

  insert into public.attendance_sessions (
    assignment_id, shift_id, worker_id, facility_id,
    check_in_at, check_out_at, check_in_method, check_out_method,
    check_in_by, check_out_by, check_in_reason, check_out_reason,
    check_in_request_id, check_out_request_id, notes
  ) values (
    v_assignment.id, v_shift.id, v_assignment.worker_id, v_shift.facility_id,
    p_check_in_at, p_check_out_at, 'correccion', 'correccion',
    v_profile.id, v_profile.id, btrim(p_reason), btrim(p_reason),
    p_request_id, gen_random_uuid(), nullif(btrim(p_notes), '')
  )
  returning * into v_new;

  return app.session_result('created', v_new);
exception
  when exclusion_violation then
    raise exception 'El registro se traslapa con otro registro vigente de esta persona' using errcode = '23P01';
  when unique_violation then
    select * into v_existing from public.attendance_sessions where check_in_request_id = p_request_id;
    if found and v_existing.assignment_id = p_assignment_id then
      return app.session_result('duplicate', v_existing);
    end if;
    raise exception 'El registro se traslapa con otro registro vigente de esta persona' using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.correct_attendance(p_session_id uuid, p_check_in_at timestamp with time zone, p_check_out_at timestamp with time zone, p_reason text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_old public.attendance_sessions;
  v_new public.attendance_sessions;
  v_shift public.shifts;
begin
  -- Hasta 2500: review_correction compone el motivo de la solicitud con la nota de revisión.
  perform app.assert_max_length(p_reason, 2500, 'El motivo');
  perform app.assert_max_length(p_notes, 1000, 'La nota');
  v_profile := app.require_profile();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'El motivo de la corrección es obligatorio (mínimo 5 caracteres)' using errcode = '22023';
  end if;

  select * into v_old from public.attendance_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Registro no encontrado' using errcode = 'P0002';
  end if;
  if not app.can_manage(v_old.facility_id) then
    raise exception 'No tienes permiso para corregir registros de esta sede' using errcode = '42501';
  end if;
  perform app.assert_not_own_record(v_old.worker_id);
  if v_old.record_status <> 'vigente' then
    raise exception 'Solo se corrige la versión vigente del registro' using errcode = '22023';
  end if;
  if p_check_in_at is null then
    raise exception 'La hora de entrada es obligatoria' using errcode = '22023';
  end if;
  if p_check_out_at is not null and p_check_out_at <= p_check_in_at then
    raise exception 'La salida no puede ser anterior o igual a la entrada' using errcode = '22023';
  end if;
  if p_check_in_at > now() or (p_check_out_at is not null and p_check_out_at > now()) then
    raise exception 'No se pueden registrar horas futuras' using errcode = '22023';
  end if;
  if p_check_out_at is null and v_old.check_out_at is not null then
    raise exception 'Una corrección no puede quitar una salida registrada; anula el registro si corresponde' using errcode = '22023';
  end if;
  select * into v_shift from public.shifts where id = v_old.shift_id;
  perform app.assert_within_shift(v_shift, p_check_in_at, p_check_out_at);

  perform set_config('app.change_reason', btrim(p_reason), true);

  update public.attendance_sessions
  set record_status = 'corregido',
      status_reason = btrim(p_reason),
      status_changed_by = v_profile.id,
      status_changed_at = now()
  where id = v_old.id;

  insert into public.attendance_sessions (
    assignment_id, shift_id, worker_id, facility_id,
    check_in_at, check_out_at,
    check_in_method, check_out_method,
    check_in_by, check_out_by,
    check_in_reason, check_out_reason,
    check_in_request_id, check_out_request_id,
    notes, supersedes_id
  ) values (
    v_old.assignment_id, v_old.shift_id, v_old.worker_id, v_old.facility_id,
    p_check_in_at, p_check_out_at,
    'correccion',
    case when p_check_out_at is null then null else 'correccion'::public.attendance_method end,
    v_profile.id,
    case when p_check_out_at is null then null else v_profile.id end,
    btrim(p_reason),
    case when p_check_out_at is null then null else btrim(p_reason) end,
    gen_random_uuid(),
    case when p_check_out_at is null then null else gen_random_uuid() end,
    coalesce(nullif(btrim(p_notes), ''), v_old.notes),
    v_old.id
  )
  returning * into v_new;

  return app.session_result('corrected', v_new);
exception
  when exclusion_violation or unique_violation then
    raise exception 'La corrección se traslapa con otro registro vigente de esta persona' using errcode = '23P01';
end;
$function$;

CREATE OR REPLACE FUNCTION public.void_attendance(p_session_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_old public.attendance_sessions;
  v_new public.attendance_sessions;
begin
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  v_profile := app.require_profile();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'El motivo de la anulación es obligatorio (mínimo 5 caracteres)' using errcode = '22023';
  end if;
  select * into v_old from public.attendance_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Registro no encontrado' using errcode = 'P0002';
  end if;
  if not app.can_manage(v_old.facility_id) then
    raise exception 'No tienes permiso para anular registros de esta sede' using errcode = '42501';
  end if;
  perform app.assert_not_own_record(v_old.worker_id);
  if v_old.record_status <> 'vigente' then
    raise exception 'El registro ya no está vigente' using errcode = '22023';
  end if;
  perform set_config('app.change_reason', btrim(p_reason), true);
  update public.attendance_sessions
  set record_status = 'anulado', status_reason = btrim(p_reason),
      status_changed_by = v_profile.id, status_changed_at = now()
  where id = v_old.id
  returning * into v_new;
  return app.session_result('voided', v_new);
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_correction(p_assignment_id uuid, p_session_id uuid, p_check_in_at timestamp with time zone, p_check_out_at timestamp with time zone, p_reason text)
 RETURNS public.correction_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_session public.attendance_sessions;
  v_request public.correction_requests;
  v_constraint text;
begin
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  v_profile := app.require_profile();
  select * into v_assignment from public.shift_assignments where id = p_assignment_id;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;
  if not (
    (v_profile.worker_id is not null and v_profile.worker_id = v_assignment.worker_id)
    or app.can_manage(v_shift.facility_id)
  ) then
    raise exception 'Solo puedes solicitar correcciones de tus propios registros' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Describe el motivo (mínimo 5 caracteres)' using errcode = '22023';
  end if;
  -- Nadie podría aprobarlas (add_manual_attendance y correct_attendance las rechazan).
  if v_shift.status = 'cancelada' then
    raise exception 'La guardia está cancelada: no se pueden solicitar correcciones de esta guardia.' using errcode = '22023';
  end if;
  if v_assignment.status = 'cancelado' then
    raise exception 'La asignación está cancelada: no se pueden solicitar correcciones de esta guardia.' using errcode = '22023';
  end if;
  if p_check_in_at is null and p_check_out_at is null then
    raise exception 'Indica al menos la hora de entrada o de salida correcta' using errcode = '22023';
  end if;
  -- Sin registro de referencia se agrega uno nuevo: requiere ambas horas.
  if p_session_id is null and (p_check_in_at is null or p_check_out_at is null) then
    raise exception 'Para solicitar un registro nuevo indica la hora de entrada y la de salida' using errcode = '22023';
  end if;
  if p_check_in_at is not null and p_check_out_at is not null and p_check_out_at <= p_check_in_at then
    raise exception 'La salida debe ser posterior a la entrada' using errcode = '22023';
  end if;
  if (p_check_in_at is not null and p_check_in_at > now()) or (p_check_out_at is not null and p_check_out_at > now()) then
    raise exception 'No se pueden solicitar horas futuras' using errcode = '22023';
  end if;
  -- Misma ventana que se valida al aprobar (las horas vacías no se comparan).
  perform app.assert_within_shift(v_shift, p_check_in_at, p_check_out_at);
  if p_session_id is not null then
    select * into v_session from public.attendance_sessions where id = p_session_id;
    if not found or v_session.assignment_id <> p_assignment_id then
      raise exception 'El registro no corresponde a la asignación' using errcode = '22023';
    end if;
    if v_session.record_status <> 'vigente' then
      raise exception 'Ese registro ya fue corregido o anulado' using errcode = '22023';
    end if;
  end if;

  insert into public.correction_requests (
    assignment_id, session_id, worker_id, facility_id, requested_by,
    requested_check_in_at, requested_check_out_at, reason
  ) values (
    v_assignment.id, p_session_id, v_assignment.worker_id, v_shift.facility_id, v_profile.id,
    p_check_in_at, p_check_out_at, btrim(p_reason)
  )
  returning * into v_request;
  return v_request;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- Una sola solicitud pendiente de registro nuevo por asignación (20261017001330).
    if v_constraint = 'correction_requests_one_pending_new_per_assignment' then
      raise exception 'Ya existe una solicitud pendiente para agregar un registro en esta guardia. Espera a que se revise antes de enviar otra.'
        using errcode = '23505';
    end if;
    raise exception 'Ya existe una solicitud pendiente para ese registro' using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_correction(p_request_id uuid, p_approve boolean, p_notes text DEFAULT NULL::text)
 RETURNS public.correction_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_request public.correction_requests;
  v_session public.attendance_sessions;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_result jsonb;
  v_resulting uuid;
  v_in timestamptz;
  v_out timestamptz;
  v_reason text;
  v_review text;
  v_status_reason text;
begin
  perform app.assert_max_length(p_notes, 1000, 'La nota de revisión');
  v_profile := app.require_profile();
  select * into v_request from public.correction_requests where id = p_request_id for update;
  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if not app.can_manage(v_request.facility_id) then
    raise exception 'No tienes permiso para revisar solicitudes de esta sede' using errcode = '42501';
  end if;
  if v_request.requested_by = v_profile.id and not app.is_admin() then
    raise exception 'No puedes revisar una solicitud que tú hiciste' using errcode = '42501';
  end if;
  perform app.assert_not_own_record(v_request.worker_id);
  if v_request.status <> 'pendiente' then
    raise exception 'La solicitud ya fue revisada' using errcode = '22023';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Indica el motivo del rechazo' using errcode = '22023';
  end if;

  v_review := case when nullif(btrim(p_notes), '') is not null then ' / Revisión: ' || btrim(p_notes) else '' end;
  v_reason := 'Solicitud de corrección aprobada: ' || v_request.reason || v_review;

  if p_approve then
    if v_request.session_id is not null then
      select * into v_session from public.attendance_sessions where id = v_request.session_id;
      v_in := coalesce(v_request.requested_check_in_at, v_session.check_in_at);
      v_out := coalesce(v_request.requested_check_out_at, v_session.check_out_at);
      v_result := public.correct_attendance(v_request.session_id, v_in, v_out, v_reason, null);
    else
      select * into v_assignment from public.shift_assignments where id = v_request.assignment_id for update;
      -- La persona sí asistió: la asignación vuelve a «Asignado» antes de agregar el registro.
      if v_assignment.status in ('ausencia_justificada', 'inasistencia_confirmada') then
        select * into v_shift from public.shifts where id = v_assignment.shift_id;
        if v_shift.status = 'cancelada' then
          raise exception 'La guardia está cancelada' using errcode = '22023';
        end if;
        v_status_reason := 'Se revierte «'
          || case v_assignment.status when 'ausencia_justificada' then 'Ausencia justificada' else 'Inasistencia confirmada' end
          || '» al aprobar una solicitud de corrección. Motivo de la solicitud: ' || v_request.reason || v_review;
        perform set_config('app.change_reason', v_status_reason, true);
        begin
          update public.shift_assignments
          set status = 'asignado',
              status_reason = v_status_reason,
              status_changed_by = v_profile.id,
              status_changed_at = now()
          where id = v_assignment.id;
        exception
          when check_violation then
            raise exception 'No se puede revertir la ausencia: la guardia ya alcanzó su cupo máximo. Ajusta el cupo o las asignaciones y vuelve a intentarlo.'
              using errcode = '23514';
        end;
      end if;
      v_result := public.add_manual_attendance(
        v_request.assignment_id, v_request.requested_check_in_at, v_request.requested_check_out_at,
        v_reason, gen_random_uuid(), null
      );
    end if;
    v_resulting := (v_result -> 'session' ->> 'id')::uuid;
  end if;

  update public.correction_requests
  set status = case when p_approve then 'aprobada'::public.correction_status else 'rechazada'::public.correction_status end,
      reviewed_by = v_profile.id,
      reviewed_at = now(),
      review_notes = nullif(btrim(p_notes), ''),
      resulting_session_id = v_resulting
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_assignment_status(p_assignment_id uuid, p_status public.assignment_status, p_reason text)
 RETURNS public.shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_has_sessions boolean;
begin
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  v_profile := app.require_profile();
  select * into v_assignment from public.shift_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;
  if not app.can_manage(v_shift.facility_id) then
    raise exception 'No tienes permiso para modificar asignaciones de esta sede' using errcode = '42501';
  end if;
  perform app.assert_not_own_record(v_assignment.worker_id);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'El motivo es obligatorio (mínimo 5 caracteres)' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.attendance_sessions s
    where s.assignment_id = p_assignment_id and s.record_status = 'vigente'
  ) into v_has_sessions;

  if p_status in ('ausencia_justificada', 'inasistencia_confirmada', 'cancelado') and v_has_sessions then
    raise exception 'La asignación tiene registros de asistencia vigentes; corrígelos o anúlalos primero' using errcode = '22023';
  end if;
  if p_status = 'inasistencia_confirmada' and now() < v_shift.ends_at then
    raise exception 'La inasistencia solo se confirma después de que termina la guardia' using errcode = '22023';
  end if;

  perform set_config('app.change_reason', btrim(p_reason), true);
  update public.shift_assignments
  set status = p_status,
      status_reason = btrim(p_reason),
      status_changed_by = v_profile.id,
      status_changed_at = now()
  where id = p_assignment_id
  returning * into v_assignment;
  return v_assignment;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_scopes(p_user_id uuid, p_facility_ids uuid[], p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
  v_role public.app_role;
  v_added integer := 0;
  v_removed integer := 0;
begin
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  if not app.is_admin() then
    raise exception 'Solo administración asigna sedes a las cuentas' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Indica el motivo del cambio de sedes (mínimo 5 caracteres)' using errcode = '22023';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_user_id;
  if not found then
    raise exception 'La cuenta no existe' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct i.id), '{}') into v_ids
  from unnest(coalesce(p_facility_ids, '{}'::uuid[])) as i(id)
  where i.id is not null;

  if cardinality(v_ids) > 0 and v_role not in ('coordinador', 'auditor') then
    raise exception 'Solo las cuentas de coordinación y auditoría tienen sedes asignadas' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as i(id)
    where not exists (select 1 from public.facilities f where f.id = i.id)
  ) then
    raise exception 'Alguna sede seleccionada ya no existe' using errcode = '23503';
  end if;

  perform set_config('app.change_reason', v_reason, true);

  delete from public.user_facility_scopes s
  where s.user_id = p_user_id and not (s.facility_id = any (v_ids));
  get diagnostics v_removed = row_count;

  insert into public.user_facility_scopes (user_id, facility_id, change_reason)
  select p_user_id, i.id, v_reason from unnest(v_ids) as i(id)
  on conflict (user_id, facility_id) do nothing;
  get diagnostics v_added = row_count;

  -- El motivo no debe alcanzar otras escrituras de la misma transacción.
  perform set_config('app.change_reason', '', true);
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$function$;

CREATE OR REPLACE FUNCTION public.log_password_reset(p_user_id uuid, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_role text;
  v_id bigint;
begin
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  if not app.is_admin() then
    raise exception 'Solo administración restablece contraseñas' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Indica el motivo del restablecimiento (mínimo 5 caracteres)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'La cuenta no existe' using errcode = 'P0002';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = auth.uid();

  insert into public.audit_log
    (actor_id, actor_role, table_name, record_id, action, old_data, new_data, changed_fields, reason, facility_id)
  values (
    auth.uid(), v_role, 'auth.users', p_user_id::text, 'UPDATE',
    jsonb_build_object('user_id', p_user_id, 'password', 'Contraseña anterior (no se guarda)'),
    jsonb_build_object('user_id', p_user_id, 'password', 'Contraseña temporal nueva (no se guarda)'),
    array['password'], v_reason, null
  )
  returning id into v_id;
  return v_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 2. Números de trabajador solo por funciones que cobran la cuota
-- -----------------------------------------------------------------------------
-- authenticated conserva la escritura de las demás columnas (teléfono, motivo).
revoke insert, update on public.worker_private from authenticated;
grant insert (worker_id, phone, change_reason, updated_at) on public.worker_private to authenticated;
grant update (worker_id, phone, change_reason, updated_at) on public.worker_private to authenticated;

-- Fija, cambia o quita (p_number vacío) el número de trabajador de un registro
-- que la cuenta gestiona. Para coordinación cobra la cuota antes de escribir y
-- no lanza error si el número ya existe: devuelve 'taken' y la cuota queda
-- consumida (un error desharía también el registro de la cuota).
create or replace function public.set_employee_number(p_worker_id uuid, p_number text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text := nullif(btrim(p_number), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_facility uuid;
  v_current text;
  v_has_row boolean;
  v_constraint text;
begin
  perform app.assert_max_length(v_number, 40, 'El número de trabajador');
  perform app.assert_max_length(p_reason, 1000, 'El motivo');
  select w.facility_id into v_facility from public.workers w where w.id = p_worker_id;
  if not found or not app.can_manage(v_facility) then
    raise exception 'El trabajador no existe o no puedes modificar sus datos privados.' using errcode = '42501';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 then
    raise exception 'Indica el motivo del cambio (mínimo 5 caracteres).' using errcode = '22023';
  end if;

  select wp.employee_number into v_current from public.worker_private wp where wp.worker_id = p_worker_id for update;
  v_has_row := found;
  if v_current is not distinct from v_number then
    return 'ok';
  end if;
  -- Quitar el número o cambiar solo mayúsculas o espacios del propio número no
  -- comprueba nada de otras sedes: no consume cuota.
  if v_number is not null and upper(v_number) is distinct from upper(btrim(v_current)) then
    perform app.consume_employee_number_quota(array[upper(v_number)]);
  end if;

  -- El motivo llega a la bitácora aunque sea igual al guardado (touch_row lo vaciaría).
  perform set_config('app.change_reason', v_reason, true);
  begin
    if v_has_row then
      update public.worker_private
      set employee_number = v_number, change_reason = v_reason
      where worker_id = p_worker_id;
    elsif v_number is not null then
      insert into public.worker_private (worker_id, employee_number, change_reason)
      values (p_worker_id, v_number, v_reason);
    end if;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'worker_private_employee_number_uq' then
      raise;
    end if;
    perform set_config('app.change_reason', '', true);
    return 'taken';
  end;
  perform set_config('app.change_reason', '', true);
  return 'ok';
end;
$$;
comment on function public.set_employee_number(uuid, text, text) is
  'Fija, cambia o quita el número de trabajador. Coordinación consume la cuota diaria (app.consume_employee_number_quota) antes de escribir; devuelve ''ok'' o ''taken'' sin lanzar error para que la cuota se conserve.';

revoke all on function public.set_employee_number(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_employee_number(uuid, text, text) to authenticated;

-- Alta atómica (antes en 20261017001210, SECURITY INVOKER). Ahora SECURITY
-- DEFINER porque authenticated ya no inserta employee_number: revisa el mismo
-- permiso que la política workers_insert (app.can_manage de la sede). Cobra la
-- cuota antes del alta; si el número ya existe, la subtransacción deshace el
-- registro y sus datos privados (nada queda a medias), la cuota se conserva y
-- se devuelve {ok: false, taken: true, code: '23505', message} en lugar de un
-- error. Si todo sale bien devuelve {ok: true, id}.
drop function public.create_worker(text, integer, uuid, integer, text, text, text, boolean, text, text, text);

create function public.create_worker(
  p_full_name text,
  p_state_id integer,
  p_facility_id uuid,
  p_municipality_id integer default null,
  p_area text default null,
  p_position text default null,
  p_usual_shift text default null,
  p_active boolean default true,
  p_employee_number text default null,
  p_phone text default null,
  p_change_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_reason text := coalesce(nullif(btrim(p_change_reason), ''), 'Alta de trabajador');
  v_number text := nullif(btrim(p_employee_number), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_constraint text;
begin
  perform app.assert_max_length(p_area, 120, 'El área');
  perform app.assert_max_length(p_position, 120, 'El puesto');
  perform app.assert_max_length(p_usual_shift, 120, 'El turno habitual');
  perform app.assert_max_length(v_number, 40, 'El número de trabajador');
  perform app.assert_max_length(p_change_reason, 1000, 'El motivo');
  if p_facility_id is null then
    raise exception 'Elige la instalación de adscripción.' using errcode = '23502';
  end if;
  if not app.can_manage(p_facility_id) then
    raise exception 'No puedes registrar trabajadores en esa instalación.' using errcode = '42501';
  end if;

  if v_number is not null then
    perform app.consume_employee_number_quota(array[upper(v_number)]);
  end if;

  begin
    insert into public.workers (id, full_name, state_id, municipality_id, facility_id, area, position, usual_shift, active, change_reason)
    values (v_id, p_full_name, p_state_id, p_municipality_id, p_facility_id, p_area, p_position, p_usual_shift, coalesce(p_active, true), v_reason);

    if v_number is not null or v_phone is not null then
      insert into public.worker_private (worker_id, employee_number, phone, change_reason)
      values (v_id, v_number, v_phone, v_reason);
    end if;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'worker_private_employee_number_uq' then
      raise;
    end if;
    return jsonb_build_object(
      'ok', false,
      'taken', true,
      'code', '23505',
      'message', 'Ese número de trabajador ya está registrado (posiblemente en otra sede).'
    );
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
comment on function public.create_worker(text, integer, uuid, integer, text, text, text, boolean, text, text, text) is
  'Alta atómica de trabajador y datos privados. Devuelve {ok: true, id} o, si el número de trabajador ya existe (la cuota consumida se conserva), {ok: false, taken: true, code: ''23505'', message}.';

revoke all on function public.create_worker(text, integer, uuid, integer, text, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.create_worker(text, integer, uuid, integer, text, text, text, boolean, text, text, text) to authenticated;

-- Altas por lotes (importación): mismo resultado por fila que create_worker.
-- Un número repetido no es un error (la cuota se conserva); cualquier otro
-- error deshace solo su fila.
create or replace function public.create_workers(p_rows jsonb, p_change_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_out jsonb := '[]'::jsonb;
  v_code text;
  v_message text;
begin
  perform app.assert_max_length(p_change_reason, 1000, 'El motivo');
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Formato de filas inválido' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Máximo 500 trabajadores por lote' using errcode = '22023';
  end if;

  for v_row in select e from jsonb_array_elements(p_rows) as t(e) loop
    begin
      v_out := v_out || jsonb_build_array(public.create_worker(
        p_full_name => v_row ->> 'full_name',
        p_state_id => (v_row ->> 'state_id')::integer,
        p_facility_id => (v_row ->> 'facility_id')::uuid,
        p_municipality_id => (v_row ->> 'municipality_id')::integer,
        p_area => v_row ->> 'area',
        p_position => v_row ->> 'position',
        p_usual_shift => v_row ->> 'usual_shift',
        p_active => coalesce((v_row ->> 'active')::boolean, true),
        p_employee_number => v_row ->> 'employee_number',
        p_phone => v_row ->> 'phone',
        p_change_reason => p_change_reason
      ));
    exception when others then
      get stacked diagnostics v_code = returned_sqlstate, v_message = message_text;
      v_out := v_out || jsonb_build_array(jsonb_build_object('ok', false, 'code', v_code, 'message', v_message));
    end;
  end loop;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. profiles.change_reason solo de escritura para las cuentas autenticadas
--    (mismo patrón que 20261017001290 para configuración y catálogos).
-- -----------------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_cols
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.profiles'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'change_reason';
  revoke select on public.profiles from authenticated;
  execute format('grant select (%s) on public.profiles to authenticated', v_cols);
end;
$$;
