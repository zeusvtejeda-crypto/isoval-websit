-- =============================================================================
-- Plataforma de guardias y directorio de instalaciones
-- Esquema base: catálogos, instalaciones, trabajadores, cuentas, guardias,
-- asistencia, correcciones, incidencias, bitácora y configuración.
--
-- AVISO: Esta plataforma NO es una aplicación oficial del IMSS.
-- Todas las fechas se guardan en UTC (timestamptz) y se muestran en la zona
-- horaria de cada sede.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
comment on schema app is 'Funciones auxiliares internas (permisos, utilidades). No se expone por la API.';

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'coordinador', 'trabajador', 'auditor');
comment on type public.app_role is 'admin = Administrador general; coordinador = sedes asignadas; trabajador = sus propios registros; auditor = consulta de solo lectura.';

create type public.verification_status as enum ('verificado', 'pendiente');
create type public.shift_status as enum ('programada', 'en_curso', 'finalizada', 'cancelada');
create type public.assignment_status as enum ('asignado', 'ausencia_justificada', 'inasistencia_confirmada', 'cancelado');
create type public.attendance_method as enum ('propio', 'coordinador', 'qr', 'correccion');
create type public.record_status as enum ('vigente', 'corregido', 'anulado');
create type public.correction_status as enum ('pendiente', 'aprobada', 'rechazada');
create type public.incident_type as enum (
  'llegada_tardia',
  'salida_anticipada',
  'permanencia_adicional',
  'sustitucion',
  'correccion_administrativa',
  'registro_incompleto'
);

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------
create or replace function app.normalize_text(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑÀÈÌÒÙáéíóúüñàèìòù', 'AEIOUUNAEIOUaeiouunaeiou')),
      '\s+', ' ', 'g')),
    '')
$$;
comment on function app.normalize_text(text) is 'Normaliza texto para detectar duplicados: sin acentos, minúsculas y espacios simples.';

-- -----------------------------------------------------------------------------
-- Catálogos geográficos (estructura nacional; configuración inicial Nayarit)
-- -----------------------------------------------------------------------------
create table public.states (
  id smallint primary key check (id between 1 and 99),
  name text not null unique,
  abbreviation text not null unique,
  default_timezone text not null default 'America/Mexico_City',
  enabled boolean not null default false
);
comment on table public.states is 'Entidades federativas (clave INEGI). enabled indica cobertura activa de la plataforma.';

create table public.municipalities (
  id integer generated always as identity primary key,
  state_id smallint not null references public.states (id) on delete restrict,
  inegi_code text not null check (inegi_code ~ '^\d{3}$'),
  name text not null check (char_length(btrim(name)) > 0),
  timezone text,
  unique (state_id, inegi_code),
  unique (state_id, name),
  unique (id, state_id)
);
create index municipalities_state_idx on public.municipalities (state_id);
comment on column public.municipalities.timezone is 'Zona horaria si difiere de la del estado (p. ej. Bahía de Banderas).';

-- -----------------------------------------------------------------------------
-- Categorías de instalaciones (editables)
-- -----------------------------------------------------------------------------
create table public.facility_categories (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null unique check (char_length(btrim(name)) between 2 and 120),
  description text,
  icon text not null default 'building',
  color text not null default '#166534' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Instalaciones (sedes)
-- -----------------------------------------------------------------------------
create sequence public.facility_code_seq;

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null unique
    default ('INS-' || lpad(nextval('public.facility_code_seq')::text, 6, '0')),
  official_name text not null check (char_length(btrim(official_name)) between 3 and 300),
  normalized_name text generated always as (app.normalize_text(official_name)) stored,
  unit_key text check (unit_key is null or char_length(btrim(unit_key)) between 1 and 60),
  category_id smallint not null references public.facility_categories (id) on delete restrict,
  description text,
  state_id smallint not null references public.states (id) on delete restrict,
  municipality_id integer,
  address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  phone text,
  schedule text,
  services text[] not null default '{}',
  services_verified boolean not null default false,
  source text not null default 'Captura manual' check (char_length(btrim(source)) > 0),
  source_url text,
  last_verified_at date,
  verification_status public.verification_status not null default 'pendiente',
  notes text,
  timezone text not null default 'America/Mazatlan',
  arrival_tolerance_minutes integer not null default 10 check (arrival_tolerance_minutes between 0 and 240),
  is_public boolean not null default true,
  is_demo boolean not null default false,
  active boolean not null default true,
  change_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  constraint facilities_municipality_state_fk
    foreign key (municipality_id, state_id) references public.municipalities (id, state_id) on delete restrict,
  constraint facilities_coords_pair check ((latitude is null) = (longitude is null)),
  constraint facilities_verified_requires_date check (verification_status = 'pendiente' or last_verified_at is not null)
);
comment on table public.facilities is 'Instalaciones / sedes. Directorio público: solo filas is_public y active. Datos de demostración: is_demo = true.';
comment on column public.facilities.services is 'Servicios. Solo se muestran públicamente si services_verified = true.';
comment on column public.facilities.change_reason is 'Motivo del último cambio (se copia a la bitácora).';

