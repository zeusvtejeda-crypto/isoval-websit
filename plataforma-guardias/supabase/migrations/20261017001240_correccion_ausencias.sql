-- =============================================================================
-- Solicitudes de corrección sobre ausencias
-- Una persona puede impugnar una «Ausencia justificada» o una «Inasistencia
-- confirmada» si sí asistió: solicita un registro nuevo con sus horas reales.
-- Al aprobarla, review_correction regresa la asignación a «Asignado» (motivo,
-- quién y cuándo; queda en la bitácora) y agrega el registro, todo en la misma
-- transacción. Si algo falla, nada cambia.
-- - request_correction: rechaza guardias o asignaciones canceladas (nadie podría
--   aprobarlas), exige ambas horas cuando no hay registro de referencia (lo que
--   pide add_manual_attendance al aprobar) y aplica la ventana de la guardia.
-- - review_correction: conserva todas las verificaciones anteriores
--   (alcance, separación de funciones, motivo del rechazo, bitácora).
-- No hay tipos de solicitud: con registro de referencia es un ajuste; sin él,
-- un registro nuevo. Una asignación en ausencia no tiene registros vigentes
-- (set_assignment_status lo impide), así que solo admite un registro nuevo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- request_correction
-- -----------------------------------------------------------------------------
create or replace function public.request_correction(
  p_assignment_id uuid,
  p_session_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text
)
returns public.correction_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_session public.attendance_sessions;
  v_request public.correction_requests;
begin
  v_profile := app.require_profile();
  select * into v_assignment from public.shift_assignments where id = p_assignment_id;
  if not found then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  select * into v_shift from public.shifts where id = v_assignment.shift_id;
  if not (
    (v_profile.worker_id is not null and v_profile.worker_id = v_assignment.worker_id)
    or app.can_manage(v_shift.facility_id)
  ) then
    raise exception 'Solo puedes solicitar correcciones de tus propios registros' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Describe el motivo (mínimo 5 caracteres)' using errcode = '22023';
  end if;
  -- Nadie podría aprobarlas (add_manual_attendance y correct_attendance las rechazan).
  if v_shift.status = 'cancelada' then
    raise exception 'La guardia está cancelada: no se pueden solicitar correcciones de esta guardia.' using errcode = '22023';
  end if;
  if v_assignment.status = 'cancelado' then
    raise exception 'La asignación está cancelada: no se pueden solicitar correcciones de esta guardia.' using errcode = '22023';
  end if;
  if p_check_in_at is null and p_check_out_at is null then
    raise exception 'Indica al menos la hora de entrada o de salida correcta' using errcode = '22023';
  end if;
  -- Sin registro de referencia se agrega uno nuevo: requiere ambas horas.
  if p_session_id is null and (p_check_in_at is null or p_check_out_at is null) then
    raise exception 'Para solicitar un registro nuevo indica la hora de entrada y la de salida' using errcode = '22023';
  end if;
  if p_check_in_at is not null and p_check_out_at is not null and p_check_out_at <= p_check_in_at then
    raise exception 'La salida debe ser posterior a la entrada' using errcode = '22023';
  end if;
  if (p_check_in_at is not null and p_check_in_at > now()) or (p_check_out_at is not null and p_check_out_at > now()) then
    raise exception 'No se pueden solicitar horas futuras' using errcode = '22023';
  end if;
  -- Misma ventana que se valida al aprobar (las horas vacías no se comparan).
  perform app.assert_within_shift(v_shift, p_check_in_at, p_check_out_at);
  if p_session_id is not null then
    select * into v_session from public.attendance_sessions where id = p_session_id;
    if not found or v_session.assignment_id <> p_assignment_id then
      raise exception 'El registro no corresponde a la asignación' using errcode = '22023';
    end if;
    if v_session.record_status <> 'vigente' then
      raise exception 'Ese registro ya fue corregido o anulado' using errcode = '22023';
    end if;
  end if;

  insert into public.correction_requests (
    assignment_id, session_id, worker_id, facility_id, requested_by,
    requested_check_in_at, requested_check_out_at, reason
  ) values (
    v_assignment.id, p_session_id, v_assignment.worker_id, v_shift.facility_id, v_profile.id,
    p_check_in_at, p_check_out_at, btrim(p_reason)
  )
  returning * into v_request;
  return v_request;
