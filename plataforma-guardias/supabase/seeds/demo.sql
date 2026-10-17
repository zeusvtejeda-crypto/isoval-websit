-- =============================================================================
-- DATOS DE DEMOSTRACIÓN — NO SON DATOS REALES
-- Solo para desarrollo local (`supabase db reset`). Nunca cargar en producción.
-- Todas las filas llevan is_demo = true y nombres con el prefijo "[DEMO]".
-- Las coordenadas son aproximadas a cabeceras municipales y no señalan
-- instalaciones reales. Para eliminarlas: función public.purge_demo_data().
-- =============================================================================

do $$
declare
  v_hosp smallint := (select id from public.facility_categories where slug = 'hospitales');
  v_umf smallint := (select id from public.facility_categories where slug = 'umf');
  v_otras smallint := (select id from public.facility_categories where slug = 'otras-unidades-medicas');
  v_deleg smallint := (select id from public.facility_categories where slug = 'delegaciones');
  v_admin smallint := (select id from public.facility_categories where slug = 'oficinas-administrativas');
  v_otra smallint := (select id from public.facility_categories where slug = 'otras-instalaciones');
  m_tepic integer := (select id from public.municipalities where state_id = 18 and inegi_code = '017');
  m_xalisco integer := (select id from public.municipalities where state_id = 18 and inegi_code = '008');
  m_santiago integer := (select id from public.municipalities where state_id = 18 and inegi_code = '015');
  m_compostela integer := (select id from public.municipalities where state_id = 18 and inegi_code = '004');
  m_bahia integer := (select id from public.municipalities where state_id = 18 and inegi_code = '020');
  m_ixtlan integer := (select id from public.municipalities where state_id = 18 and inegi_code = '006');
  m_acaponeta integer := (select id from public.municipalities where state_id = 18 and inegi_code = '001');
  m_tuxpan integer := (select id from public.municipalities where state_id = 18 and inegi_code = '018');
  m_sanblas integer := (select id from public.municipalities where state_id = 18 and inegi_code = '012');
  m_tecuala integer := (select id from public.municipalities where state_id = 18 and inegi_code = '016');
  v_src text := 'Datos de demostración (ficticios). No usar como fuente.';
  f1 uuid := 'd0000000-0000-4000-8000-000000000001';
  f2 uuid := 'd0000000-0000-4000-8000-000000000002';
  f3 uuid := 'd0000000-0000-4000-8000-000000000003';
  w uuid[] := array[
    'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006',
    'd1000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000008'
  ]::uuid[];
  s_now uuid := 'd2000000-0000-4000-8000-000000000001';
  s_night uuid := 'd2000000-0000-4000-8000-000000000002';
  s_past uuid := 'd2000000-0000-4000-8000-000000000003';
  s_other uuid := 'd2000000-0000-4000-8000-000000000004';
  v_seed_actor uuid := '00000000-0000-4000-8000-00000000d3e0';
  v_today date := (now() at time zone 'America/Mazatlan')::date;