create unique index facilities_unit_key_uq on public.facilities (upper(btrim(unit_key))) where unit_key is not null;
create unique index facilities_name_place_uq on public.facilities (normalized_name, state_id, coalesce(municipality_id, 0));
create index facilities_category_idx on public.facilities (category_id);
create index facilities_state_idx on public.facilities (state_id);
create index facilities_municipality_idx on public.facilities (municipality_id);
create index facilities_demo_idx on public.facilities (is_demo);

-- -----------------------------------------------------------------------------
-- Trabajadores (registro independiente de la cuenta de acceso)
-- -----------------------------------------------------------------------------
create sequence public.worker_code_seq;

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null unique
    default ('TRA-' || lpad(nextval('public.worker_code_seq')::text, 6, '0')),
  full_name text not null check (char_length(btrim(full_name)) between 3 and 200),
  normalized_name text generated always as (app.normalize_text(full_name)) stored,
  state_id smallint not null references public.states (id) on delete restrict,
  municipality_id integer,
  facility_id uuid references public.facilities (id) on delete restrict,
  area text,
  position text,
  usual_shift text,
  active boolean not null default true,
  is_demo boolean not null default false,
  change_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  constraint workers_municipality_state_fk
    foreign key (municipality_id, state_id) references public.municipalities (id, state_id) on delete restrict
);
comment on table public.workers is 'Directorio PRIVADO de trabajadores. Organizados por entidad federativa. No se recopilan CURP, datos médicos ni biométricos.';
create index workers_facility_idx on public.workers (facility_id);
create index workers_state_idx on public.workers (state_id);
create index workers_name_idx on public.workers (normalized_name);

-- Datos de contacto e identificación laboral: tabla aparte con acceso más restringido.
create table public.worker_private (
  worker_id uuid primary key references public.workers (id) on delete cascade,
  employee_number text check (employee_number is null or char_length(btrim(employee_number)) between 1 and 40),
  phone text check (phone is null or phone ~ '^[0-9 +()\-]{7,20}$'),
  change_reason text,
  updated_at timestamptz not null default now()
);
comment on table public.worker_private is 'Número de trabajador y teléfono (opcionales, privados). Solo administración, coordinación de su sede y el propio trabajador.';
create unique index worker_private_employee_number_uq
  on public.worker_private (upper(btrim(employee_number))) where employee_number is not null;

-- -----------------------------------------------------------------------------
-- Cuentas de acceso y alcance por sede
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  worker_id uuid unique references public.workers (id) on delete set null,
  role public.app_role not null default 'trabajador',
  display_name text,
  active boolean not null default true,
  change_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Cuenta de acceso (1:1 con auth.users). Un trabajador puede existir sin cuenta.';

create table public.user_facility_scopes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  facility_id uuid not null references public.facilities (id) on delete cascade,
  granted_by uuid default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (user_id, facility_id)
);
comment on table public.user_facility_scopes is 'Sedes asignadas a coordinadores y auditores.';
create index user_facility_scopes_facility_idx on public.user_facility_scopes (facility_id);

-- -----------------------------------------------------------------------------
-- Guardias
-- -----------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete restrict,
  title text,
  meeting_point text not null check (char_length(btrim(meeting_point)) between 2 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  responsible_worker_id uuid references public.workers (id) on delete set null,
  min_staff integer not null default 1 check (min_staff between 0 and 1000),
  max_staff integer check (max_staff is null or max_staff between 1 and 1000),
  instructions text,
  status public.shift_status not null default 'programada',
  cancel_reason text,
  is_demo boolean not null default false,
  change_reason text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_time_order check (ends_at > starts_at),
  constraint shifts_max_duration check (ends_at - starts_at <= interval '48 hours'),
  constraint shifts_staff_range check (max_staff is null or max_staff >= min_staff),
  constraint shifts_cancel_reason check (status <> 'cancelada' or char_length(btrim(coalesce(cancel_reason, ''))) > 0)
);
comment on table public.shifts is 'Guardias. starts_at/ends_at en UTC; pueden cruzar medianoche (máx. 48 h).';
create index shifts_facility_start_idx on public.shifts (facility_id, starts_at);
create index shifts_range_idx on public.shifts using gist (tstzrange(starts_at, ends_at));
create unique index shifts_no_duplicate_uq
  on public.shifts (facility_id, app.normalize_text(meeting_point), starts_at, ends_at)
  where status <> 'cancelada';

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete restrict,
  assigned_point text,
  substitute_for_worker_id uuid references public.workers (id) on delete set null,
  status public.assignment_status not null default 'asignado',
  status_reason text,
  status_changed_by uuid,
  status_changed_at timestamptz,
  notes text,
  change_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_assignments_unique unique (shift_id, worker_id),
  constraint shift_assignments_not_self_substitute
    check (substitute_for_worker_id is null or substitute_for_worker_id <> worker_id),
  constraint shift_assignments_reason_required
    check (status in ('asignado', 'cancelado') or char_length(btrim(coalesce(status_reason, ''))) > 0)
);
create index shift_assignments_worker_idx on public.shift_assignments (worker_id);
create index shift_assignments_shift_idx on public.shift_assignments (shift_id);

