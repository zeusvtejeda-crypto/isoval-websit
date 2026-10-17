-- =============================================================================
-- Endurecimiento tras la revisión de seguridad y la auditoría de requisitos
-- - Separación de funciones: nadie (salvo administración) corrige, agrega,
--   anula, cambia el estado ni revisa solicitudes de SU PROPIA asistencia.
-- - Correcciones y registros manuales acotados a la guardia (±12 h), sin
--   guardias canceladas ni asignaciones inactivas.
-- - Ninguna salida se registra con la hora actual cuando la entrada quedó
--   abierta más allá del margen (ni siquiera por coordinación): se corrige con
--   la hora real.
-- - check_in/add_manual_attendance no devuelven sesiones fuera del alcance.
-- - incident_notes toma la sede de la asignación (no del cliente).
-- - El estado de una asignación solo cambia con set_assignment_status.
-- - Columnas protegidas (is_demo, created_by) y reglas de guardias en la BD.
-- - Servicios no verificados ocultos también al leer la tabla directamente.
-- - Privilegios por omisión cerrados para objetos futuros.
-- - Conservación: datos privados de trabajadores inactivos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Separación de funciones
-- -----------------------------------------------------------------------------
create or replace function app.assert_not_own_record(p_worker_id uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_worker_id is not null and p_worker_id = app.my_worker_id() and not app.is_admin() then
    raise exception 'No puedes corregir, anular ni revisar tu propia asistencia. Pide a otra persona de coordinación o a administración.'
      using errcode = '42501';
  end if;
end;
$$;

-- Ventana permitida para horas capturadas a mano: la guardia ±12 h.
create or replace function app.assert_within_shift(p_shift public.shifts, p_in timestamptz, p_out timestamptz)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_in < p_shift.starts_at - interval '12 hours'
     or p_in > p_shift.ends_at + interval '12 hours'
     or (p_out is not null and (p_out < p_shift.starts_at - interval '12 hours' or p_out > p_shift.ends_at + interval '12 hours')) then
    raise exception 'Las horas deben estar dentro del horario de la guardia (máximo 12 h antes del inicio o después del término)'
      using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- check_in: no revela sesiones de otras sedes
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
    if found and v_existing.assignment_id = p_assignment_id then
      return app.session_result('duplicate', v_existing);
    end if;
    raise exception 'Ya existe una entrada abierta o traslapada para esta persona' using errcode = '23505';
end;
$$;

-- -----------------------------------------------------------------------------
-- check_out: una entrada olvidada nunca se cierra con la hora actual
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
    if found and v_existing.assignment_id = p_assignment_id then
      return app.session_result('duplicate', v_existing);
    end if;
    raise;
end;
$$;

-- -----------------------------------------------------------------------------
-- correct_attendance: separación de funciones y ventana de la guardia
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
  v_shift public.shifts;
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
$$;

-- -----------------------------------------------------------------------------
-- add_manual_attendance: separación de funciones, ventana, estado e idempotencia
-- -----------------------------------------------------------------------------
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
$$;

-- -----------------------------------------------------------------------------
-- void_attendance: separación de funciones
-- -----------------------------------------------------------------------------
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
$$;

-- -----------------------------------------------------------------------------
-- review_correction: nadie revisa su propia solicitud
-- -----------------------------------------------------------------------------
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
-- set_assignment_status: separación de funciones
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
$$;

-- -----------------------------------------------------------------------------
-- incident_notes: la sede y el autor los fija la base de datos
-- -----------------------------------------------------------------------------
create or replace function app.incident_note_fill()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_worker uuid;
begin
  select s.facility_id, a.worker_id into new.facility_id, v_worker
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  where a.id = new.assignment_id;
  if new.facility_id is null then
    raise exception 'Asignación inexistente' using errcode = '23503';
  end if;
  perform app.assert_not_own_record(v_worker);
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger incident_notes_fill before insert or update on public.incident_notes
  for each row execute function app.incident_note_fill();

-- -----------------------------------------------------------------------------
-- Asignaciones: el estado solo cambia por set_assignment_status
-- -----------------------------------------------------------------------------
revoke insert, update on public.shift_assignments from authenticated;
grant insert (shift_id, worker_id, assigned_point, substitute_for_worker_id, notes, change_reason)
  on public.shift_assignments to authenticated;
grant update (assigned_point, substitute_for_worker_id, notes, change_reason)
  on public.shift_assignments to authenticated;

-- -----------------------------------------------------------------------------
-- Columnas protegidas y reglas de guardias
-- -----------------------------------------------------------------------------
create or replace function app.guard_protected_columns()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin boolean := app.is_admin();
  v_is_service boolean := auth.uid() is null; -- migraciones, seed y llave de servicio
begin
  if not v_admin and not v_is_service then
    if tg_op = 'INSERT' then
      new.is_demo := false;
      new.created_by := auth.uid();
    elsif new.is_demo is distinct from old.is_demo or new.created_by is distinct from old.created_by then
      raise exception 'Solo administración puede cambiar ese campo' using errcode = '42501';
    end if;
  end if;

  if tg_table_name = 'shifts' and tg_op = 'UPDATE' then
    if new.facility_id <> old.facility_id
       and exists (select 1 from public.shift_assignments a where a.shift_id = old.id) then
      raise exception 'No se puede cambiar la sede de una guardia que ya tiene asignaciones' using errcode = '22023';
    end if;
    -- El horario programado se conserva cuando ya hay asistencia registrada.
    if (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at)
       and not v_admin and not v_is_service
       and exists (
         select 1 from public.attendance_sessions s
         where s.shift_id = old.id and s.record_status = 'vigente'
       ) then
      raise exception 'La guardia ya tiene registros de asistencia: su horario solo lo puede cambiar administración' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger shifts_guard_columns before insert or update on public.shifts
  for each row execute function app.guard_protected_columns();
create trigger workers_guard_columns before insert or update on public.workers
  for each row execute function app.guard_protected_columns();

-- -----------------------------------------------------------------------------
-- Servicios no verificados: ocultos también al leer la tabla directamente
-- -----------------------------------------------------------------------------
alter table public.facilities
  add column public_services text[]
  generated always as (case when services_verified then services else '{}'::text[] end) stored;

revoke select (services) on public.facilities from anon;
grant select (public_services) on public.facilities to anon;

create or replace view public.public_facilities
with (security_invoker = true)
as
select
  f.id,
  f.internal_code,
  f.official_name,
  f.unit_key,
  f.category_id,
  f.description,
  f.state_id,
  f.municipality_id,
  f.address,
  f.latitude,
  f.longitude,
  f.phone,
  f.schedule,
  f.public_services as services,
  f.services_verified,
  f.source,
  f.source_url,
  f.last_verified_at,
  f.verification_status,
  f.notes,
  f.timezone,
  f.is_demo,
  f.updated_at
from public.facilities f
where f.is_public and f.active;

revoke all on public.public_facilities from anon, authenticated;
grant select on public.public_facilities to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Privilegios por omisión: los objetos futuros nacen cerrados
-- -----------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- Las funciones de este archivo (y las auxiliares) conservan sus permisos.
revoke all on function app.assert_not_own_record(uuid) from public;
revoke all on function app.assert_within_shift(public.shifts, timestamptz, timestamptz) from public;
grant execute on function app.assert_not_own_record(uuid) to anon, authenticated, service_role;
grant execute on function app.assert_within_shift(public.shifts, timestamptz, timestamptz) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Conservación: datos privados de trabajadores inactivos
-- -----------------------------------------------------------------------------
update public.app_settings
set value = value || jsonb_build_object('inactive_worker_months', 24)
where key = 'retention' and not (value ? 'inactive_worker_months');

create or replace function public.apply_retention_policy(p_execute boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendance_months integer := app.setting_int('retention', 'attendance_months', 24);
  v_audit_months integer := app.setting_int('retention', 'audit_months', 60);
  v_inactive_months integer := app.setting_int('retention', 'inactive_worker_months', 24);
  v_cutoff timestamptz;
  v_audit_cutoff timestamptz;
  v_inactive_cutoff timestamptz;
  v_shifts integer;
  v_sessions integer;
  v_audit integer;
  v_private integer;
begin
  perform app.require_profile();
  if not app.is_admin() then
    raise exception 'Solo administración puede aplicar la política de conservación' using errcode = '42501';
  end if;
  if v_attendance_months < 1 or v_audit_months < 1 or v_inactive_months < 1 then
    raise exception 'Los periodos de conservación deben ser de al menos 1 mes' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(months => v_attendance_months);
  v_audit_cutoff := now() - make_interval(months => v_audit_months);
  v_inactive_cutoff := now() - make_interval(months => v_inactive_months);

  select count(*) into v_shifts from public.shifts where ends_at < v_cutoff;
  select count(*) into v_sessions from public.attendance_sessions where shift_id in (select id from public.shifts where ends_at < v_cutoff);
  select count(*) into v_audit from public.audit_log where occurred_at < v_audit_cutoff;
  select count(*) into v_private
  from public.worker_private p
  join public.workers w on w.id = p.worker_id
  where not w.active
    and w.updated_at < v_inactive_cutoff
    and not exists (
      select 1 from public.shift_assignments a join public.shifts s on s.id = a.shift_id
      where a.worker_id = w.id and s.ends_at >= v_inactive_cutoff
    );

  if p_execute then
    perform set_config('app.allow_purge', 'on', true);
    delete from public.correction_requests where assignment_id in (
      select a.id from public.shift_assignments a join public.shifts s on s.id = a.shift_id where s.ends_at < v_cutoff);
    delete from public.attendance_sessions where shift_id in (select id from public.shifts where ends_at < v_cutoff);
    delete from public.shifts where ends_at < v_cutoff;
    delete from public.audit_log where occurred_at < v_audit_cutoff;
    delete from public.worker_private p
    using public.workers w
    where w.id = p.worker_id
      and not w.active
      and w.updated_at < v_inactive_cutoff
      and not exists (
        select 1 from public.shift_assignments a join public.shifts s on s.id = a.shift_id
        where a.worker_id = w.id and s.ends_at >= v_inactive_cutoff
      );
    perform set_config('app.allow_purge', 'off', true);
    insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, new_data, reason)
    values (auth.uid(), 'admin', 'retention', null, 'PURGE',
      jsonb_build_object('shifts', v_shifts, 'sessions', v_sessions, 'audit_rows', v_audit, 'worker_private_rows', v_private,
        'attendance_cutoff', v_cutoff, 'audit_cutoff', v_audit_cutoff, 'inactive_worker_cutoff', v_inactive_cutoff),
      'Aplicación de la política de conservación de datos');
  end if;

  return jsonb_build_object(
    'executed', p_execute,
    'attendance_cutoff', v_cutoff,
    'audit_cutoff', v_audit_cutoff,
    'inactive_worker_cutoff', v_inactive_cutoff,
    'shifts', v_shifts,
    'sessions', v_sessions,
    'audit_rows', v_audit,
    'worker_private_rows', v_private
  );
end;
$$;

revoke all on function public.apply_retention_policy(boolean) from public, anon;
grant execute on function public.apply_retention_policy(boolean) to authenticated;
