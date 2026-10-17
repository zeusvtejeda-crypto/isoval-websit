-- =============================================================================
-- Registro con código QR (opcional)
-- - La coordinación muestra en pantalla un QR temporal de la guardia; el
--   trabajador lo escanea con la cámara de su teléfono (la app no pide cámara).
-- - Los códigos los emite y valida el servidor; caducan en segundos (por omisión
--   120 s) y solo se guarda su hash.
-- - El QR NO prueba presencia física: solo indica que la persona abrió el código
--   vigente con su cuenta. El registro queda con método «qr».
-- =============================================================================

create table public.attendance_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint attendance_qr_tokens_expiry check (expires_at > created_at)
);
comment on table public.attendance_qr_tokens is 'Códigos QR temporales por guardia (solo hash). Sin acceso directo: se usan mediante funciones.';
create index attendance_qr_tokens_shift_idx on public.attendance_qr_tokens (shift_id, expires_at);
alter table public.attendance_qr_tokens enable row level security;
revoke all on public.attendance_qr_tokens from anon, authenticated;

update public.app_settings
set value = value || jsonb_build_object('qr_ttl_seconds', 120)
where key = 'attendance' and not (value ? 'qr_ttl_seconds');

create or replace function app.qr_hash(p_token text)
returns text
language sql immutable set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
$$;

-- -----------------------------------------------------------------------------
-- check_in / check_out: método «qr» cuando lo invoca check_in_qr/check_out_qr
-- (variable de transacción que solo fijan esas funciones del servidor).
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
$$;

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
$$;

