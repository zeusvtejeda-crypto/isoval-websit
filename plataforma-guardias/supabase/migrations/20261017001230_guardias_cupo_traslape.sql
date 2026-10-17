-- =============================================================================
-- Guardias: cupo máximo y guardias traslapadas de una misma persona
-- - El cupo máximo no puede quedar por debajo de las personas asignadas
--   (antes solo se revisaba al asignar o reactivar una asignación).
-- - Una persona no puede tener dos asignaciones activas («Asignado») en guardias
--   no canceladas cuyos horarios se traslapan: el tiempo programado se contaba
--   dos veces y la segunda guardia la mostraba «Pendiente» aunque estaba en la
--   otra. Las guardias consecutivas (una termina cuando empieza la otra) sí se
--   permiten. Se revisa al asignar, al reactivar una asignación, al cambiar el
--   horario de una guardia y al reactivar una guardia cancelada.
-- - La persona sustituida («cubre a») debe ser visible para quien la captura.
-- Las asignaciones ya pueden corregirse (punto, sustitución y notas) con motivo:
-- los permisos por columna de 20261017000700 ya lo admiten y la bitácora guarda
-- los valores anterior y nuevo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Asignaciones: trabajador activo, cupo máximo, traslapes y persona sustituida
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
        select f.timezone into v_tz from public.facilities f where f.id = v_shift.facility_id;
        v_tz := coalesce(v_tz, 'America/Mazatlan');
        -- errcode 22023 (no 23514): quien captura check_violation lo interpreta como cupo máximo.
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

-- El trigger shift_assignments_check (20261017000200) ya ejecuta esta función.

-- -----------------------------------------------------------------------------
-- Guardias: cupo máximo frente a las asignaciones y traslapes al reprogramar
-- -----------------------------------------------------------------------------
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

-- Después de shifts_guard_columns (orden alfabético): los mensajes de permisos van primero.
create trigger shifts_staffing_check before update of max_staff, starts_at, ends_at, status on public.shifts
  for each row execute function app.check_shift_staffing();