exception
  when unique_violation then
    raise exception 'Ya existe una solicitud pendiente para ese registro' using errcode = '23505';
end;
$$;

-- -----------------------------------------------------------------------------
-- review_correction: aprobar un registro nuevo revierte la ausencia
-- -----------------------------------------------------------------------------
create or replace function public.review_correction(
  p_request_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns public.correction_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_request public.correction_requests;
  v_session public.attendance_sessions;
  v_assignment public.shift_assignments;
  v_shift public.shifts;
  v_result jsonb;
  v_resulting uuid;
  v_in timestamptz;
  v_out timestamptz;
  v_reason text;
  v_review text;
  v_status_reason text;
begin
  v_profile := app.require_profile();
  select * into v_request from public.correction_requests where id = p_request_id for update;
  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if not app.can_manage(v_request.facility_id) then
    raise exception 'No tienes permiso para revisar solicitudes de esta sede' using errcode = '42501';
  end if;
  if v_request.requested_by = v_profile.id and not app.is_admin() then
    raise exception 'No puedes revisar una solicitud que tú hiciste' using errcode = '42501';
  end if;
  perform app.assert_not_own_record(v_request.worker_id);
  if v_request.status <> 'pendiente' then
    raise exception 'La solicitud ya fue revisada' using errcode = '22023';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_notes, ''))) < 3 then
    raise exception 'Indica el motivo del rechazo' using errcode = '22023';
  end if;

  v_review := case when nullif(btrim(p_notes), '') is not null then ' / Revisión: ' || btrim(p_notes) else '' end;
  v_reason := 'Solicitud de corrección aprobada: ' || v_request.reason || v_review;

  if p_approve then
    if v_request.session_id is not null then
      select * into v_session from public.attendance_sessions where id = v_request.session_id;
      v_in := coalesce(v_request.requested_check_in_at, v_session.check_in_at);
      v_out := coalesce(v_request.requested_check_out_at, v_session.check_out_at);
      v_result := public.correct_attendance(v_request.session_id, v_in, v_out, v_reason, null);
    else
      select * into v_assignment from public.shift_assignments where id = v_request.assignment_id for update;
      -- La persona sí asistió: la asignación vuelve a «Asignado» antes de agregar el registro.
      if v_assignment.status in ('ausencia_justificada', 'inasistencia_confirmada') then
        select * into v_shift from public.shifts where id = v_assignment.shift_id;
        if v_shift.status = 'cancelada' then
          raise exception 'La guardia está cancelada' using errcode = '22023';
        end if;
        v_status_reason := 'Se revierte «'
          || case v_assignment.status when 'ausencia_justificada' then 'Ausencia justificada' else 'Inasistencia confirmada' end
          || '» al aprobar una solicitud de corrección. Motivo de la solicitud: ' || v_request.reason || v_review;
        perform set_config('app.change_reason', v_status_reason, true);
        begin
          update public.shift_assignments
          set status = 'asignado',
              status_reason = v_status_reason,
              status_changed_by = v_profile.id,
              status_changed_at = now()
          where id = v_assignment.id;
        exception
          when check_violation then
            raise exception 'No se puede revertir la ausencia: la guardia ya alcanzó su cupo máximo. Ajusta el cupo o las asignaciones y vuelve a intentarlo.'
              using errcode = '23514';
        end;
      end if;
      v_result := public.add_manual_attendance(
        v_request.assignment_id, v_request.requested_check_in_at, v_request.requested_check_out_at,
        v_reason, gen_random_uuid(), null
      );
    end if;
    v_resulting := (v_result -> 'session' ->> 'id')::uuid;
  end if;

  update public.correction_requests
  set status = case when p_approve then 'aprobada'::public.correction_status else 'rechazada'::public.correction_status end,
      reviewed_by = v_profile.id,
      reviewed_at = now(),
      review_notes = nullif(btrim(p_notes), ''),
      resulting_session_id = v_resulting
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.request_correction(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.review_correction(uuid, boolean, text) from public, anon;
grant execute on function public.request_correction(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.review_correction(uuid, boolean, text) to authenticated;
