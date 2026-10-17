-- =============================================================================
-- Separación de funciones: cierre de caminos alternos
-- Coordinación no puede quitarse de una guardia, borrar justificaciones de su
-- propia asistencia, ni cancelar o reprogramar una guardia en la que está
-- asignada. Tampoco se cancela una guardia con asistencia vigente (coherente con
-- set_assignment_status). Administración y la llave de servicio no se afectan.
-- =============================================================================

create or replace function app.block_own_assignment_changes()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'shift_assignments' then
    if tg_op = 'DELETE' then
      perform app.assert_not_own_record(old.worker_id);
      return old;
    end if;
    -- UPDATE: solo se permite tocar el motivo (clearStoredReason) en la propia asignación.
    if (new.assigned_point, new.substitute_for_worker_id, new.notes, new.status, new.status_reason)
       is distinct from (old.assigned_point, old.substitute_for_worker_id, old.notes, old.status, old.status_reason) then
      perform app.assert_not_own_record(old.worker_id);
    end if;
    return new;
  end if;

  -- incident_notes (DELETE). En un borrado en cascada la asignación ya no existe y pasa.
  perform app.assert_not_own_record(
    (select a.worker_id from public.shift_assignments a where a.id = old.assignment_id)
  );
  return old;
end;
$$;

create trigger shift_assignments_no_own_changes before update or delete on public.shift_assignments
  for each row execute function app.block_own_assignment_changes();
create trigger incident_notes_no_own_delete before delete on public.incident_notes
  for each row execute function app.block_own_assignment_changes();

create or replace function app.guard_protected_columns()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin boolean := app.is_admin();
  v_is_service boolean := auth.uid() is null; -- migraciones, seed y llave de servicio
begin
  if not v_admin and not v_is_service then
    if tg_op = 'INSERT' then
      new.is_demo := false;
      new.created_by := auth.uid();
    elsif new.is_demo is distinct from old.is_demo or new.created_by is distinct from old.created_by then
      raise exception 'Solo administración puede cambiar ese campo' using errcode = '42501';
    end if;
  end if;

  if tg_table_name = 'shifts' and tg_op = 'UPDATE' then
    if new.facility_id <> old.facility_id
       and exists (select 1 from public.shift_assignments a where a.shift_id = old.id) then
      raise exception 'No se puede cambiar la sede de una guardia que ya tiene asignaciones' using errcode = '22023';
    end if;

    if not v_admin and not v_is_service then
      -- El horario programado se conserva cuando ya hay asistencia registrada.
      if (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at)
         and exists (
           select 1 from public.attendance_sessions s
           where s.shift_id = old.id and s.record_status = 'vigente'
         ) then
        raise exception 'La guardia ya tiene registros de asistencia: su horario solo lo puede cambiar administración' using errcode = '22023';
      end if;

      -- Nadie cancela, finaliza o reprograma una guardia en la que está asignado.
      if (new.status is distinct from old.status or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at)
         and app.my_worker_id() is not null
         and exists (
           select 1 from public.shift_assignments a
           where a.shift_id = old.id and a.worker_id = app.my_worker_id()
         ) then
        raise exception 'No puedes cancelar, finalizar ni reprogramar una guardia en la que estás asignado. Pide a otra persona de coordinación o a administración.'
          using errcode = '42501';
      end if;

      -- No se cancela una guardia con asistencia vigente: primero se corrige o anula.
      if new.status = 'cancelada' and old.status <> 'cancelada'
         and exists (
           select 1 from public.attendance_sessions s
           where s.shift_id = old.id and s.record_status = 'vigente'
         ) then
        raise exception 'La guardia tiene registros de asistencia vigentes; corrígelos o anúlalos antes de cancelarla' using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Borrar una guardia en la que uno está asignado: lo impide el trigger de
-- shift_assignments al borrarse en cascada sus asignaciones.

-- Las funciones que se creen después nacen sin EXECUTE para PUBLIC (todas las
-- funciones, no solo las de public). Las que necesiten acceso lo otorgan explícitamente.
alter default privileges for role postgres revoke execute on functions from public;
