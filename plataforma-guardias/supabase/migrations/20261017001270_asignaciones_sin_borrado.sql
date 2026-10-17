-- Una asignación con historia no se borra: si ya tiene un estado registrado
-- (ausencia justificada, inasistencia confirmada, cancelada), registros de
-- asistencia, justificaciones o solicitudes de corrección, borrarla eliminaría
-- en cascada esas constancias del historial y de los reportes. En su lugar se
-- cambia su estado a «Asignación cancelada» con motivo (queda en la bitácora).
-- Solo las depuraciones autorizadas (retención y datos de demostración, con
-- app.allow_purge) pueden quitarlas. También aplica a la cascada al borrar una guardia.

create or replace function app.block_assignment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_purge', true), '') = 'on' then
    return old;
  end if;
  -- SECURITY DEFINER: las comprobaciones ven también filas que RLS ocultaría.
  if old.status <> 'asignado'
     or exists (select 1 from public.attendance_sessions where assignment_id = old.id)
     or exists (select 1 from public.incident_notes where assignment_id = old.id)
     or exists (select 1 from public.correction_requests where assignment_id = old.id) then
    raise exception 'La asignación tiene estado, registros, justificaciones o solicitudes registradas y no puede quitarse. Cambia su estado a «Asignación cancelada» con un motivo.'
      using errcode = '22023';
  end if;
  return old;
end;
$$;

revoke all on function app.block_assignment_delete() from public, anon, authenticated;

drop trigger if exists shift_assignments_block_delete on public.shift_assignments;
create trigger shift_assignments_block_delete
  before delete on public.shift_assignments
  for each row execute function app.block_assignment_delete();
