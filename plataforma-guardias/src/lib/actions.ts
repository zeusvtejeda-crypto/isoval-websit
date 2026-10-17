/**
 * Resultado estándar de Server Actions y Route Handlers.
 */
export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; message: string; fieldErrors?: Record<string, string> };

type PgLikeError = { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined;

/**
 * Traduce errores de Postgres/PostgREST a mensajes en español para la interfaz.
 * Los mensajes que lanzan nuestras funciones ya vienen en español y se respetan.
 */
export function friendlyDbError(error: PgLikeError, fallback = "No se pudo completar la operación."): string {
  if (!error) return fallback;
  const msg = error.message ?? "";
  const code = error.code ?? "";
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return /row-level security|permission denied/i.test(msg) ? "No tienes permiso para realizar esta acción." : msg;
  }
  if (code === "23505") {
    if (/facilities_unit_key_uq/.test(msg)) return "Ya existe una instalación con esa clave de unidad.";
    if (/facilities_name_place_uq/.test(msg)) return "Ya existe una instalación con ese nombre en el mismo municipio.";
    if (/worker_private_employee_number_uq/.test(msg)) return "Ese número de trabajador ya está registrado.";
    if (/shift_assignments_unique/.test(msg)) return "Esa persona ya está asignada a la guardia.";
    if (/shifts_no_duplicate_uq/.test(msg)) return "Ya existe una guardia igual (misma sede, punto y horario).";
    if (/profiles_worker_id_key/.test(msg)) return "Ese trabajador ya tiene una cuenta de acceso.";
    if (/facility_categories_(name|slug)_key/.test(msg)) return "Ya existe una categoría con ese nombre.";
    return /[áéíóúñ¿¡]/i.test(msg) ? msg : "El registro ya existe (duplicado).";
  }
  if (code === "23503") return "El registro está relacionado con otros datos y no puede eliminarse o no existe la referencia.";
  if (code === "23514") {
    if (/shifts_time_order/.test(msg)) return "El término debe ser posterior al inicio.";
    if (/shifts_max_duration/.test(msg)) return "Una guardia no puede durar más de 48 horas.";
    if (/shifts_staff_range/.test(msg)) return "El cupo máximo debe ser mayor o igual al mínimo.";
    if (/facilities_coords_pair/.test(msg)) return "Captura latitud y longitud juntas, o ninguna.";
    if (/facilities_verified_requires_date/.test(msg)) return "Para marcar como verificada indica la fecha de verificación.";
    return /[áéíóúñ¿¡]/i.test(msg) ? msg : "Algún dato no cumple las reglas de validación.";
  }
  if (code === "23P01") return "El registro se traslapa con otro registro vigente de esta persona.";
  if (code === "22P02") return "Algún dato tiene un formato inválido.";
  // Mensajes propios (en español) de las funciones de la base de datos.
  if (msg && /[áéíóúñ¿¡]|^[A-ZÁÉÍÓÚ][a-záéíóúñ ]+/.test(msg) && !/^(new row|duplicate key|null value|insert or update)/i.test(msg)) {
    return msg;
  }
  return fallback;
}

/** Texto obligatorio recortado o null. */
export function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
