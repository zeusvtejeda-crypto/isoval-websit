-- =============================================================================
-- Bitácora con motivo y auditoría de solo lectura
-- - Motivo del cambio en configuración, categorías, catálogos geográficos y
--   sedes asignadas (la bitácora toma change_reason o app.change_reason).
-- - Asignación de sedes con motivo, incluso al quitarlas (función admin).
-- - Constancia en la bitácora de los restablecimientos de contraseña.
-- - Una cuenta de auditoría no se vincula a un trabajador: así no puede
--   registrar asistencia ni solicitar correcciones como «propias».
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columnas de motivo
-- -----------------------------------------------------------------------------
alter table public.app_settings add column change_reason text;
alter table public.facility_categories add column change_reason text;
alter table public.states add column change_reason text;
alter table public.municipalities add column change_reason text;
alter table public.user_facility_scopes add column change_reason text;

comment on column public.app_settings.change_reason is 'Motivo del último cambio (se copia a la bitácora).';
comment on column public.facility_categories.change_reason is 'Motivo del último cambio (se copia a la bitácora).';
comment on column public.states.change_reason is 'Motivo del último cambio (se copia a la bitácora).';
comment on column public.municipalities.change_reason is 'Motivo del último cambio (se copia a la bitácora).';
comment on column public.user_facility_scopes.change_reason is 'Motivo de la asignación (se copia a la bitácora).';

-- El público lee estos catálogos y la configuración pública, pero no los
-- motivos internos: el permiso de lectura de anon pasa a ser por columna.
do $$
declare
  t text;
  v_cols text;
begin
  foreach t in array array['app_settings', 'facility_categories', 'states', 'municipalities'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
    from pg_catalog.pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname <> 'change_reason';
    execute format('revoke select on public.%I from anon', t);
    execute format('grant select (%s) on public.%I to anon', v_cols, t);
  end loop;
end;
$$;

-- app_settings y facility_categories ya usan app.touch_row(), que no arrastra
-- un motivo repetido. Entidades y municipios no tienen updated_at: se usa la
-- misma regla sin marcas de tiempo.
create or replace function app.reset_change_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.change_reason is not distinct from old.change_reason then
    new.change_reason := null;
  end if;
  return new;
end;
$$;
revoke all on function app.reset_change_reason() from public;

create trigger states_reset_reason before update on public.states
  for each row execute function app.reset_change_reason();
create trigger municipalities_reset_reason before update on public.municipalities
  for each row execute function app.reset_change_reason();

-- -----------------------------------------------------------------------------
-- Sedes asignadas con motivo: las filas se insertan y se borran (no se
-- actualizan), así que el motivo de un retiro solo llega a la bitácora por
-- app.change_reason dentro de la misma transacción.
-- -----------------------------------------------------------------------------
create function public.set_user_scopes(p_user_id uuid, p_facility_ids uuid[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
  v_role public.app_role;
  v_added integer := 0;
  v_removed integer := 0;
begin
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
$$;
comment on function public.set_user_scopes(uuid, uuid[], text) is
  'Reemplaza las sedes asignadas de una cuenta (solo administración). El motivo queda en la bitácora de cada alta y retiro.';

-- -----------------------------------------------------------------------------
-- Restablecimiento de contraseña: Auth no pasa por las tablas auditadas, así
-- que la acción deja su propia constancia (sin la contraseña).
-- -----------------------------------------------------------------------------
create function public.log_password_reset(p_user_id uuid, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_role text;
  v_id bigint;
begin
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
$$;
comment on function public.log_password_reset(uuid, text) is
  'Registra en la bitácora (solo administración) que se restableció la contraseña de una cuenta, con motivo. Nunca guarda la contraseña.';

revoke all on function public.set_user_scopes(uuid, uuid[], text) from public, anon;
revoke all on function public.log_password_reset(uuid, text) from public, anon;
grant execute on function public.set_user_scopes(uuid, uuid[], text) to authenticated;
grant execute on function public.log_password_reset(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Auditoría de solo lectura: sin trabajador vinculado
-- -----------------------------------------------------------------------------
update public.profiles
set worker_id = null,
    change_reason = 'La auditoría es de solo lectura: se desvincula del trabajador'
where role = 'auditor' and worker_id is not null;

alter table public.profiles
  add constraint profiles_auditor_without_worker check (role <> 'auditor' or worker_id is null);

-- El alta desde Auth ignora el trabajador si el rol es auditoría (en lugar de
-- fallar por la restricción anterior).
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
  if v_role = 'auditor' then
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