begin
  insert into public.facilities (id, official_name, unit_key, category_id, description, state_id, municipality_id,
    address, latitude, longitude, phone, schedule, services, services_verified, source, verification_status,
    notes, timezone, is_demo)
  values
    (f1, '[DEMO] Hospital de demostración A', 'DEMO-H01', v_hosp, 'Instalación ficticia para pruebas.', 18, m_tepic,
      'Domicilio de demostración 100, Tepic', 21.5090, -104.8890, null, 'Abierto 24 horas (dato ficticio)',
      '{}', false, v_src, 'pendiente', 'Dato de demostración.', 'America/Mazatlan', true),
    (f2, '[DEMO] Unidad de Medicina Familiar de demostración 1', 'DEMO-U01', v_umf, null, 18, m_tepic,
      'Domicilio de demostración 200, Tepic', 21.4990, -104.8990, null, null,
      '{}', false, v_src, 'pendiente', null, 'America/Mazatlan', true),
    (f3, '[DEMO] Unidad de Medicina Familiar de demostración 2', 'DEMO-U02', v_umf, null, 18, m_xalisco,
      'Domicilio de demostración 300, Xalisco', 21.4480, -104.8950, null, null,
      '{}', false, v_src, 'pendiente', null, 'America/Mazatlan', true);

  insert into public.facilities (official_name, unit_key, category_id, state_id, municipality_id, address,
    latitude, longitude, source, verification_status, timezone, is_demo)
  values
    ('[DEMO] Unidad de Medicina Familiar de demostración 3', 'DEMO-U03', v_umf, 18, m_santiago, 'Domicilio de demostración, Santiago Ixcuintla', 21.8150, -105.2030, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Unidad de Medicina Familiar de demostración 4', 'DEMO-U04', v_umf, 18, m_compostela, 'Domicilio de demostración, Compostela', 21.2420, -104.9050, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Hospital de demostración B', 'DEMO-H02', v_hosp, 18, m_bahia, 'Domicilio de demostración, Bahía de Banderas', 20.8010, -105.2500, v_src, 'pendiente', 'America/Bahia_Banderas', true),
    ('[DEMO] Unidad médica de demostración', 'DEMO-M01', v_otras, 18, m_ixtlan, 'Domicilio de demostración, Ixtlán del Río', 21.0390, -104.3650, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Oficina de representación de demostración', 'DEMO-D01', v_deleg, 18, m_tepic, 'Domicilio de demostración 400, Tepic', 21.5060, -104.8940, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Oficina administrativa de demostración', 'DEMO-A01', v_admin, 18, m_tepic, 'Domicilio de demostración 500, Tepic', 21.5120, -104.9020, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Unidad de Medicina Familiar de demostración 5', 'DEMO-U05', v_umf, 18, m_acaponeta, 'Domicilio de demostración, Acaponeta', 22.4990, -105.3550, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Unidad de Medicina Familiar de demostración 6', 'DEMO-U06', v_umf, 18, m_tuxpan, 'Domicilio de demostración, Tuxpan', 21.9470, -105.2980, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Unidad de Medicina Familiar de demostración 7', 'DEMO-U07', v_umf, 18, m_sanblas, 'Domicilio de demostración, San Blas', 21.5420, -105.2820, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Otra instalación de demostración', 'DEMO-O01', v_otra, 18, m_tecuala, 'Domicilio de demostración, Tecuala', 22.4010, -105.4550, v_src, 'pendiente', 'America/Mazatlan', true),
    ('[DEMO] Instalación sin coordenadas', 'DEMO-O02', v_otra, 18, m_tepic, 'Domicilio de demostración 600, Tepic', null, null, v_src, 'pendiente', 'America/Mazatlan', true);

  insert into public.workers (id, full_name, state_id, municipality_id, facility_id, area, position, usual_shift, is_demo) values
    (w[1], '[DEMO] Ana Martínez Ruiz', 18, m_tepic, f1, 'Enfermería', 'Enfermera general', 'Matutino', true),
    (w[2], '[DEMO] Luis Hernández Soto', 18, m_tepic, f1, 'Mantenimiento', 'Técnico', 'Vespertino', true),
    (w[3], '[DEMO] María López Díaz', 18, m_tepic, f1, 'Administración', 'Auxiliar administrativa', 'Matutino', true),
    (w[4], '[DEMO] Jorge Ramírez Cruz', 18, m_tepic, f1, 'Enfermería', 'Enfermero', 'Nocturno', true),
    (w[5], '[DEMO] Sofía Torres Vega', 18, m_tepic, f2, 'Medicina familiar', 'Asistente médica', 'Matutino', true),
    (w[6], '[DEMO] Carlos Gómez Peña', 18, m_tepic, f2, 'Farmacia', 'Auxiliar de farmacia', 'Vespertino', true),
    (w[7], '[DEMO] Patricia Flores Ortiz', 18, m_xalisco, f3, 'Archivo', 'Archivista', 'Matutino', true),
    (w[8], '[DEMO] Ricardo Morales León', 18, m_xalisco, f3, 'Intendencia', 'Auxiliar', 'Nocturno', true);

  insert into public.worker_private (worker_id, employee_number, phone) values
    (w[1], 'DEMO-0001', '311 000 0001'),
    (w[2], 'DEMO-0002', null),
    (w[5], 'DEMO-0005', '311 000 0005');

  -- Guardia en curso (inició hace 2 h, termina en 4 h)
  insert into public.shifts (id, facility_id, title, meeting_point, starts_at, ends_at, responsible_worker_id,
    min_staff, max_staff, instructions, is_demo)
  values (s_now, f1, '[DEMO] Guardia matutina', 'Acceso principal', date_trunc('minute', now()) - interval '2 hours',
    date_trunc('minute', now()) + interval '4 hours', w[3], 3, 6, 'Instrucciones de demostración.', true);

  -- Guardia nocturna de mañana que cruza medianoche (22:00 a 06:00 hora de la sede).
  -- Es de mañana para que nunca se traslape con la guardia en curso, sin importar la
  -- hora del reset (Luis está en ambas): una persona no puede tener dos guardias
  -- asignadas que se traslapan.
  insert into public.shifts (id, facility_id, title, meeting_point, starts_at, ends_at, responsible_worker_id,
    min_staff, max_staff, is_demo)
  values (s_night, f1, '[DEMO] Guardia nocturna', 'Acceso de urgencias',
    ((v_today + 1)::timestamp + time '22:00') at time zone 'America/Mazatlan',
    ((v_today + 2)::timestamp + time '06:00') at time zone 'America/Mazatlan', w[4], 2, 4, true);

  -- Guardia de ayer (para historial)
  insert into public.shifts (id, facility_id, title, meeting_point, starts_at, ends_at, responsible_worker_id,
    min_staff, max_staff, is_demo)
  values (s_past, f1, '[DEMO] Guardia de ayer', 'Acceso principal',
    ((v_today - 1)::timestamp + time '08:00') at time zone 'America/Mazatlan',
    ((v_today - 1)::timestamp + time '14:00') at time zone 'America/Mazatlan', w[3], 2, 5, true);

  -- Guardia en otra sede (para probar alcance de coordinación)
  insert into public.shifts (id, facility_id, title, meeting_point, starts_at, ends_at, responsible_worker_id,
    min_staff, max_staff, is_demo)
  values (s_other, f3, '[DEMO] Guardia Xalisco', 'Puerta lateral', date_trunc('minute', now()) - interval '1 hour',
    date_trunc('minute', now()) + interval '5 hours', w[7], 2, 4, true);

  insert into public.shift_assignments (shift_id, worker_id, assigned_point) values
    (s_now, w[1], 'Acceso principal'),
    (s_now, w[2], 'Estacionamiento'),
    (s_now, w[3], 'Acceso principal'),
    (s_now, w[5], 'Acceso principal'),
    (s_night, w[4], 'Acceso de urgencias'),
    (s_night, w[2], 'Acceso de urgencias'),
    (s_past, w[1], 'Acceso principal'),
    (s_past, w[2], 'Acceso principal'),
    (s_past, w[3], 'Acceso principal'),
    (s_other, w[7], 'Puerta lateral'),
    (s_other, w[8], 'Puerta lateral');

  update public.shift_assignments set substitute_for_worker_id = w[6]
  where shift_id = s_now and worker_id = w[5];

  -- Asistencias de demostración (escritas directamente solo por el seed).
  insert into public.attendance_sessions (assignment_id, shift_id, worker_id, facility_id, check_in_at, check_out_at,
    check_in_method, check_out_method, check_in_by, check_out_by, check_in_request_id, check_out_request_id, notes)
  select a.id, a.shift_id, a.worker_id, s.facility_id,
    s.starts_at + interval '5 minutes', s.starts_at + interval '6 hours 20 minutes',
    'propio', 'propio', v_seed_actor, v_seed_actor, gen_random_uuid(), gen_random_uuid(), 'Registro de demostración'
  from public.shift_assignments a join public.shifts s on s.id = a.shift_id
  where a.shift_id = s_past and a.worker_id = w[1];

  -- Llegada tardía con salida anticipada
  insert into public.attendance_sessions (assignment_id, shift_id, worker_id, facility_id, check_in_at, check_out_at,
    check_in_method, check_out_method, check_in_by, check_out_by, check_in_request_id, check_out_request_id)
  select a.id, a.shift_id, a.worker_id, s.facility_id,
    s.starts_at + interval '25 minutes', s.ends_at - interval '1 hour',
    'propio', 'propio', v_seed_actor, v_seed_actor, gen_random_uuid(), gen_random_uuid()
  from public.shift_assignments a join public.shifts s on s.id = a.shift_id
  where a.shift_id = s_past and a.worker_id = w[2];

  -- Entrada sin salida (registro incompleto pendiente de revisión)
  insert into public.attendance_sessions (assignment_id, shift_id, worker_id, facility_id, check_in_at,
    check_in_method, check_in_by, check_in_request_id)
  select a.id, a.shift_id, a.worker_id, s.facility_id, s.starts_at + interval '2 minutes',
    'propio', v_seed_actor, gen_random_uuid()
  from public.shift_assignments a join public.shifts s on s.id = a.shift_id
  where a.shift_id = s_past and a.worker_id = w[3];

  -- En servicio ahora mismo en la guardia en curso
  insert into public.attendance_sessions (assignment_id, shift_id, worker_id, facility_id, check_in_at,
    check_in_method, check_in_by, check_in_request_id)
  select a.id, a.shift_id, a.worker_id, s.facility_id, s.starts_at + interval '3 minutes',
    'propio', v_seed_actor, gen_random_uuid()
  from public.shift_assignments a join public.shifts s on s.id = a.shift_id
  where a.shift_id = s_now and a.worker_id = w[5];

  insert into public.attendance_sessions (assignment_id, shift_id, worker_id, facility_id, check_in_at,
    check_in_method, check_in_by, check_in_request_id)
  select a.id, a.shift_id, a.worker_id, s.facility_id, s.starts_at + interval '10 minutes',
    'propio', v_seed_actor, gen_random_uuid()
  from public.shift_assignments a join public.shifts s on s.id = a.shift_id
  where a.shift_id = s_other and a.worker_id = w[7];
end;
$$;
