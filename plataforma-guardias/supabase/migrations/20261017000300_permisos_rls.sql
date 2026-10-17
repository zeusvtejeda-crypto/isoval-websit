-- =============================================================================
-- Permisos por rol y sede + Row Level Security
-- Regla: los permisos se validan en la base de datos (RLS y funciones), no solo
-- ocultando botones en la interfaz.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones auxiliares (SECURITY DEFINER para evitar recursión de RLS)
-- -----------------------------------------------------------------------------
create or replace function app.my_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  )
$$;

create or replace function app.my_worker_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.worker_id from public.profiles p where p.id = auth.uid() and p.active
$$;

-- Lectura: administrador, o coordinador/auditor con la sede asignada.
create or replace function app.has_scope(p_facility_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
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
  select exists (
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

create or replace function app.worker_facility(p_worker_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select w.facility_id from public.workers w where w.id = p_worker_id
$$;

create or replace function app.shift_facility(p_shift_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.facility_id from public.shifts s where s.id = p_shift_id
$$;

-- ¿El usuario actual (como trabajador) está asignado a la guardia o es su responsable?
create or replace function app.is_my_shift(p_shift_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shift_assignments a
    where a.shift_id = p_shift_id and a.worker_id = app.my_worker_id()
  ) or exists (
    select 1 from public.shifts s
    where s.id = p_shift_id and s.responsible_worker_id = app.my_worker_id()
  )
$$;

-- Personal visible para coordinación/auditoría: adscritos a sus sedes o
-- asignados a guardias de sus sedes (p. ej. una sustitución desde otra sede).
create or replace function app.can_see_worker(p_worker_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    p_worker_id = app.my_worker_id()
    or app.has_scope(app.worker_facility(p_worker_id))
    or exists (
      select 1
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      where a.worker_id = p_worker_id and app.has_scope(s.facility_id)
    )
    or exists (
      select 1 from public.shifts s
      where s.responsible_worker_id = p_worker_id and app.has_scope(s.facility_id)
    )
$$;

-- Facilities visibles para el usuario autenticado además de las públicas.
create or replace function app.can_see_facility(p_facility_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_scope(p_facility_id)
    or p_facility_id = app.worker_facility(app.my_worker_id())
    or exists (
      select 1
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      where a.worker_id = app.my_worker_id() and s.facility_id = p_facility_id
    )
$$;

-- -----------------------------------------------------------------------------
-- Estado efectivo de la guardia (columna calculada para la API)
-- -----------------------------------------------------------------------------
create or replace function public.effective_status(s public.shifts)
returns public.shift_status
language sql stable set search_path = ''
as $$
  select case
    when s.status in ('cancelada', 'finalizada') then s.status
    when now() < s.starts_at then 'programada'::public.shift_status
    when now() < s.ends_at then 'en_curso'::public.shift_status
    else 'finalizada'::public.shift_status
  end
$$;
comment on function public.effective_status(public.shifts) is 'Estado mostrado: cancelada/finalizada manual o calculado por horario.';

-- -----------------------------------------------------------------------------
-- Habilitar RLS en todas las tablas
-- -----------------------------------------------------------------------------
alter table public.states enable row level security;
alter table public.municipalities enable row level security;
alter table public.facility_categories enable row level security;
alter table public.facilities enable row level security;
alter table public.workers enable row level security;
alter table public.worker_private enable row level security;
alter table public.profiles enable row level security;
alter table public.user_facility_scopes enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.correction_requests enable row level security;
alter table public.incident_notes enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;

-- -----------------------------------------------------------------------------
-- Privilegios: se parte de cero y se otorga lo mínimo.
-- (RLS no aplica a TRUNCATE, por eso se revoca explícitamente.)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema app to anon, authenticated, service_role;
revoke all on all functions in schema app from public;
grant execute on all functions in schema app to anon, authenticated, service_role;

-- Catálogos públicos
grant select on public.states, public.municipalities, public.facility_categories to anon, authenticated;
grant insert, update, delete on public.states, public.municipalities, public.facility_categories to authenticated;

-- Instalaciones: el público solo ve columnas del directorio.
grant select (
  id, internal_code, official_name, unit_key, category_id, description, state_id, municipality_id,
  address, latitude, longitude, phone, schedule, services, services_verified, source, source_url,
  last_verified_at, verification_status, notes, timezone, is_public, is_demo, active, updated_at
) on public.facilities to anon;
grant select, insert, update, delete on public.facilities to authenticated;
grant usage, select on sequence public.facility_code_seq, public.worker_code_seq to authenticated;

-- Datos privados: solo usuarios autenticados (filtrados por RLS).
grant select, insert, update, delete on public.workers, public.worker_private to authenticated;
grant select, insert, update, delete on public.profiles, public.user_facility_scopes to authenticated;
grant select, insert, update, delete on public.shifts, public.shift_assignments to authenticated;
grant select, insert, update, delete on public.incident_notes to authenticated;
-- Asistencia, correcciones y bitácora: solo lectura directa; escritura por funciones.
grant select on public.attendance_sessions, public.correction_requests, public.audit_log to authenticated;
grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;

-- -----------------------------------------------------------------------------
-- Políticas
-- -----------------------------------------------------------------------------

-- Catálogos geográficos y categorías
create policy states_read on public.states for select to anon, authenticated using (true);
create policy states_admin_write on public.states for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy municipalities_read on public.municipalities for select to anon, authenticated using (true);
create policy municipalities_admin_write on public.municipalities for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy categories_read on public.facility_categories for select to anon, authenticated using (true);
create policy categories_admin_write on public.facility_categories for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Instalaciones
create policy facilities_public_read on public.facilities for select to anon
  using (is_public and active);
create policy facilities_auth_read on public.facilities for select to authenticated
  using ((is_public and active) or app.can_see_facility(id));
create policy facilities_admin_insert on public.facilities for insert to authenticated
  with check ((select app.is_admin()));
create policy facilities_admin_update on public.facilities for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy facilities_admin_delete on public.facilities for delete to authenticated
  using ((select app.is_admin()));

-- Trabajadores
-- La columna facility_id se evalúa directamente para que INSERT ... RETURNING
-- vea la fila nueva (las funciones auxiliares no ven filas del mismo comando).
create policy workers_read on public.workers for select to authenticated
  using (app.has_scope(facility_id) or app.can_see_worker(id));
create policy workers_insert on public.workers for insert to authenticated
  with check (app.can_manage(facility_id));
create policy workers_update on public.workers for update to authenticated
  using (app.can_manage(facility_id)) with check (app.can_manage(facility_id));
create policy workers_delete on public.workers for delete to authenticated
  using ((select app.is_admin()));

-- Datos privados del trabajador (sin acceso para auditoría)
create policy worker_private_read on public.worker_private for select to authenticated
  using (worker_id = (select app.my_worker_id()) or app.can_manage(app.worker_facility(worker_id)));
create policy worker_private_insert on public.worker_private for insert to authenticated
  with check (app.can_manage(app.worker_facility(worker_id)));
create policy worker_private_update on public.worker_private for update to authenticated
  using (app.can_manage(app.worker_facility(worker_id)))
  with check (app.can_manage(app.worker_facility(worker_id)));
create policy worker_private_delete on public.worker_private for delete to authenticated
  using (app.can_manage(app.worker_facility(worker_id)));

-- Perfiles: cada quien ve el suyo; coordinación ve los de su personal; solo admin modifica.
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select app.is_admin())
    or (worker_id is not null and app.has_scope(app.worker_facility(worker_id)))
  );
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check ((select app.is_admin()));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using ((select app.is_admin()));

-- Alcance por sede
create policy scopes_read on public.user_facility_scopes for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
create policy scopes_admin_write on public.user_facility_scopes for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Guardias
create policy shifts_read on public.shifts for select to authenticated
  using (app.has_scope(facility_id) or app.is_my_shift(id));
create policy shifts_insert on public.shifts for insert to authenticated
  with check (app.can_manage(facility_id));
create policy shifts_update on public.shifts for update to authenticated
  using (app.can_manage(facility_id)) with check (app.can_manage(facility_id));
create policy shifts_delete on public.shifts for delete to authenticated
  using (app.can_manage(facility_id));

-- Asignaciones: el trabajador solo ve las suyas.
create policy assignments_read on public.shift_assignments for select to authenticated
  using (worker_id = (select app.my_worker_id()) or app.has_scope(app.shift_facility(shift_id)));
create policy assignments_insert on public.shift_assignments for insert to authenticated
  with check (app.can_manage(app.shift_facility(shift_id)));
create policy assignments_update on public.shift_assignments for update to authenticated
  using (app.can_manage(app.shift_facility(shift_id)))
  with check (app.can_manage(app.shift_facility(shift_id)));
create policy assignments_delete on public.shift_assignments for delete to authenticated
  using (app.can_manage(app.shift_facility(shift_id)));

-- Asistencia: lectura propia o por alcance. Sin escritura directa.
create policy attendance_read on public.attendance_sessions for select to authenticated
  using (worker_id = (select app.my_worker_id()) or app.has_scope(facility_id));

-- Correcciones
create policy corrections_read on public.correction_requests for select to authenticated
  using (worker_id = (select app.my_worker_id()) or app.has_scope(facility_id));

-- Justificaciones de incidencias
create policy incident_notes_read on public.incident_notes for select to authenticated
  using (
    app.has_scope(facility_id)
    or exists (
      select 1 from public.shift_assignments a
      where a.id = assignment_id and a.worker_id = (select app.my_worker_id())
    )
  );
create policy incident_notes_write on public.incident_notes for all to authenticated
  using (app.can_manage(facility_id)) with check (app.can_manage(facility_id));

-- Bitácora: administración completa; coordinación y auditoría solo de sus sedes
-- (los cambios de datos privados de contacto solo los ve administración).
create policy audit_read on public.audit_log for select to authenticated
  using (
    (select app.is_admin())
    or (
      facility_id is not null
      and table_name not in ('worker_private', 'profiles', 'user_facility_scopes')
      and app.has_scope(facility_id)
    )
  );

-- Configuración
create policy settings_public_read on public.app_settings for select to anon
  using (is_public);
create policy settings_auth_read on public.app_settings for select to authenticated
  using (is_public or (select app.my_role()) is not null);
create policy settings_admin_insert on public.app_settings for insert to authenticated
  with check ((select app.is_admin()));
create policy settings_admin_update on public.app_settings for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- -----------------------------------------------------------------------------
-- Vista del directorio público
-- -----------------------------------------------------------------------------
create view public.public_facilities
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
  case when f.services_verified then f.services else '{}'::text[] end as services,
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

comment on view public.public_facilities is 'Directorio público de instalaciones. Nunca incluye trabajadores, teléfonos personales ni guardias.';
grant select on public.public_facilities to anon, authenticated;
