-- =============================================================================
-- Conservación de datos: también las copias en la bitácora
-- - El disparador de bitácora guarda copias completas de cada fila (old_data /
--   new_data). Al eliminar por conservación los datos privados de trabajadores
--   inactivos o las guardias antiguas con su asistencia, sus copias seguían
--   legibles en la bitácora hasta cumplir el periodo de la bitácora.
-- - apply_retention_policy ahora redacta esas copias: old_data queda vacío,
--   new_data solo indica la causa ({"redactado": "conservacion"}) y redacted_at
--   marca la fecha. Se conservan autor, fecha, tabla, registro, acción, campos
--   cambiados y motivo.
-- - La bitácora sigue siendo inmutable: la única modificación admitida es esa
--   redacción, solo durante una depuración autorizada (app.allow_purge).
-- - El cálculo sin eliminar informa cuántos eventos se redactarían y el evento
--   PURGE registra cuántos se redactaron.
-- - purge_demo_data redacta igual las copias de los datos de demostración
--   ({"redactado": "demostracion"}).
-- =============================================================================

alter table public.audit_log add column redacted_at timestamptz;
comment on column public.audit_log.redacted_at is
  'Fecha en que la política de conservación (o la eliminación de datos de demostración) borró el contenido del evento: old_data queda vacío y new_data solo indica la causa.';

-- -----------------------------------------------------------------------------
-- Inmutabilidad: solo se admite redactar el contenido durante una depuración
-- -----------------------------------------------------------------------------
create or replace function app.audit_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Redacción por conservación: vacía old_data/new_data una sola vez (new_data
    -- solo conserva la causa), sin tocar autor, fecha, tabla, registro, acción,
    -- campos cambiados ni motivo.
    if coalesce(current_setting('app.allow_purge', true), '') = 'on'
       and old.redacted_at is null
       and new.redacted_at is not null
       and new.old_data is null
       and new.new_data in ('{"redactado": "conservacion"}'::jsonb, '{"redactado": "demostracion"}'::jsonb)
       and (to_jsonb(new) - 'old_data' - 'new_data' - 'redacted_at') = (to_jsonb(old) - 'old_data' - 'new_data' - 'redacted_at') then
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

-- -----------------------------------------------------------------------------
-- Eventos de bitácora cuyas copias corresponden a datos que la política de
-- conservación elimina (uso interno de apply_retention_policy). Incluye los
-- datos ya eliminados antes (depuraciones previas o bajas) que cumplen el
-- mismo criterio, para que no queden copias de ellos.
-- -----------------------------------------------------------------------------
create or replace function app.retention_audit_targets(
  p_attendance_cutoff timestamptz,
  p_inactive_cutoff timestamptz,
  p_audit_cutoff timestamptz
)
returns setof bigint
language sql stable
set search_path = ''
as $$
  with purged_shifts as (
    -- Guardias terminadas antes del corte…
    select s.id::text as id from public.shifts s where s.ends_at < p_attendance_cutoff
    union
    -- …y guardias ya eliminadas cuyo último término conocido es anterior al corte.
    select x.record_id
    from (
      select distinct on (l.record_id) l.record_id, coalesce(l.new_data, l.old_data) ->> 'ends_at' as ends_at
      from public.audit_log l
      where l.table_name = 'shifts' and l.record_id is not null and l.redacted_at is null
      order by l.record_id, l.id desc
    ) x
    where x.ends_at is not null
      and x.ends_at::timestamptz < p_attendance_cutoff
      and not exists (select 1 from public.shifts s where s.id::text = x.record_id)
  ),
  purged_assignments as (
    select a.id::text as id from public.shift_assignments a where a.shift_id::text in (select id from purged_shifts)
    union
    select l.record_id from public.audit_log l
    where l.table_name = 'shift_assignments' and l.record_id is not null
      and coalesce(l.new_data, l.old_data) ->> 'shift_id' in (select id from purged_shifts)
  ),
  purged_private as (
    -- Mismo criterio que la eliminación de worker_private (trabajador inactivo,
    -- sin cambios ni guardias desde el corte), exista o no todavía la fila…
    select w.id::text as id
    from public.workers w
    where not w.active
      and w.updated_at < p_inactive_cutoff
      and not exists (
        select 1 from public.shift_assignments a join public.shifts s on s.id = a.shift_id
        where a.worker_id = w.id and s.ends_at >= p_inactive_cutoff
      )
    union
    -- …y trabajadores ya eliminados sin movimientos en sus datos privados desde el corte.
    select l.record_id
    from public.audit_log l
    where l.table_name = 'worker_private' and l.record_id is not null
      and not exists (select 1 from public.workers w where w.id::text = l.record_id)
    group by l.record_id
    having max(l.occurred_at) < p_inactive_cutoff
  )
  select l.id
  from public.audit_log l
  where l.redacted_at is null
    -- Los anteriores al corte de la bitácora se eliminan completos.
    and l.occurred_at >= p_audit_cutoff
    and (
      (l.table_name = 'worker_private' and l.record_id in (select id from purged_private))
      or (l.table_name = 'shifts' and l.record_id in (select id from purged_shifts))
      or (l.table_name in ('shift_assignments', 'attendance_sessions', 'attendance_qr_tokens')
          and (l.new_data ->> 'shift_id' in (select id from purged_shifts)
               or l.old_data ->> 'shift_id' in (select id from purged_shifts)))
      or (l.table_name in ('correction_requests', 'incident_notes')
          and (l.new_data ->> 'assignment_id' in (select id from purged_assignments)
               or l.old_data ->> 'assignment_id' in (select id from purged_assignments)))
    )
