-- =============================================================================
-- Datos de referencia (NO son datos de demostración)
-- - Entidades federativas: claves del Marco Geoestadístico del INEGI.
-- - Municipios de Nayarit (clave de entidad 18).
-- - Categorías iniciales de instalaciones (editables).
-- - Configuración inicial.
-- Verifique los catálogos contra la versión vigente del INEGI antes de producción.
-- =============================================================================

insert into public.states (id, name, abbreviation, default_timezone, enabled) values
  (1,  'Aguascalientes', 'AGS', 'America/Mexico_City', false),
  (2,  'Baja California', 'BC', 'America/Tijuana', false),
  (3,  'Baja California Sur', 'BCS', 'America/Mazatlan', false),
  (4,  'Campeche', 'CAMP', 'America/Merida', false),
  (5,  'Coahuila de Zaragoza', 'COAH', 'America/Monterrey', false),
  (6,  'Colima', 'COL', 'America/Mexico_City', false),
  (7,  'Chiapas', 'CHIS', 'America/Mexico_City', false),
  (8,  'Chihuahua', 'CHIH', 'America/Chihuahua', false),
  (9,  'Ciudad de México', 'CDMX', 'America/Mexico_City', false),
  (10, 'Durango', 'DGO', 'America/Monterrey', false),
  (11, 'Guanajuato', 'GTO', 'America/Mexico_City', false),
  (12, 'Guerrero', 'GRO', 'America/Mexico_City', false),
  (13, 'Hidalgo', 'HGO', 'America/Mexico_City', false),
  (14, 'Jalisco', 'JAL', 'America/Mexico_City', false),
  (15, 'México', 'MEX', 'America/Mexico_City', false),
  (16, 'Michoacán de Ocampo', 'MICH', 'America/Mexico_City', false),
  (17, 'Morelos', 'MOR', 'America/Mexico_City', false),
  (18, 'Nayarit', 'NAY', 'America/Mazatlan', true),
  (19, 'Nuevo León', 'NL', 'America/Monterrey', false),
  (20, 'Oaxaca', 'OAX', 'America/Mexico_City', false),
  (21, 'Puebla', 'PUE', 'America/Mexico_City', false),
  (22, 'Querétaro', 'QRO', 'America/Mexico_City', false),
  (23, 'Quintana Roo', 'QROO', 'America/Cancun', false),
  (24, 'San Luis Potosí', 'SLP', 'America/Mexico_City', false),
  (25, 'Sinaloa', 'SIN', 'America/Mazatlan', false),
  (26, 'Sonora', 'SON', 'America/Hermosillo', false),
  (27, 'Tabasco', 'TAB', 'America/Mexico_City', false),
  (28, 'Tamaulipas', 'TAMS', 'America/Matamoros', false),
  (29, 'Tlaxcala', 'TLAX', 'America/Mexico_City', false),
  (30, 'Veracruz de Ignacio de la Llave', 'VER', 'America/Mexico_City', false),
  (31, 'Yucatán', 'YUC', 'America/Merida', false),
  (32, 'Zacatecas', 'ZAC', 'America/Mexico_City', false);

-- Municipios de Nayarit. Bahía de Banderas usa la zona horaria del centro.
insert into public.municipalities (state_id, inegi_code, name, timezone) values
  (18, '001', 'Acaponeta', null),
  (18, '002', 'Ahuacatlán', null),
  (18, '003', 'Amatlán de Cañas', null),
  (18, '004', 'Compostela', null),
  (18, '005', 'Huajicori', null),
  (18, '006', 'Ixtlán del Río', null),
  (18, '007', 'Jala', null),
  (18, '008', 'Xalisco', null),
  (18, '009', 'Del Nayar', null),
  (18, '010', 'Rosamorada', null),
  (18, '011', 'Ruiz', null),
  (18, '012', 'San Blas', null),
  (18, '013', 'San Pedro Lagunillas', null),
  (18, '014', 'Santa María del Oro', null),
  (18, '015', 'Santiago Ixcuintla', null),
  (18, '016', 'Tecuala', null),
  (18, '017', 'Tepic', null),
  (18, '018', 'Tuxpan', null),
  (18, '019', 'La Yesca', null),
  (18, '020', 'Bahía de Banderas', 'America/Bahia_Banderas');

insert into public.facility_categories (slug, name, description, icon, color, sort_order) values
  ('hospitales', 'Hospitales', 'Unidades hospitalarias.', 'hospital', '#14532d', 10),
  ('umf', 'Unidades de Medicina Familiar', 'Unidades de primer nivel de atención.', 'stethoscope', '#166534', 20),
  ('otras-unidades-medicas', 'Otras unidades médicas', 'Unidades médicas no clasificadas en las categorías anteriores.', 'cross', '#15803d', 30),
  ('delegaciones', 'Delegaciones u oficinas de representación', 'Oficinas de representación estatal o regional.', 'landmark', '#365314', 40),
  ('oficinas-administrativas', 'Oficinas administrativas', 'Oficinas y subdelegaciones administrativas.', 'briefcase', '#3f6212', 50),
  ('otras-instalaciones', 'Otras instalaciones', 'Instalaciones que no corresponden a otra categoría.', 'building', '#4b5563', 60);

insert into public.app_settings (key, value, description, is_public) values
  ('privacy_notice',
   jsonb_build_object(
     'title', 'Aviso de privacidad',
     'body', E'BORRADOR — PENDIENTE DE REVISIÓN JURÍDICA.\n\nEste texto es un marcador de posición y no constituye un aviso de privacidad válido. Antes de usar la plataforma con datos reales, la persona responsable del tratamiento debe redactarlo y validarlo con asesoría jurídica conforme a la legislación aplicable.\n\nDatos que trata la plataforma: nombre, entidad, municipio, sede de adscripción, área, puesto, turno habitual, número de trabajador (opcional), teléfono (opcional) y registros de entrada y salida de guardias.\n\nLa plataforma no recopila CURP, datos médicos, datos biométricos ni ubicación continua.',
     'legal_review_status', 'pendiente',
     'responsible', null,
     'contact', null),
   'Aviso de privacidad (requiere revisión jurídica antes de producción).',
   true),
  ('retention',
   jsonb_build_object('attendance_months', 24, 'audit_months', 60),
   'Periodos de conservación de registros de guardias y bitácora (meses).',
   false),
  ('attendance',
   jsonb_build_object('checkin_window_before_minutes', 120, 'open_session_grace_minutes', 240),
   'Ventana para registrar entrada antes del inicio y margen para cerrar una entrada abierta sin revisión.',
   false),
  ('disclaimer',
   jsonb_build_object('text', 'Esta plataforma no es una aplicación oficial del IMSS ni está afiliada al Instituto.'),
   'Aviso de no oficialidad.',
   true);
