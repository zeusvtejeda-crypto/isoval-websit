-- =============================================================================
-- Ajustes de la revisión final
-- 1. Comprobación de números de trabajador con cuota diaria para coordinación:
--    employee_number_taken / employee_numbers_taken responden sí/no sobre
--    números de otras sedes; sin límite servían para enumerarlos. Cada cuenta de
--    coordinación puede comprobar hasta 2000 números distintos por 24 h (repetir
--    los mismos no consume cuota). Administración ya ve todos los números.
-- 2. La redacción por conservación también vacía el motivo del evento: algunos
--    motivos copian el texto del registro eliminado (nota de una justificación,
--    motivo de una solicitud de corrección).
-- 3. Los motivos internos de configuración, catálogos y sedes asignadas
--    (change_reason) dejan de ser legibles para las cuentas autenticadas, igual
--    que para el público: solo los conserva la bitácora (de administración).
-- 4. Traslapes de asignaciones: el horario de la otra guardia solo se muestra
--    si quien captura puede verla (antes revelaba guardias de sedes ajenas), y
--    la reprogramación bloquea a las personas asignadas igual que al asignar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cuota de comprobación de números de trabajador
-- -----------------------------------------------------------------------------
create table app.employee_number_checks (
  user_id uuid not null,
  number_hash text not null,
  checked_at timestamptz not null default now(),
  primary key (user_id, number_hash)
);
comment on table app.employee_number_checks is
  'Huella (SHA-256) de los números de trabajador que cada cuenta de coordinación comprobó en las últimas 24 h, para limitar la enumeración. No guarda los números.';
alter table app.employee_number_checks enable row level security;
revoke all on table app.employee_number_checks from public, anon, authenticated;

create or replace function app.consume_employee_number_quota(p_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 2000;
  v_user uuid := auth.uid();
  v_hashes text[];
  v_used integer;
  v_new integer;
begin
  -- Administración ve todos los números (RLS): no necesita cuota.
  if v_user is null or app.is_admin() then
    return;
  end if;
  select coalesce(array_agg(distinct encode(sha256(convert_to(k, 'UTF8')), 'hex')), '{}')
    into v_hashes
  from unnest(p_keys) as k
  where nullif(k, '') is not null;
  if cardinality(v_hashes) = 0 then
    return;
  end if;

  delete from app.employee_number_checks where user_id = v_user and checked_at < now() - interval '24 hours';
  select count(*) into v_used from app.employee_number_checks where user_id = v_user;
  select count(*) into v_new
  from unnest(v_hashes) as h
  where not exists (select 1 from app.employee_number_checks c where c.user_id = v_user and c.number_hash = h);
  if v_used + v_new > v_limit then
    raise exception 'Se alcanzó el límite de % números de trabajador comprobados en 24 horas. Inténtalo más tarde o pide a administración que haga la importación.', v_limit
      using errcode = '54000';
  end if;

  insert into app.employee_number_checks (user_id, number_hash)
  select v_user, h from unnest(v_hashes) as h
  on conflict (user_id, number_hash) do update set checked_at = now();
end;
$$;

revoke all on function app.consume_employee_number_quota(text[]) from public, anon, authenticated;

-- Misma lógica que en 20261017001210, con la cuota (por eso dejan de ser STABLE).
create or replace function public.employee_number_taken(p_number text, p_except_worker uuid default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := upper(btrim(p_number));
begin
  if not app.can_check_employee_number() then
    raise exception 'Solo administración y coordinación pueden comprobar números de trabajador' using errcode = '42501';
  end if;
  if p_except_worker is not null and not app.can_manage(app.worker_facility(p_except_worker)) then
    raise exception 'No puedes consultar números de trabajador de ese registro' using errcode = '42501';
  end if;
  if coalesce(v_key, '') = '' then
    return false;
  end if;
  perform app.consume_employee_number_quota(array[v_key]);
  return exists (
    select 1
    from public.worker_private wp
    where wp.employee_number is not null
      and upper(btrim(wp.employee_number)) = v_key
      and (p_except_worker is null or wp.worker_id <> p_except_worker)
  );
end;
$$;

create or replace function public.employee_numbers_taken(p_numbers text[])
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_keys text[];
begin
  if not app.can_check_employee_number() then
    raise exception 'Solo administración y coordinación pueden comprobar números de trabajador' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_numbers), 0) > 5000 then
    raise exception 'Demasiados números de trabajador en una sola consulta (máximo 5000)' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct upper(btrim(n))), '{}') into v_keys
  from unnest(p_numbers) as n
  where nullif(btrim(n), '') is not null;
  perform app.consume_employee_number_quota(v_keys);
  return coalesce((
    select array_agg(distinct upper(btrim(wp.employee_number)))
    from public.worker_private wp
    where wp.employee_number is not null
      and upper(btrim(wp.employee_number)) = any(v_keys)
  ), '{}'::text[]);