$$;

revoke all on function app.retention_audit_targets(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- Vacía el contenido de los eventos indicados y deja solo la causa
-- ('conservacion' o 'demostracion'). Debe correr con app.allow_purge.
create or replace function app.redact_audit_rows(p_ids bigint[], p_cause text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.audit_log
  set old_data = null, new_data = jsonb_build_object('redactado', p_cause), redacted_at = now()
  where id = any(p_ids) and redacted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.redact_audit_rows(bigint[], text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Política de conservación (redefinición de 20261017000700_endurecimiento)
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
  v_inactive_months integer := app.setting_int('retention', 'inactive_worker_months', 24);
  v_cutoff timestamptz;
  v_audit_cutoff timestamptz;
  v_inactive_cutoff timestamptz;
  v_shifts integer;
  v_sessions integer;
  v_audit integer;
  v_private integer;
  v_redact_ids bigint[];
  v_redacted integer;
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
  -- Copias en la bitácora de lo que se elimina (se calculan antes de eliminar).
  select coalesce(array_agg(t.id), '{}') into v_redact_ids
  from app.retention_audit_targets(v_cutoff, v_inactive_cutoff, v_audit_cutoff) as t(id);
  v_redacted := cardinality(v_redact_ids);

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
    v_redacted := app.redact_audit_rows(v_redact_ids, 'conservacion');
    perform set_config('app.allow_purge', 'off', true);
    insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, new_data, reason)
    values (auth.uid(), 'admin', 'retention', null, 'PURGE',
      jsonb_build_object('shifts', v_shifts, 'sessions', v_sessions, 'audit_rows', v_audit, 'worker_private_rows', v_private,
        'audit_rows_redacted', v_redacted,
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
    'worker_private_rows', v_private,
    'audit_rows_redacted', v_redacted
  );
end;
$$;

revoke all on function public.apply_retention_policy(boolean) from public, anon;
grant execute on function public.apply_retention_policy(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Datos de demostración (redefinición de 20261017001210_trabajadores_atomico_sede):
-- también se redactan las copias en la bitácora de las filas eliminadas.
-- -----------------------------------------------------------------------------
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
  v_redact_ids bigint[];
  v_redacted integer;
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

  -- Copias en la bitácora de lo que se elimina (se calculan antes de eliminar).
  with demo_facilities as (
    select f.id::text as id from public.facilities f where f.is_demo
  ), demo_workers as (
    select w.id::text as id from public.workers w where w.is_demo
  ), demo_shifts as (
    select s.id::text as id from public.shifts s
    where s.is_demo or s.facility_id in (select f.id from public.facilities f where f.is_demo)
  ), demo_assignments as (
    select a.id::text as id from public.shift_assignments a
    where a.worker_id::text in (select id from demo_workers) or a.shift_id::text in (select id from demo_shifts)
  )
  select coalesce(array_agg(l.id), '{}') into v_redact_ids
  from public.audit_log l
  where l.redacted_at is null
    and (
      (l.table_name = 'facilities' and l.record_id in (select id from demo_facilities))
      or (l.table_name in ('workers', 'worker_private') and l.record_id in (select id from demo_workers))
      or (l.table_name = 'shifts' and l.record_id in (select id from demo_shifts))
      or (l.table_name in ('shift_assignments', 'attendance_sessions', 'correction_requests', 'incident_notes', 'attendance_qr_tokens')
          and (coalesce(l.new_data, l.old_data) ->> 'shift_id' in (select id from demo_shifts)
               or coalesce(l.new_data, l.old_data) ->> 'worker_id' in (select id from demo_workers)
               or coalesce(l.new_data, l.old_data) ->> 'facility_id' in (select id from demo_facilities)
               or coalesce(l.new_data, l.old_data) ->> 'assignment_id' in (select id from demo_assignments)))
    );

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
  v_redacted := app.redact_audit_rows(v_redact_ids, 'demostracion');

  perform set_config('app.allow_purge', 'off', true);
  insert into public.audit_log (actor_id, actor_role, table_name, action, new_data, reason)
  values (auth.uid(), 'admin', 'demo_data', 'PURGE',
    jsonb_build_object('facilities', v_facilities, 'workers', v_workers, 'shifts', v_shifts, 'audit_rows_redacted', v_redacted),
    'Eliminación de datos de demostración');
  return jsonb_build_object('facilities', v_facilities, 'workers', v_workers, 'shifts', v_shifts, 'audit_rows_redacted', v_redacted);
end;
$$;

revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;
