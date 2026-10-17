-- =============================================================================
-- Trabajadores: alta atómica y sede obligatoria (revisión de auditoría)
-- - Cada trabajador pertenece a una sede: workers.facility_id es obligatorio.
-- - public.create_worker(): crea el registro y sus datos privados en una sola
--   transacción (SECURITY INVOKER: aplica RLS igual que un INSERT directo). Si
--   el número de trabajador ya existe, aunque sea en una sede que la cuenta no
--   ve, no queda ningún registro a medias.
-- - public.create_workers(): lo mismo por lotes (importación), con resultado
--   por fila; cada fila es atómica por separado.
-- - public.employee_number_taken() / employee_numbers_taken(): comprobación
--   previa para administración y coordinación. Solo responden sí/no: no
--   revelan a quién pertenece el número ni sus datos.
-- - purge_demo_data() ya no deja trabajadores reales sin sede.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sede de adscripción obligatoria
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.workers where facility_id is null) then
    raise exception 'Hay trabajadores sin instalación de adscripción: asígnales una sede antes de aplicar esta migración'
      using errcode = '23502';
  end if;
end;
$$;

alter table public.workers alter column facility_id set not null;
comment on column public.workers.facility_id is 'Instalación de adscripción (obligatoria: cada trabajador pertenece a una sede).';

-- -----------------------------------------------------------------------------
-- Comprobación de número de trabajador (sí/no)
-- -----------------------------------------------------------------------------
-- Administración, o coordinación con al menos una sede asignada.
create or replace function app.can_check_employee_number()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_admin() or exists (
    select 1
    from public.profiles p
    join public.user_facility_scopes s on s.user_id = p.id
    where p.id = auth.uid() and p.active and p.role = 'coordinador'
  )
$$;

-- ¿Está registrado el número (misma comparación que worker_private_employee_number_uq)?
-- p_except_worker excluye al trabajador que se edita; debe ser uno que la cuenta
-- gestiona (si no, la respuesta revelaría de quién es el número).
create or replace function public.employee_number_taken(p_number text, p_except_worker uuid default null)
returns boolean
language plpgsql stable security definer set search_path = ''
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
  return exists (
    select 1
    from public.worker_private wp
    where wp.employee_number is not null
      and upper(btrim(wp.employee_number)) = v_key
      and (p_except_worker is null or wp.worker_id <> p_except_worker)
  );
end;
$$;

-- Versión por lotes para la vista previa de la importación: devuelve, de los
-- números recibidos, los que ya están registrados (en mayúsculas y sin espacios
-- en los extremos). Mismo límite de filas que la importación.
create or replace function public.employee_numbers_taken(p_numbers text[])
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.can_check_employee_number() then
    raise exception 'Solo administración y coordinación pueden comprobar números de trabajador' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_numbers), 0) > 5000 then
    raise exception 'Demasiados números de trabajador en una sola consulta (máximo 5000)' using errcode = '22023';
  end if;
  return coalesce((
    select array_agg(distinct upper(btrim(wp.employee_number)))
    from public.worker_private wp
    where wp.employee_number is not null
      and upper(btrim(wp.employee_number)) in (
        select upper(btrim(n)) from unnest(p_numbers) as n where nullif(btrim(n), '') is not null
      )
  ), '{}'::text[]);
end;
$$;

-- -----------------------------------------------------------------------------
-- Alta atómica de trabajador + datos privados
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER: las políticas workers_insert y worker_private_insert se
-- aplican como en un INSERT directo; los triggers de bitácora registran ambas
-- filas con el mismo motivo. Un error en cualquiera de las dos deshace todo.
create or replace function public.create_worker(
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
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_reason text := coalesce(nullif(btrim(p_change_reason), ''), 'Alta de trabajador');
  v_number text := nullif(btrim(p_employee_number), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_constraint text;
begin
  if p_facility_id is null then
    raise exception 'Elige la instalación de adscripción.' using errcode = '23502';
  end if;

  insert into public.workers (id, full_name, state_id, municipality_id, facility_id, area, position, usual_shift, active, change_reason)
  values (v_id, p_full_name, p_state_id, p_municipality_id, p_facility_id, p_area, p_position, p_usual_shift, coalesce(p_active, true), v_reason);

  if v_number is not null or v_phone is not null then
    begin
      insert into public.worker_private (worker_id, employee_number, phone, change_reason)
      values (v_id, v_number, v_phone, v_reason);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'worker_private_employee_number_uq' then
        raise exception 'Ese número de trabajador ya está registrado (posiblemente en otra sede).' using errcode = '23505';
      end if;
      raise;
    end;
  end if;

  return v_id;
end;
$$;

-- Altas por lotes (importación). Cada fila se crea en su propia subtransacción:
-- una fila con error no deja nada creado y no impide las demás. Devuelve, en el
-- mismo orden, {ok, id} o {ok: false, code, message}.
create or replace function public.create_workers(p_rows jsonb, p_change_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_code text;
  v_message text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Formato de filas inválido' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Máximo 500 trabajadores por lote' using errcode = '22023';
  end if;

  for v_row in select e from jsonb_array_elements(p_rows) as t(e) loop
    begin
      v_id := public.create_worker(
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
      );
      v_out := v_out || jsonb_build_array(jsonb_build_object('ok', true, 'id', v_id));
    exception when others then
      get stacked diagnostics v_code = returned_sqlstate, v_message = message_text;
      v_out := v_out || jsonb_build_array(jsonb_build_object('ok', false, 'code', v_code, 'message', v_message));
    end;
  end loop;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Datos de demostración: ya no se deja a nadie sin sede
-- -----------------------------------------------------------------------------
-- Antes, los trabajadores reales adscritos a una instalación de demostración
-- quedaban sin sede. Ahora la eliminación se detiene y pide cambiarlos de sede.
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
  v_real_workers integer;
begin
  perform app.require_profile();
  if not app.is_admin() then
    raise exception 'Solo administración puede eliminar los datos de demostración' using errcode = '42501';
  end if;

  select count(*) into v_real_workers
  from public.workers w
  where not w.is_demo and w.facility_id in (select id from public.facilities where is_demo);
  if v_real_workers > 0 then
    raise exception '% % adscrito% a instalaciones de demostración. Cámbialos de sede antes de eliminar los datos de demostración.',
      v_real_workers,
      case when v_real_workers = 1 then 'trabajador que no es de demostración está' else 'trabajadores que no son de demostración están' end,
      case when v_real_workers = 1 then '' else 's' end
      using errcode = '23503';
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
revoke all on function app.can_check_employee_number() from public, anon;
revoke all on function public.employee_number_taken(text, uuid) from public, anon;
revoke all on function public.employee_numbers_taken(text[]) from public, anon;
revoke all on function public.create_worker(text, integer, uuid, integer, text, text, text, boolean, text, text, text) from public, anon;
revoke all on function public.create_workers(jsonb, text) from public, anon;
revoke all on function public.purge_demo_data() from public, anon;

grant execute on function app.can_check_employee_number() to authenticated, service_role;
grant execute on function public.employee_number_taken(text, uuid) to authenticated;
grant execute on function public.employee_numbers_taken(text[]) to authenticated;
grant execute on function public.create_worker(text, integer, uuid, integer, text, text, text, boolean, text, text, text) to authenticated;
grant execute on function public.create_workers(jsonb, text) to authenticated;
grant execute on function public.purge_demo_data() to authenticated;