end;
$$;

revoke all on function public.employee_number_taken(text, uuid) from public, anon;
revoke all on function public.employee_numbers_taken(text[]) from public, anon;
grant execute on function public.employee_number_taken(text, uuid) to authenticated;
grant execute on function public.employee_numbers_taken(text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. La redacción por conservación también vacía el motivo
-- -----------------------------------------------------------------------------
create or replace function app.audit_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Redacción por conservación: vacía old_data/new_data/motivo una sola vez
    -- (new_data solo conserva la causa), sin tocar autor, fecha, tabla,
    -- registro, acción ni campos cambiados.
    if coalesce(current_setting('app.allow_purge', true), '') = 'on'
       and old.redacted_at is null
       and new.redacted_at is not null
       and new.old_data is null
       and new.reason is null
       and new.new_data in ('{"redactado": "conservacion"}'::jsonb, '{"redactado": "demostracion"}'::jsonb)
       and (to_jsonb(new) - 'old_data' - 'new_data' - 'redacted_at' - 'reason') = (to_jsonb(old) - 'old_data' - 'new_data' - 'redacted_at' - 'reason') then
      return new;
    end if;
    raise exception 'La bitácora no se modifica' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.allow_purge', true), '') <> 'on' then
    raise exception 'La bitácora no se elimina' using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function app.redact_audit_rows(p_ids bigint[], p_cause text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.audit_log
  set old_data = null, new_data = jsonb_build_object('redactado', p_cause), reason = null, redacted_at = now()
  where id = any(p_ids) and redacted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.redact_audit_rows(bigint[], text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. change_reason solo de escritura para las cuentas autenticadas
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  v_cols text;
begin
  foreach t in array array['app_settings', 'facility_categories', 'states', 'municipalities', 'user_facility_scopes'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
    from pg_catalog.pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname <> 'change_reason';
    execute format('revoke select on public.%I from authenticated', t);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Traslapes: sin revelar guardias de otras sedes y sin carrera al reprogramar
--    (mismas funciones que en 20261017001230 con esos dos cambios)
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
  v_shift public.shifts;
  v_tz text;
  v_other public.shifts;
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

  -- La persona sustituida debe ser visible para quien captura (la llave de
  -- servicio y el seed no tienen sesión y no se revisan).
  if new.substitute_for_worker_id is not null
     and (tg_op = 'INSERT' or new.substitute_for_worker_id is distinct from old.substitute_for_worker_id)
     and auth.uid() is not null
     -- can_see_worker devuelve NULL (no false) cuando la cuenta no tiene trabajador vinculado.
     and not coalesce(app.can_see_worker(new.substitute_for_worker_id), false) then
    raise exception 'La persona sustituida no existe o no es visible para tu cuenta' using errcode = '42501';
  end if;

  if new.status = 'asignado' and (tg_op = 'INSERT' or old.status <> 'asignado' or new.worker_id <> old.worker_id) then
    select * into v_shift from public.shifts s where s.id = new.shift_id for update;
    v_max := v_shift.max_staff;
    if v_max is not null then
      select count(*) into v_count
      from public.shift_assignments a
      where a.shift_id = new.shift_id and a.status = 'asignado' and a.id <> new.id;
      if v_count + 1 > v_max then
        raise exception 'La guardia alcanzó su cupo máximo (%)', v_max using errcode = '23514';
      end if;
    end if;

    -- Traslapes: se bloquea a la persona para que dos asignaciones simultáneas
    -- no pasen ambas la revisión. Intervalos [inicio, término): las guardias
    -- consecutivas no se traslapan.
    if v_shift.status <> 'cancelada' then
      perform 1 from public.workers w where w.id = new.worker_id for no key update;
      select o.* into v_other
      from public.shift_assignments a
      join public.shifts o on o.id = a.shift_id
      where a.worker_id = new.worker_id
        and a.id <> new.id
        and a.shift_id <> new.shift_id
        and a.status = 'asignado'
        and o.status <> 'cancelada'
        and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(v_shift.starts_at, v_shift.ends_at, '[)')
      order by o.starts_at
      limit 1;
      if found then
        -- errcode 22023 (no 23514): quien captura check_violation lo interpreta como cupo máximo.
        -- El horario de la otra guardia solo se muestra si quien captura puede verla.
        if auth.uid() is not null and not coalesce(app.has_scope(v_other.facility_id), false) then
          raise exception 'Esta persona ya tiene asignada otra guardia que se traslapa con este horario. Las guardias consecutivas sí se permiten.'
            using errcode = '22023';
        end if;
        select f.timezone into v_tz from public.facilities f where f.id = v_shift.facility_id;
        v_tz := coalesce(v_tz, 'America/Mazatlan');
        raise exception 'Esta persona ya está asignada a otra guardia que se traslapa con este horario (del % al %). Las guardias consecutivas sí se permiten.',
          to_char(v_other.starts_at at time zone v_tz, 'DD/MM/YYYY HH24:MI'),
          to_char(v_other.ends_at at time zone v_tz, 'DD/MM/YYYY HH24:MI')
          using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.check_shift_staffing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_worker text;
begin
  -- Solo al cambiar el cupo: una edición que no lo toca no se bloquea.
  if new.max_staff is not null and new.max_staff is distinct from old.max_staff then
    select count(*) into v_count
    from public.shift_assignments a
    where a.shift_id = new.id and a.status = 'asignado';
    if v_count > new.max_staff then
      raise exception 'El cupo máximo (%) no puede ser menor que las personas asignadas a la guardia (%). Quita o cancela asignaciones antes de reducirlo.',
        new.max_staff, v_count
        using errcode = '23514';
    end if;
  end if;

  -- Horario nuevo o guardia cancelada que se reactiva: ninguna persona asignada
  -- puede quedar en dos guardias activas que se traslapan.
  if new.status <> 'cancelada'
     and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or old.status = 'cancelada') then
    -- Mismo bloqueo por persona que app.check_assignment: una reprogramación y
    -- una asignación simultáneas de la misma persona se serializan.
    perform 1 from public.workers w
    where w.id in (select a.worker_id from public.shift_assignments a where a.shift_id = new.id and a.status = 'asignado')
    order by w.id
    for no key update;
    select w.full_name into v_worker
    from public.shift_assignments a
    join public.workers w on w.id = a.worker_id
    where a.shift_id = new.id
      and a.status = 'asignado'
      and exists (
        select 1
        from public.shift_assignments b
        join public.shifts o on o.id = b.shift_id
        where b.worker_id = a.worker_id
          and b.shift_id <> new.id
          and b.status = 'asignado'
          and o.status <> 'cancelada'
          and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
      )
    order by w.full_name
    limit 1;
    if v_worker is not null then
      raise exception 'Con este horario, % tendría dos guardias asignadas que se traslapan. Ajusta el horario o la asignación en la otra guardia.',
        v_worker
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