-- -----------------------------------------------------------------------------
-- Emitir un código (coordinación de la sede o administración)
-- -----------------------------------------------------------------------------
create or replace function public.issue_qr_token(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_shift public.shifts;
  v_ttl integer := least(greatest(app.setting_int('attendance', 'qr_ttl_seconds', 120), 30), 600);
  v_window interval := make_interval(mins => app.setting_int('attendance', 'checkin_window_before_minutes', 120));
  v_grace interval := make_interval(mins => app.setting_int('attendance', 'open_session_grace_minutes', 240));
  v_token text;
  v_expires timestamptz;
begin
  v_profile := app.require_profile();
  select * into v_shift from public.shifts where id = p_shift_id;
  if not found then
    raise exception 'Guardia no encontrada' using errcode = 'P0002';
  end if;
  if not app.can_manage(v_shift.facility_id) then
    raise exception 'No tienes permiso para mostrar el código de esta guardia' using errcode = '42501';
  end if;
  if v_shift.status = 'cancelada' then
    raise exception 'La guardia está cancelada' using errcode = '22023';
  end if;
  if now() < v_shift.starts_at - v_window or now() > v_shift.ends_at + v_grace then
    raise exception 'El código solo está disponible durante la ventana de registro de la guardia' using errcode = '22023';
  end if;

  delete from public.attendance_qr_tokens where shift_id = p_shift_id and expires_at < now() - interval '1 hour';

  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_expires := now() + make_interval(secs => v_ttl);
  insert into public.attendance_qr_tokens (shift_id, token_hash, created_by, expires_at)
  values (p_shift_id, app.qr_hash(v_token), v_profile.id, v_expires);

  return jsonb_build_object('token', v_token, 'expires_at', v_expires, 'ttl_seconds', v_ttl, 'server_time', now());
end;
$$;

-- Token vigente o error claro (uso interno).
create or replace function app.valid_qr_shift(p_token text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_shift uuid;
begin
  select t.shift_id into v_shift
  from public.attendance_qr_tokens t
  where t.token_hash = app.qr_hash(p_token) and t.expires_at > now();
  if v_shift is null then
    raise exception 'El código QR expiró o no es válido. Escanea el código que se muestra ahora.' using errcode = '22023';
  end if;
  return v_shift;
end;
$$;

-- Asignación del usuario actual en la guardia del código (uso interno).
create or replace function app.my_assignment_in_shift(p_shift_id uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if app.my_worker_id() is null then
    raise exception 'Tu cuenta no está vinculada a un registro de trabajador' using errcode = '42501';
  end if;
  select a.id into v_id from public.shift_assignments a
  where a.shift_id = p_shift_id and a.worker_id = app.my_worker_id();
  if v_id is null then
    raise exception 'No estás asignado a la guardia de este código' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contexto del código para la pantalla del trabajador (sin efectos)
-- -----------------------------------------------------------------------------
create or replace function public.qr_token_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shift_id uuid;
  v_assignment uuid;
  v_shift public.shifts;
  v_facility public.facilities;
  v_open boolean;
  v_expires timestamptz;
begin
  perform app.require_profile();
  v_shift_id := app.valid_qr_shift(p_token);
  v_assignment := app.my_assignment_in_shift(v_shift_id);
  select * into v_shift from public.shifts where id = v_shift_id;
  select * into v_facility from public.facilities where id = v_shift.facility_id;
  select exists (
    select 1 from public.attendance_sessions s
    where s.assignment_id = v_assignment and s.check_out_at is null and s.record_status = 'vigente'
  ) into v_open;
  select t.expires_at into v_expires from public.attendance_qr_tokens t where t.token_hash = app.qr_hash(p_token);
  return jsonb_build_object(
    'assignment_id', v_assignment,
    'shift_id', v_shift.id,
    'shift_title', v_shift.title,
    'meeting_point', v_shift.meeting_point,
    'starts_at', v_shift.starts_at,
    'ends_at', v_shift.ends_at,
    'facility_name', v_facility.official_name,
    'facility_timezone', v_facility.timezone,
    'has_open_session', v_open,
    'expires_at', v_expires,
    'server_time', now()
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Registrar entrada / salida con el código
-- La idempotencia va primero: un reintento con el mismo identificador devuelve
-- el mismo registro aunque el código ya haya caducado.
-- -----------------------------------------------------------------------------
create or replace function public.check_in_qr(p_token text, p_request_id uuid, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.attendance_sessions;
  v_result jsonb;
begin
  perform app.require_profile();
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;
  select * into v_existing from public.attendance_sessions
  where check_in_request_id = p_request_id and worker_id = app.my_worker_id();
  if found then
    return app.session_result('duplicate', v_existing);
  end if;

  perform set_config('app.attendance_method', 'qr', true);
  v_result := public.check_in(app.my_assignment_in_shift(app.valid_qr_shift(p_token)), p_request_id, p_notes, null);
  perform set_config('app.attendance_method', '', true);
  return v_result;
end;
$$;

create or replace function public.check_out_qr(p_token text, p_request_id uuid, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.attendance_sessions;
  v_result jsonb;
begin
  perform app.require_profile();
  if p_request_id is null then
    raise exception 'Falta el identificador de la solicitud' using errcode = '22023';
  end if;
  select * into v_existing from public.attendance_sessions
  where check_out_request_id = p_request_id and worker_id = app.my_worker_id();
  if found then
    return app.session_result('duplicate', v_existing);
  end if;

  perform set_config('app.attendance_method', 'qr', true);
  v_result := public.check_out(app.my_assignment_in_shift(app.valid_qr_shift(p_token)), p_request_id, p_notes, null);
  perform set_config('app.attendance_method', '', true);
  return v_result;
end;
$$;

revoke all on function public.issue_qr_token(uuid) from public, anon;
revoke all on function public.qr_token_context(text) from public, anon;
revoke all on function public.check_in_qr(text, uuid, text) from public, anon;
revoke all on function public.check_out_qr(text, uuid, text) from public, anon;
grant execute on function public.issue_qr_token(uuid) to authenticated;
grant execute on function public.qr_token_context(text) to authenticated;
grant execute on function public.check_in_qr(text, uuid, text) to authenticated;
grant execute on function public.check_out_qr(text, uuid, text) to authenticated;
