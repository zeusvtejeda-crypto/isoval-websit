-- =============================================================================
-- Funciones de asistencia (única vía de escritura de entradas y salidas)
-- - Hora del servidor (now()) para registros en línea.
-- - Idempotencia por identificador de solicitud (doble clic / reintento).
-- - Registro por otra persona: motivo obligatorio y trazabilidad.
-- - Correcciones: nueva versión; el original se conserva.
-- =============================================================================

-- Resultado normalizado de las funciones
create or replace function app.session_result(p_result text, p_session public.attendance_sessions)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'result', p_result,
    'session', case when p_session.id is null then null else to_jsonb(p_session) end,
    'server_time', now()
  )
$$;

create or replace function app.require_profile()
returns public.profiles
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = auth.uid() and active;
  if not found then
    raise exception 'Tu cuenta no está activa' using errcode = '42501';
  end if;
  return v_profile;
end;
$$;

-- -----------------------------------------------------------------------------
-- Registrar entrada
-- -----------------------------------------------------------------------------
create or replace function public.check_in(
  p_assignment_id uuid,
  p_request_id uuid,
  p_notes text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_profile := app.require_profile();
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;

  -- Bloqueo de la asignación: serializa registros simultáneos del mismo trabajador.
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

  -- Idempotencia: la misma solicitud devuelve el mismo registro.
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

  -- Entrada abierta: no se duplica (doble clic con otra solicitud o entrada previa sin salida).
  select * into v_existing
  from public.attendance_sessions
  where worker_id = v_assignment.worker_id and check_out_at is null and record_status = 'vigente'
  limit 1;
  if found then
    return app.session_result(
      case when v_existing.assignment_id = p_assignment_id then 'already_open' else 'open_elsewhere' end,
      v_existing
    );
  end if;

  perform set_config('app.change_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);

  insert into public.attendance_sessions (
    assignment_id, shift_id, worker_id, facility_id,
    check_in_at, check_in_method, check_in_by, check_in_reason, check_in_request_id, notes
  ) values (
    v_assignment.id, v_shift.id, v_assignment.worker_id, v_shift.facility_id,
    now(),
    case when v_is_self then 'propio'::public.attendance_method else 'coordinador'::public.attendance_method end,
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
    if found then
      return app.session_result('duplicate', v_existing);
    end if;
    raise exception 'Ya existe una entrada abierta o traslapada para esta persona' using errcode = '23505';
end;
$$;

comment on function public.check_in(uuid, uuid, text, text) is
  'Registra entrada con hora del servidor. Resultados: created, duplicate (misma solicitud), already_open, open_elsewhere.';

-- -----------------------------------------------------------------------------
-- Registrar salida
-- -----------------------------------------------------------------------------
create or replace function public.check_out(
  p_assignment_id uuid,
  p_request_id uuid,
  p_notes text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Una entrada olvidada no se cierra con la hora actual: requiere revisión.
  v_grace := make_interval(mins => app.setting_int('attendance', 'open_session_grace_minutes', 240));
  if v_is_self and now() > v_shift.ends_at + v_grace then
    raise exception 'Esta entrada quedó sin salida y requiere revisión. Solicita una corrección.' using errcode = '22023';
  end if;

  if now() <= v_open.check_in_at then
    raise exception 'La salida no puede ser anterior o igual a la entrada' using errcode = '22023';
  end if;

  perform set_config('app.change_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);

  update public.attendance_sessions
  set check_out_at = now(),
      check_out_method = case when v_is_self then 'propio'::public.attendance_method else 'coordinador'::public.attendance_method end,
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
    if found then
      return app.session_result('duplicate', v_existing);
    end if;
    raise;
end;
$$;

comment on function public.check_out(uuid, uuid, text, text) is
  'Registra salida con hora del servidor. Resultados: created, duplicate, no_open_session.';

-- -----------------------------------------------------------------------------
-- Correcciones (coordinación/administración). Conservan el original.
-- -----------------------------------------------------------------------------
create or replace function public.correct_attendance(
  p_session_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_old public.attendance_sessions;
  v_new public.attendance_sessions;
begin
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
$$;

-- Registro manual posterior (p. ej. la persona no pudo registrar). Requiere ambas horas.
create or replace function public.add_manual_attendance(
  p_assignment_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text,
  p_request_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_existing public.attendance_sessions;
  v_new public.attendance_sessions;
begin
  v_profile := app.require_profile();
  select * into v_assignment from public.shift_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;
  if not app.can_manage(v_shift.facility_id) then
    raise exception 'No tienes permiso para registrar asistencia en esta sede' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;
  select * into v_existing from public.attendance_sessions where check_in_request_id = p_request_id;
  if found then
    return app.session_result('duplicate', v_existing);
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'El motivo es obligatorio (mínimo 5 caracteres)' using errcode = '22023';
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
    if found then
      return app.session_result('duplicate', v_existing);
    end if;
    raise exception 'El registro se traslapa con otro registro vigente de esta persona' using errcode = '23505';
end;
$$;

-- Anular un registro (se conserva con estado "anulado").
create or replace function public.void_attendance(p_session_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_old public.attendance_sessions;
  v_new public.attendance_sessions;
begin
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
$$;

-- -----------------------------------------------------------------------------
-- Solicitudes de corrección
-- -----------------------------------------------------------------------------
create or replace function public.request_correction(
  p_assignment_id uuid,
  p_session_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text
)
returns public.correction_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_session public.attendance_sessions;
  v_request public.correction_requests;
begin
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
  if p_check_in_at is null and p_check_out_at is null then
    raise exception 'Indica al menos la hora de entrada o de salida correcta' using errcode = '22023';
  end if;
  if (p_check_in_at is not null and p_check_in_at > now()) or (p_check_out_at is not null and p_check_out_at > now()) then
    raise exception 'No se pueden solicitar horas futuras' using errcode = '22023';
  end if;
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
    raise exception 'Ya existe una solicitud pendiente para ese registro' using errcode = '23505';
end;
$$;

create or replace function public.review_correction(
  p_request_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns public.correction_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_request public.correction_requests;
  v_session public.attendance_sessions;
  v_result jsonb;
  v_resulting uuid;
  v_in timestamptz;
  v_out timestamptz;
  v_reason text;
begin
  v_profile := app.require_profile();
  select * into v_request from public.correction_requests where id = p_request_id for update;
  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if not app.can_manage(v_request.facility_id) then
    raise exception 'No tienes permiso para revisar solicitudes de esta sede' using errcode = '42501';
  end if;
  if v_request.status <> 'pendiente' then
    raise exception 'La solicitud ya fue revisada' using errcode = '22023';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Indica el motivo del rechazo' using errcode = '22023';
  end if;

  v_reason := 'Solicitud de corrección aprobada: ' || v_request.reason
    || case when nullif(btrim(p_notes), '') is not null then ' / Revisión: ' || btrim(p_notes) else '' end;

  if p_approve then
    if v_request.session_id is not null then
      select * into v_session from public.attendance_sessions where id = v_request.session_id;
      v_in := coalesce(v_request.requested_check_in_at, v_session.check_in_at);
      v_out := coalesce(v_request.requested_check_out_at, v_session.check_out_at);
      v_result := public.correct_attendance(v_request.session_id, v_in, v_out, v_reason, null);
    else
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
$$;

-- -----------------------------------------------------------------------------
-- Estado de una asignación (ausencia justificada, inasistencia confirmada…)
-- -----------------------------------------------------------------------------
create or replace function public.set_assignment_status(
  p_assignment_id uuid,
  p_status public.assignment_status,
  p_reason text
)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_has_sessions boolean;
begin
  v_profile := app.require_profile();
  select * into v_assignment from public.shift_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;
  if not app.can_manage(v_shift.facility_id) then
    raise exception 'No tienes permiso para modificar asignaciones de esta sede' using errcode = '42501';
  end if;
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
$$;

-- -----------------------------------------------------------------------------
-- Vista del trabajador: sus asignaciones con datos mínimos de la guardia
-- (incluye el nombre del responsable sin exponer el directorio).
-- -----------------------------------------------------------------------------
create or replace function public.get_my_assignments(p_from timestamptz, p_to timestamptz)
returns table (
  assignment_id uuid,
  assignment_status public.assignment_status,
  assigned_point text,
  substitute_for_name text,
  shift_id uuid,
  shift_title text,
  meeting_point text,
  starts_at timestamptz,
  ends_at timestamptz,
  shift_status public.shift_status,
  instructions text,
  facility_id uuid,
  facility_name text,
  facility_timezone text,
  arrival_tolerance_minutes integer,
  responsible_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id, a.status, a.assigned_point, sub.full_name,
    s.id, s.title, s.meeting_point, s.starts_at, s.ends_at, public.effective_status(s), s.instructions,
    f.id, f.official_name, f.timezone, f.arrival_tolerance_minutes,
    r.full_name
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  join public.facilities f on f.id = s.facility_id
  left join public.workers sub on sub.id = a.substitute_for_worker_id
  left join public.workers r on r.id = s.responsible_worker_id
  where a.worker_id = app.my_worker_id()
    and app.my_worker_id() is not null
    and s.ends_at >= p_from
    and s.starts_at <= p_to
  order by s.starts_at
$$;

create or replace function public.server_time()
returns timestamptz
language sql stable set search_path = ''
as $$ select now() $$;

-- -----------------------------------------------------------------------------
-- Conservación y eliminación de datos (configurable; solo administración)
-- -----------------------------------------------------------------------------
create or replace function public.apply_retention_policy(p_execute boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendance_months integer := app.setting_int('retention', 'attendance_months', 24);
  v_audit_months integer := app.setting_int('retention', 'audit_months', 60);
  v_cutoff timestamptz;
  v_audit_cutoff timestamptz;
  v_shifts integer;
  v_sessions integer;
  v_audit integer;
begin
  perform app.require_profile();
  if not app.is_admin() then
    raise exception 'Solo administración puede aplicar la política de conservación' using errcode = '42501';
  end if;
  if v_attendance_months < 1 or v_audit_months < 1 then
    raise exception 'Los periodos de conservación deben ser de al menos 1 mes' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(months => v_attendance_months);
  v_audit_cutoff := now() - make_interval(months => v_audit_months);

  select count(*) into v_shifts from public.shifts where ends_at < v_cutoff;
  select count(*) into v_sessions from public.attendance_sessions where shift_id in (select id from public.shifts where ends_at < v_cutoff);
  select count(*) into v_audit from public.audit_log where occurred_at < v_audit_cutoff;

  if p_execute then
    perform set_config('app.allow_purge', 'on', true);
    delete from public.correction_requests where assignment_id in (
      select a.id from public.shift_assignments a join public.shifts s on s.id = a.shift_id where s.ends_at < v_cutoff);
    delete from public.attendance_sessions where shift_id in (select id from public.shifts where ends_at < v_cutoff);
    delete from public.shifts where ends_at < v_cutoff;
    delete from public.audit_log where occurred_at < v_audit_cutoff;
    perform set_config('app.allow_purge', 'off', true);
    insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, new_data, reason)
    values (auth.uid(), 'admin', 'retention', null, 'PURGE',
      jsonb_build_object('shifts', v_shifts, 'sessions', v_sessions, 'audit_rows', v_audit,
        'attendance_cutoff', v_cutoff, 'audit_cutoff', v_audit_cutoff),
      'Aplicación de la política de conservación de datos');
  end if;

  return jsonb_build_object(
    'executed', p_execute,
    'attendance_cutoff', v_cutoff,
    'audit_cutoff', v_audit_cutoff,
    'shifts', v_shifts,
    'sessions', v_sessions,
    'audit_rows', v_audit
  );
end;
$$;

-- Elimina únicamente los datos de demostración (is_demo = true).
create or replace function public.purge_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facilities integer;
  v_workers integer;
  v_shifts integer;
begin
  perform app.require_profile();
  if not app.is_admin() then
    raise exception 'Solo administración puede eliminar los datos de demostración' using errcode = '42501';
  end if;
  perform set_config('app.allow_purge', 'on', true);

  delete from public.correction_requests where facility_id in (select id from public.facilities where is_demo)
    or worker_id in (select id from public.workers where is_demo);
  delete from public.attendance_sessions where facility_id in (select id from public.facilities where is_demo)
    or worker_id in (select id from public.workers where is_demo)
    or shift_id in (select id from public.shifts where is_demo);
  delete from public.shift_assignments where worker_id in (select id from public.workers where is_demo);
  with d as (
    delete from public.shifts where is_demo or facility_id in (select id from public.facilities where is_demo) returning 1
  ) select count(*) into v_shifts from d;
  update public.profiles set worker_id = null where worker_id in (select id from public.workers where is_demo);
  with d as (delete from public.workers where is_demo returning 1) select count(*) into v_workers from d;
  update public.workers set facility_id = null where facility_id in (select id from public.facilities where is_demo);
  with d as (delete from public.facilities where is_demo returning 1) select count(*) into v_facilities from d;

  perform set_config('app.allow_purge', 'off', true);
  insert into public.audit_log (actor_id, actor_role, table_name, action, new_data, reason)
  values (auth.uid(), 'admin', 'demo_data', 'PURGE',
    jsonb_build_object('facilities', v_facilities, 'workers', v_workers, 'shifts', v_shifts),
    'Eliminación de datos de demostración');
  return jsonb_build_object('facilities', v_facilities, 'workers', v_workers, 'shifts', v_shifts);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilegios de ejecución
-- -----------------------------------------------------------------------------
revoke all on function public.check_in(uuid, uuid, text, text) from public, anon;
revoke all on function public.check_out(uuid, uuid, text, text) from public, anon;
revoke all on function public.correct_attendance(uuid, timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.add_manual_attendance(uuid, timestamptz, timestamptz, text, uuid, text) from public, anon;
revoke all on function public.void_attendance(uuid, text) from public, anon;
revoke all on function public.request_correction(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.review_correction(uuid, boolean, text) from public, anon;
revoke all on function public.set_assignment_status(uuid, public.assignment_status, text) from public, anon;
revoke all on function public.get_my_assignments(timestamptz, timestamptz) from public, anon;
revoke all on function public.apply_retention_policy(boolean) from public, anon;
revoke all on function public.purge_demo_data() from public, anon;

grant execute on function public.check_in(uuid, uuid, text, text) to authenticated;
grant execute on function public.check_out(uuid, uuid, text, text) to authenticated;
grant execute on function public.correct_attendance(uuid, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.add_manual_attendance(uuid, timestamptz, timestamptz, text, uuid, text) to authenticated;
grant execute on function public.void_attendance(uuid, text) to authenticated;
grant execute on function public.request_correction(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.review_correction(uuid, boolean, text) to authenticated;
grant execute on function public.set_assignment_status(uuid, public.assignment_status, text) to authenticated;
grant execute on function public.get_my_assignments(timestamptz, timestamptz) to authenticated;
grant execute on function public.apply_retention_policy(boolean) to authenticated;
grant execute on function public.purge_demo_data() to authenticated;
grant execute on function public.server_time() to anon, authenticated;
grant execute on function public.effective_status(public.shifts) to authenticated;