-- -----------------------------------------------------------------------------
-- Sesiones de asistencia (entrada/salida). Solo se escriben mediante funciones.
-- -----------------------------------------------------------------------------
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments (id) on delete restrict,
  shift_id uuid not null references public.shifts (id) on delete restrict,
  worker_id uuid not null references public.workers (id) on delete restrict,
  facility_id uuid not null references public.facilities (id) on delete restrict,
  check_in_at timestamptz not null,
  check_out_at timestamptz,
  check_in_method public.attendance_method not null,
  check_out_method public.attendance_method,
  check_in_by uuid not null,
  check_out_by uuid,
  check_in_reason text,
  check_out_reason text,
  check_in_request_id uuid not null,
  check_out_request_id uuid,
  notes text,
  record_status public.record_status not null default 'vigente',
  supersedes_id uuid references public.attendance_sessions (id),
  status_reason text,
  status_changed_by uuid,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_check_in_request_uq unique (check_in_request_id),
  constraint attendance_check_out_request_uq unique (check_out_request_id),
  constraint attendance_out_after_in check (check_out_at is null or check_out_at > check_in_at),
  constraint attendance_out_fields check (
    (check_out_at is null) = (check_out_method is null)
    and (check_out_at is null) = (check_out_by is null)
  ),
  constraint attendance_status_reason check (record_status = 'vigente' or char_length(btrim(coalesce(status_reason, ''))) > 0)
);
comment on table public.attendance_sessions is 'Entradas y salidas. Una guardia puede tener varias sesiones (salida y regreso). Las correcciones crean una versión nueva y conservan la original (record_status = corregido).';
comment on column public.attendance_sessions.check_in_at is 'Hora del servidor (UTC) cuando se registró en línea. "Entrada registrada" no equivale a presencia física verificada.';

-- Anti-duplicados: una sola entrada abierta por trabajador y sin traslapes.
create unique index attendance_one_open_per_worker
  on public.attendance_sessions (worker_id)
  where check_out_at is null and record_status = 'vigente';
alter table public.attendance_sessions
  add constraint attendance_no_overlap
  exclude using gist (
    worker_id with =,
    tstzrange(check_in_at, coalesce(check_out_at, 'infinity'::timestamptz), '[)') with &&
  ) where (record_status = 'vigente');

create index attendance_assignment_idx on public.attendance_sessions (assignment_id);
create index attendance_shift_idx on public.attendance_sessions (shift_id);
create index attendance_facility_time_idx on public.attendance_sessions (facility_id, check_in_at);
create index attendance_worker_time_idx on public.attendance_sessions (worker_id, check_in_at);
create index attendance_supersedes_idx on public.attendance_sessions (supersedes_id);

-- -----------------------------------------------------------------------------
-- Solicitudes de corrección
-- -----------------------------------------------------------------------------
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments (id) on delete cascade,
  session_id uuid references public.attendance_sessions (id) on delete cascade,
  worker_id uuid not null references public.workers (id) on delete cascade,
  facility_id uuid not null references public.facilities (id) on delete cascade,
  requested_by uuid not null,
  requested_check_in_at timestamptz,
  requested_check_out_at timestamptz,
  reason text not null check (char_length(btrim(reason)) >= 5),
  status public.correction_status not null default 'pendiente',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  resulting_session_id uuid references public.attendance_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint correction_requests_times check (
    requested_check_out_at is null or requested_check_in_at is null or requested_check_out_at > requested_check_in_at
  ),
  constraint correction_requests_review check (
    (status = 'pendiente') = (reviewed_at is null)
  )
);
create unique index correction_requests_one_pending_per_session
  on public.correction_requests (session_id) where status = 'pendiente' and session_id is not null;
create index correction_requests_facility_idx on public.correction_requests (facility_id, status);
create index correction_requests_worker_idx on public.correction_requests (worker_id);

-- -----------------------------------------------------------------------------
-- Justificaciones de incidencias calculadas
-- -----------------------------------------------------------------------------
create table public.incident_notes (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments (id) on delete cascade,
  facility_id uuid not null references public.facilities (id) on delete cascade,
  incident_type public.incident_type not null,
  note text not null check (char_length(btrim(note)) >= 3),
  justified boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incident_notes_unique unique (assignment_id, incident_type)
);

-- -----------------------------------------------------------------------------
-- Bitácora de auditoría (solo inserción mediante triggers)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'PURGE')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  reason text,
  facility_id uuid
);
comment on table public.audit_log is 'Bitácora inmutable: autor, fecha, valor anterior, valor nuevo y motivo.';
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_facility_idx on public.audit_log (facility_id, occurred_at desc);
create index audit_log_time_idx on public.audit_log (occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- -----------------------------------------------------------------------------
-- Configuración de la aplicación
-- -----------------------------------------------------------------------------
create table public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  value jsonb not null,
  description text,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
comment on table public.app_settings is 'Configuración: aviso de privacidad, conservación de datos, ventanas de registro.';
