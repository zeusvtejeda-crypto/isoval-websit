-- =============================================================================
-- Registro con QR: trazabilidad y controles adicionales (revisión adversarial)
-- - Cada emisión de código queda en la bitácora (guardia, quién, vencimiento;
--   nunca el código ni su hash).
-- - Cada registro QR guarda el identificador del código usado.
-- - «Renovar ahora» puede invalidar los códigos vigentes de la guardia.
-- - Límite de emisión por guardia.
-- - qr_token_context informa el estado de guardia, asignación y trabajador.
-- =============================================================================

alter table public.attendance_sessions
  add column qr_check_in_token_id uuid,
  add column qr_check_out_token_id uuid;
comment on column public.attendance_sessions.qr_check_in_token_id is 'Código QR usado para la entrada (ver bitácora: emisión de códigos).';
comment on column public.attendance_sessions.qr_check_out_token_id is 'Código QR usado para la salida.';

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
  -- Registro con código QR: guarda qué código se usó (lo fija check_in_qr).
  if new.check_in_method = 'qr' then
    new.qr_check_in_token_id := nullif(current_setting('app.qr_token_id', true), '')::uuid;
  else
    new.qr_check_in_token_id := null;
  end if;
  new.qr_check_out_token_id := null;
  return new;
end;
$$;

create or replace function app.attendance_qr_checkout_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.check_out_at is null and new.check_out_at is not null then
    if new.check_out_method = 'qr' then
      new.qr_check_out_token_id := nullif(current_setting('app.qr_token_id', true), '')::uuid;
    else
      new.qr_check_out_token_id := null;
    end if;
  else
    new.qr_check_out_token_id := old.qr_check_out_token_id;
  end if;
  new.qr_check_in_token_id := old.qr_check_in_token_id;
  return new;
end;
$$;

create trigger attendance_qr_checkout_link before update on public.attendance_sessions
  for each row execute function app.attendance_qr_checkout_link();

-- -----------------------------------------------------------------------------
-- Emisión con revocación opcional, límite y bitácora
-- -----------------------------------------------------------------------------
drop function if exists public.issue_qr_token(uuid);

create function public.issue_qr_token(p_shift_id uuid, p_revoke_previous boolean default false)
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
  v_id uuid;
  v_recent integer;
  v_revoked integer := 0;
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

  select count(*) into v_recent from public.attendance_qr_tokens
  where shift_id = p_shift_id and created_at > now() - interval '10 minutes';
  if v_recent >= 40 then
    raise exception 'Se emitieron demasiados códigos para esta guardia en poco tiempo. Espera unos minutos.' using errcode = '22023';
  end if;

  delete from public.attendance_qr_tokens where shift_id = p_shift_id and expires_at < now() - interval '1 hour';

  if p_revoke_previous then
    update public.attendance_qr_tokens
    set expires_at = greatest(now(), created_at + interval '1 millisecond')
    where shift_id = p_shift_id and expires_at > now();
    get diagnostics v_revoked = row_count;
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_expires := now() + make_interval(secs => v_ttl);
  insert into public.attendance_qr_tokens (shift_id, token_hash, created_by, expires_at)
  values (p_shift_id, app.qr_hash(v_token), v_profile.id, v_expires)
  returning id into v_id;

  insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, new_data, reason, facility_id)
  values (
    v_profile.id, v_profile.role::text, 'attendance_qr_tokens', v_id::text, 'INSERT',
    jsonb_build_object('shift_id', p_shift_id, 'expires_at', v_expires, 'revoked_previous', v_revoked),
    case when p_revoke_previous then 'Código QR de registro emitido (renovación manual: invalida los anteriores)' else 'Código QR de registro emitido' end,
    v_shift.facility_id
  );

  return jsonb_build_object('token', v_token, 'expires_at', v_expires, 'ttl_seconds', v_ttl, 'server_time', now(), 'revoked_previous', v_revoked);
end;
$$;

revoke all on function public.issue_qr_token(uuid, boolean) from public, anon;
grant execute on function public.issue_qr_token(uuid, boolean) to authenticated;

-- Código vigente → identificador del código (uso interno).
create or replace function app.valid_qr_token_id(p_token text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select t.id into v_id
  from public.attendance_qr_tokens t
  where t.token_hash = app.qr_hash(p_token) and t.expires_at > now();
  if v_id is null then
    raise exception 'El código QR expiró o no es válido. Escanea el código que se muestra ahora.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Registrar con QR guardando el código usado
-- -----------------------------------------------------------------------------
create or replace function public.check_in_qr(p_token text, p_request_id uuid, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.attendance_sessions;
  v_token_id uuid;
  v_shift uuid;
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

  v_token_id := app.valid_qr_token_id(p_token);
  select shift_id into v_shift from public.attendance_qr_tokens where id = v_token_id;
  perform set_config('app.attendance_method', 'qr', true);
  perform set_config('app.qr_token_id', v_token_id::text, true);
  v_result := public.check_in(app.my_assignment_in_shift(v_shift), p_request_id, p_notes, null);
  perform set_config('app.attendance_method', '', true);
  perform set_config('app.qr_token_id', '', true);
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
  v_token_id uuid;
  v_shift uuid;
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

  v_token_id := app.valid_qr_token_id(p_token);
  select shift_id into v_shift from public.attendance_qr_tokens where id = v_token_id;
  perform set_config('app.attendance_method', 'qr', true);
  perform set_config('app.qr_token_id', v_token_id::text, true);
  v_result := public.check_out(app.my_assignment_in_shift(v_shift), p_request_id, p_notes, null);
  perform set_config('app.attendance_method', '', true);
  perform set_config('app.qr_token_id', '', true);
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contexto con estado de guardia, asignación y trabajador
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
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_facility public.facilities;
  v_worker_active boolean;
  v_open boolean;
  v_expires timestamptz;
  v_status public.shift_status;
begin
  perform app.require_profile();
  v_shift_id := app.valid_qr_shift(p_token);
  select * into v_assignment from public.shift_assignments where id = app.my_assignment_in_shift(v_shift_id);
  select * into v_shift from public.shifts where id = v_shift_id;
  select * into v_facility from public.facilities where id = v_shift.facility_id;
  select w.active into v_worker_active from public.workers w where w.id = v_assignment.worker_id;
  select exists (
    select 1 from public.attendance_sessions s
    where s.assignment_id = v_assignment.id and s.check_out_at is null and s.record_status = 'vigente'
  ) into v_open;
  select t.expires_at into v_expires from public.attendance_qr_tokens t where t.token_hash = app.qr_hash(p_token);
  v_status := public.effective_status(v_shift);
  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'assignment_status', v_assignment.status,
    'worker_active', coalesce(v_worker_active, false),
    'shift_id', v_shift.id,
    'shift_title', v_shift.title,
    'shift_status', v_status,
    'meeting_point', v_shift.meeting_point,
    'starts_at', v_shift.starts_at,
    'ends_at', v_shift.ends_at,
    'facility_name', v_facility.official_name,
    'facility_timezone', v_facility.timezone,
    'has_open_session', v_open,
    'can_register', v_shift.status <> 'cancelada' and v_assignment.status = 'asignado' and coalesce(v_worker_active, false),
    'expires_at', v_expires,
    'server_time', now()
  );
end;
$$;
