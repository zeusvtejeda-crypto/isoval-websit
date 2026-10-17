/**
 * Resultado estándar de Server Actions y Route Handlers.
 */
export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; message: string; fieldErrors?: Record<string, string> };

type PgLikeError = { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined;

/** Mensajes nativos de Postgres/PostgREST (en inglés): nunca se muestran tal cual. */
const NATIVE_PG_MESSAGE =
  /^(new row|duplicate key|null value|insert or update|update or delete|value too long|invalid input|permission denied|conflicting key|could not|column|relation|function|syntax error|operator|there is no|cannot|record|query|JSON|failed to)|violates|row-level security/i;

function isOwnMessage(msg: string): boolean {
  return msg.trim().length > 0 && !NATIVE_PG_MESSAGE.test(msg.trim());
}

/**
 * Traduce errores de Postgres/PostgREST a mensajes en español para la interfaz.
 * Los mensajes que lanzan nuestras funciones y triggers ya vienen en español
 * (aunque no lleven acentos) y se respetan.
 */
export function friendlyDbError(error: PgLikeError, fallback = "No se pudo completar la operación."): string {
  if (!error) return fallback;
  const msg = error.message ?? "";
  const code = error.code ?? "";

  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return isOwnMessage(msg) ? msg : "No tienes permiso para realizar esta acción.";
  }
  if (code === "23505") {
    if (/facilities_unit_key_uq/.test(msg)) return "Ya existe una instalación con esa clave de unidad.";
    if (/facilities_name_place_uq/.test(msg)) return "Ya existe una instalación sin clave de unidad con ese nombre en el mismo municipio.";
    if (/worker_private_employee_number_uq/.test(msg)) return "Ese número de trabajador ya está registrado.";
    if (/shift_assignments_unique/.test(msg)) return "Esa persona ya está asignada a la guardia.";
    if (/shifts_no_duplicate_uq/.test(msg)) return "Ya existe una guardia igual (misma sede, punto y horario).";
    if (/profiles_worker_id_key/.test(msg)) return "Ese trabajador ya tiene una cuenta de acceso.";
    if (/facility_categories_slug_key/.test(msg)) return "Ya existe una categoría con ese identificador (slug).";
    if (/facility_categories_name_key/.test(msg)) return "Ya existe una categoría con ese nombre.";
    if (/correction_requests_one_pending_per_session/.test(msg)) return "Ya existe una solicitud pendiente para ese registro.";
    if (/attendance_one_open_per_worker/.test(msg)) return "Ya existe una entrada abierta para esta persona.";
    return isOwnMessage(msg) ? msg : "El registro ya existe (duplicado).";
  }
  if (code === "23503") {
    return isOwnMessage(msg) ? msg : "El registro está relacionado con otros datos: no puede eliminarse o la referencia no existe.";
  }
  if (code === "23514") {
    if (/shifts_time_order/.test(msg)) return "El término debe ser posterior al inicio.";
    if (/shifts_max_duration/.test(msg)) return "Una guardia no puede durar más de 48 horas.";
    if (/shifts_staff_range/.test(msg)) return "El cupo máximo debe ser mayor o igual al mínimo.";
    if (/shifts_cancel_reason/.test(msg)) return "Para cancelar la guardia indica el motivo.";
    if (/facilities_coords_pair/.test(msg)) return "Captura latitud y longitud juntas, o ninguna.";
    if (/facilities_verified_requires_date/.test(msg)) return "Para marcar como verificada indica la fecha de verificación.";
    if (/attendance_out_after_in/.test(msg)) return "La salida no puede ser anterior a la entrada.";
    return isOwnMessage(msg) ? msg : "Algún dato no cumple las reglas de validación.";
  }
  if (code === "23P01") return "El registro se traslapa con otro registro vigente de esta persona.";
  if (code === "22P02" || code === "22007" || code === "22008") return "Algún dato tiene un formato inválido.";
  if (code === "PGRST116") return "No se encontró el registro o no tienes acceso.";
  // Mensajes propios (en español) de las funciones y triggers de la base de datos.
  return isOwnMessage(msg) && !/^[A-Z]{2,}\d/.test(msg) ? msg : fallback;
}

/** Texto obligatorio recortado o null. */
export function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
