# Arquitectura y convenciones

> Plataforma independiente. **No es una aplicación oficial del IMSS**: no uses logotipos ni lenguaje que lo sugiera.

## Stack

| Capa | Tecnología |
| --- | --- |
| Interfaz | Next.js 16.4 (App Router, TypeScript, React 19), Tailwind CSS 4 |
| Datos | Supabase: Postgres 17, Auth, Row Level Security, migraciones SQL |
| Mapa | Leaflet + leaflet.markercluster, teselas de OpenStreetMap (atribución obligatoria) |
| PWA | `app/manifest.ts` + `public/sw.js` propio (solo cachea recursos estáticos) |
| Pruebas | Vitest (unidad y base de datos/RLS), Playwright (E2E móvil) |

**Next.js 16.4 tiene cambios importantes.** Antes de usar una API, consulta `node_modules/next/dist/docs/`. Puntos clave:
- `params` y `searchParams` son `Promise` (usa `await`).
- El middleware se llama `src/proxy.ts` (función `proxy`).
- `cacheComponents` está **desactivado** a propósito (datos privados por usuario).

## Estructura

```
src/
  app/
    (app)/            vistas autenticadas con el armazón (navegación por rol)
    api/asistencia/   POST de entrada/salida (idempotente)
    directorio/       directorio público (mapa + lista)
    login/ aviso-de-privacidad/ offline/ sin-acceso/
  components/ui/      componentes base (Button, Badge, Card, Field, Table, estados)
  components/layout/  armazón, conexión, actualización automática
  components/attendance/ hook useAttendanceAction (idempotencia y estado sin conexión)
  lib/
    auth.ts           DAL: getSessionUser, requireUser/Staff/Manager/Admin
    supabase/         server.ts (RLS), client.ts (navegador), admin.ts (llave de servicio, solo servidor)
    attendance/       calc.ts (cálculos puros), load.ts (carga + cálculo), labels.ts (textos)
    data/             catálogos y paginación (fetchAll)
    import/parse.ts   lectura CSV/XLSX
    time.ts           zonas horarias y formatos
    actions.ts        ActionResult y friendlyDbError
    reason.ts         clearStoredReason (motivos repetidos en la bitácora)
    security/         safe-next (redirecciones), rate-limit (intentos de login)
    directory/        búsqueda, íconos de categoría, municipios repetidos
    admin/            etiquetas de bitácora, contraseñas temporales, catálogos
supabase/
  migrations/         esquema, RLS, funciones (fuente de verdad)
  seeds/demo.sql      DATOS DE DEMOSTRACIÓN (solo local)
tests/unit tests/db tests/e2e
```

## Reglas de seguridad (obligatorias)

1. **Permisos en servidor y base de datos.** Cada página privada llama a `requireUser()`, `requireStaff()`, `requireManager()` o `requireAdmin()`. Cada Server Action vuelve a verificar la sesión. RLS protege los datos aunque la interfaz falle.
2. **Usa siempre `createClient()` de `@/lib/supabase/server`** (sesión del usuario → RLS). `createAdminClient()` solo para Auth (crear/desactivar cuentas) y **después** de `requireAdmin()`.
3. **Asistencia solo por funciones de la base de datos**: `check_in`, `check_out` (vía `POST /api/asistencia` y `useAttendanceAction`), `correct_attendance`, `add_manual_attendance`, `void_attendance`, `set_assignment_status`, `request_correction`, `review_correction`. No hay escritura directa en `attendance_sessions`.
4. **Directorio público**: solo `public_facilities`. Nunca trabajadores, teléfonos personales ni guardias.
5. `worker_private` (número de trabajador, teléfono) solo donde sea necesario y permitido; auditoría no lo ve.
6. Ninguna clave secreta con prefijo `NEXT_PUBLIC_`.
7. **Separación de funciones**: nadie salvo administración corrige, agrega, anula o revisa su propia asistencia (la BD lo impide; la interfaz oculta esas acciones).
8. Una entrada abierta más allá del término + margen no se cierra con la hora actual: se corrige con la hora real.
9. El estado de una asignación solo cambia con `set_assignment_status`; `is_demo` y `created_by` solo los cambia administración.

## Motivo de cambio y bitácora

Las tablas principales tienen `change_reason`; los triggers copian el motivo a `audit_log`. Si el motivo nuevo es igual al guardado, `touch_row` lo anula para no arrastrar motivos viejos: llama `clearStoredReason()` antes de escribir un motivo.

## Páginas generales

`app/not-found.tsx`, `app/error.tsx` y `app/global-error.tsx` (en español). Cada sección privada tiene su `loading.tsx`/`error.tsx`; `(app)/error.tsx` es el respaldo.

## Tiempo

- La base guarda `timestamptz` (UTC). Se muestra en la zona de la sede (`facilities.timezone`) con `@/lib/time`.
- Captura con `<input type="datetime-local">` en la zona de la sede y convierte con `localInputToUtc(valor, tz)`.
- Las guardias pueden cruzar medianoche (máx. 48 h). `formatShiftRange` muestra «+1 día».
- Registros en línea: **hora del servidor** (`now()` en la función).

## Cálculos de asistencia

Siempre con `loadShiftsWithAttendance()` o `summarizeAttendance()`. Nunca recalcules a mano.
- Entrada sin salida: no suma horas; pasa a «registro incompleto» tras el margen configurado.
- Salida y regreso: el hueco no cuenta. Intervalos superpuestos no se cuentan dos veces.
- «Permanencia adicional» = tiempo registrado adicional, **no** horas extra pagadas.
- Sin sanciones automáticas ni rankings: las incidencias son señales para revisión.

## Interfaz

- Español de México. Móvil primero; objetivos táctiles ≥ 44 px.
- Estados siempre con texto (`<Badge>`), nunca solo color.
- Estados vacíos, de carga (`loading.tsx` / `LoadingState`) y de error (`error.tsx` / `ErrorState`).
- Mostrar «Última actualización» (`LastUpdated`) en vistas que se refrescan.
- Texto obligatorio en registros: «Entrada registrada no equivale a presencia física verificada».
- Sin conexión: nunca mostrar un registro como guardado si el servidor no lo confirmó.

## Server Actions

- Archivo `actions.ts` junto a la ruta, con `"use server"`.
- Valida con `zod`, verifica sesión/rol, usa el cliente con RLS, devuelve `ActionResult`, traduce errores con `friendlyDbError`, llama `revalidatePath`.
- Para cambios con motivo, envía `change_reason` (las tablas principales lo copian a la bitácora).
