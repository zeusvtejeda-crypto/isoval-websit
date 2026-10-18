-- =============================================================================
-- Sesiones revocadas: un JWT deja de dar acceso en cuanto se cierra su sesión.
--
-- El token de acceso de Supabase sigue siendo válido hasta su vencimiento
-- (jwt_expiry) aunque la sesión ya no exista: cierre de sesión (en todos los
-- dispositivos), cuenta desactivada por administración o sesión vencida por
-- timebox/inactividad. Con claves asimétricas, getClaims() lo valida sin
-- consultar a Auth. Por eso las funciones de autorización exigen además que la
-- sesión del claim `session_id` siga viva en auth.sessions.
--
-- Sin `session_id` (llave de servicio, migraciones, pruebas que solo fijan
-- `sub`) se considera viva: esos contextos no provienen de un inicio de sesión.
-- =============================================================================

-- plpgsql (no sql) para que la conversión a uuid solo ocurra tras validar el formato.
create or replace function app.session_alive()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_session_id text := auth.jwt() ->> 'session_id';
begin
  if v_session_id is null then
    return true;
  end if;
  -- GoTrue siempre emite un UUID; cualquier otro valor se rechaza sin error.
  if v_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1
    from auth.sessions s
    where s.id = v_session_id::uuid
      and s.user_id is not distinct from auth.uid()
      and (s.not_after is null or s.not_after > now())
  );
end;
$$;
comment on function app.session_alive() is
  'Verdadero si el JWT no trae session_id (servicio/pruebas) o si su sesión sigue en auth.sessions, es de la misma cuenta y no venció (not_after).';

revoke all on function app.session_alive() from public;
grant execute on function app.session_alive() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Funciones de autorización (últimas definiciones: 20261017000300, 000400 y
-- 001210), ahora condicionadas a app.session_alive().
-- -----------------------------------------------------------------------------
create or replace function app.my_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active and app.session_alive()
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.session_alive() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  )
$$;

create or replace function app.my_worker_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.worker_id from public.profiles p
  where p.id = auth.uid() and p.active and app.session_alive()
$$;

-- Lectura: administrador, o coordinador/auditor con la sede asignada.
create or replace function app.has_scope(p_facility_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.session_alive() and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and (
        p.role = 'admin'
        or (
          p_facility_id is not null
          and p.role in ('coordinador', 'auditor')
          and exists (
            select 1 from public.user_facility_scopes s
            where s.user_id = p.id and s.facility_id = p_facility_id
          )
        )
      )
  )
$$;

-- Escritura operativa: administrador, o coordinador con la sede asignada.
create or replace function app.can_manage(p_facility_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.session_alive() and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and (
        p.role = 'admin'
        or (
          p_facility_id is not null
          and p.role = 'coordinador'
          and exists (
            select 1 from public.user_facility_scopes s
            where s.user_id = p.id and s.facility_id = p_facility_id
          )
        )
      )
  )
$$;

create or replace function app.require_profile()
returns public.profiles
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null or not app.session_alive() then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = auth.uid() and active;
  if not found then
    raise exception 'Tu cuenta no está activa' using errcode = '42501';
  end if;
  return v_profile;
end;
$$;

create or replace function app.can_check_employee_number()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_admin() or (
    app.session_alive() and exists (
      select 1
      from public.profiles p
      join public.user_facility_scopes s on s.user_id = p.id
      where p.id = auth.uid() and p.active and p.role = 'coordinador'
    )
  )
$$;

-- -----------------------------------------------------------------------------
-- Políticas que comparan directamente con auth.uid() (sin pasar por las
-- funciones anteriores): el perfil propio y las sedes asignadas. Así
-- getSessionUser() (src/lib/auth.ts) no encuentra el perfil de una sesión
-- revocada y trata la solicitud como sin sesión.
-- -----------------------------------------------------------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (
    (id = (select auth.uid()) and (select app.session_alive()))
    or (select app.is_admin())
    or (worker_id is not null and app.has_scope(app.worker_facility(worker_id)))
  );

drop policy if exists scopes_read on public.user_facility_scopes;
create policy scopes_read on public.user_facility_scopes for select to authenticated
  using ((user_id = (select auth.uid()) and (select app.session_alive())) or (select app.is_admin()));
