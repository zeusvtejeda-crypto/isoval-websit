# Guardias y Directorio de Instalaciones

Aplicación web responsiva e instalable (PWA) con dos módulos conectados:

1. **Directorio y mapa de instalaciones** (público): búsqueda, filtros, mapa con agrupación de marcadores, ficha de instalación e indicaciones.
2. **Control de guardias de huelga** (privado): directorio de trabajadores, programación de guardias, registro de entradas y salidas, panel «Quién está aquí», historial, reportes y exportación.

> **Aviso:** esta plataforma **no es una aplicación oficial del IMSS** ni está afiliada al Instituto. No usa logotipos oficiales.
> La semilla de la base de datos solo trae **datos de demostración** marcados como tales. Aparte, en `datos-oficiales/` se incluye un catálogo de Nayarit construido con fuentes oficiales (CLUES, IMSS e INEGI) que se carga con el importador; ver [Datos](#datos-fuentes-oficiales-importación-y-demostración).

---

## Contenido

- [Funcionalidades](#funcionalidades)
- [Registro con código QR (opcional)](#registro-con-código-qr-opcional)
- [Arquitectura](#arquitectura)
- [Ejecutar en local](#ejecutar-en-local)
- [Variables de entorno](#variables-de-entorno)
- [Configurar Supabase en la nube](#configurar-supabase-en-la-nube)
- [Proveedor de mapas](#proveedor-de-mapas)
- [Datos: fuentes oficiales, importación y demostración](#datos-fuentes-oficiales-importación-y-demostración)
- [Despliegue](#despliegue)
- [Pruebas](#pruebas)
- [Integración continua](#integración-continua)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [Configuración externa pendiente](#configuración-externa-pendiente)

---

## Funcionalidades

| Área | Qué incluye |
| --- | --- |
| Directorio público | Lista (funciona sin mapa y sin JavaScript), mapa Leaflet + OpenStreetMap con agrupación, búsqueda por nombre/clave/municipio/estado/dirección, filtros por categoría/estado/municipio, ficha completa, botón «Cómo llegar». |
| Instalaciones | Alta, edición, desactivación e importación CSV/Excel con validación y detección de duplicados. Categorías editables (nombre, descripción, icono, color). |
| Trabajadores | Directorio privado por entidad federativa, alta/edición/importación, datos privados (número de trabajador y teléfono) en tabla separada. Un trabajador puede existir sin cuenta. |
| Guardias | Sede, punto de reunión, inicio/término (cruza medianoche), responsable, cupo mínimo/máximo, asignaciones, sustituciones, instrucciones, estados. Vista de lista y calendario semanal. |
| Registro | Botones grandes «Registrar entrada» / «Registrar salida», hora del servidor, idempotencia contra doble clic y reintentos, varias sesiones por guardia, registro por coordinación con motivo. |
| En servicio | Panel con actualización automática: en servicio, responsables, pendientes de llegar, quienes salieron, guardias sin cobertura y registros incompletos. |
| Historial y reportes | Por trabajador, sede, estado y rango de fechas; horas programadas, dentro/fuera del horario, total y diferencia; incidencias; exportación a Excel y PDF según permisos. |
| Correcciones | Solicitudes del trabajador, revisión por coordinación, correcciones que conservan el registro original, anulaciones con motivo y bitácora completa. |
| Administración | Usuarios y permisos por sede, aviso de privacidad configurable, política de conservación, parámetros de registro, eliminación de datos de demostración, bitácora. |

Roles: **Administración general**, **Coordinación** (solo sedes asignadas), **Trabajador** (sus propios registros) y **Consulta o auditoría** (solo lectura en su alcance).

## Registro con código QR (opcional)

Una forma más rápida de registrar entrada o salida en el punto de reunión. Los botones normales siguen disponibles.

1. **Coordinación** abre la guardia → **«Mostrar código QR de registro»** y deja la pantalla visible en el punto de reunión.
2. El código **se renueva solo** y **caduca en ~2 minutos** (configurable en `app_settings`, clave `attendance`, campo `qr_ttl_seconds`; el servidor lo limita a entre 30 y 600 segundos).
3. **El trabajador** lo escanea con la **cámara nativa de su teléfono** (la app no pide permiso de cámara), inicia sesión si hace falta y **confirma** la entrada o la salida.
4. El registro queda con método **«Código QR»** (los registros con los botones conservan su propio método).

Límites y seguridad:

- **El QR no prueba presencia física.** Otra persona podría reenviar el enlace mientras siga vigente. Solo facilita el registro con la cuenta propia, igual que «Entrada registrada» no equivale a presencia física verificada.
- Los códigos los **emite y valida el servidor** (`issue_qr_token`, `qr_token_context`, `check_in_qr`, `check_out_qr`) y en la base **solo se guarda su hash**. Solo la coordinación de la sede o la administración pueden emitirlos, y solo los trabajadores asignados a esa guardia pueden usarlos.

## Arquitectura

- **Next.js 16.4** (App Router, TypeScript, React 19) + **Tailwind CSS 4**.
- **Supabase**: Postgres 17, Auth (correo y contraseña), **Row Level Security** en todas las tablas, funciones SQL para la asistencia y bitácora por triggers.
- **Leaflet** + **leaflet.markercluster** con teselas de OpenStreetMap (atribución conservada).
- **PWA**: `app/manifest.ts` y `public/sw.js` propio que solo cachea recursos estáticos (nunca páginas privadas ni la API).

Convenciones y reglas de seguridad: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

### Modelo de datos (resumen)

| Tabla | Propósito |
| --- | --- |
| `states`, `municipalities` | Catálogos INEGI: 32 entidades y 2,478 municipios (Marco Geoestadístico). Cobertura activa por entidad (`states.enabled`), editable en Administración → Catálogos geográficos. |
| `facility_categories`, `facilities` | Categorías editables e instalaciones (sedes) con procedencia, verificación y zona horaria. |
| `workers`, `worker_private` | Trabajadores y sus datos privados (separados). |
| `profiles`, `user_facility_scopes` | Cuentas de acceso (1:1 con Auth) y sedes asignadas. |
| `shifts`, `shift_assignments` | Guardias y asignaciones (incluye sustituciones). |
| `attendance_sessions` | Entradas/salidas. Solo se escriben por funciones; las correcciones crean versión nueva. |
| `correction_requests`, `incident_notes` | Solicitudes de corrección y justificación de incidencias. |
| `audit_log` | Bitácora inmutable: autor, fecha, valor anterior, valor nuevo, motivo. |
| `app_settings` | Aviso de privacidad, conservación y parámetros de registro. |

Restricciones anti-duplicados clave: una sola entrada abierta por trabajador (índice único parcial), sin traslapes de sesiones (restricción de exclusión GiST), identificador de solicitud único (idempotencia), salida posterior a la entrada (CHECK), clave de unidad única, nombre normalizado único por municipio, número de trabajador único, asignación única por guardia.

## Ejecutar en local

Requisitos: Node.js ≥ 20.9, Docker (para Supabase local) y npm.

```bash
cd plataforma-guardias
npm install
cp .env.example .env.local          # completa con los valores que imprime el paso siguiente

npm run db:start                    # levanta Supabase local (Postgres, Auth, API)
npx supabase status                 # copia API URL, anon key y service_role key a .env.local
npm run db:reset                    # aplica migraciones y DATOS DE DEMOSTRACIÓN
npm run demo:usuarios               # crea cuentas de demostración (solo contra Supabase local)

npm run dev                         # http://localhost:3000
```

Cuentas de demostración (contraseña `Demo-Guardias-2026!`, o la definida en `DEMO_PASSWORD`):

| Correo | Rol |
| --- | --- |
| `admin@demo.local` | Administración general |
| `coordinacion@demo.local` | Coordinación de «[DEMO] Hospital de demostración A» y «[DEMO] Unidad de Medicina Familiar de demostración 1». También es la trabajadora «[DEMO] María López Díaz»: no puede corregir su propia asistencia |
| `auditoria@demo.local` | Consulta o auditoría (Hospital A) |
| `trabajador@demo.local` | Trabajador |
| `trabajador2@demo.local` | Trabajador |

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example).

| Variable | Dónde se usa | Notas |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Navegador y servidor | URL del proyecto. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Navegador y servidor | Llave pública (anon/publishable). RLS protege los datos. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo servidor** | Solo para crear/desactivar cuentas desde Administración. Nunca con prefijo `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | Servidor | URL pública del sitio. |
| `NEXT_PUBLIC_DEFAULT_TIMEZONE` | Ambos | Zona por omisión (`America/Mazatlan`). Cada sede define la suya. |
| `NEXT_PUBLIC_DEMO_MODE` | Ambos | Muestra la franja de datos de demostración. Usa `false` en producción. |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | Navegador | Proveedor de teselas y su atribución obligatoria. |
| `NEXT_PUBLIC_MAP_CENTER_LAT`, `NEXT_PUBLIC_MAP_CENTER_LNG`, `NEXT_PUBLIC_MAP_ZOOM` | Navegador | Vista inicial (Nayarit). |
| `TEST_DATABASE_URL` | Pruebas | Conexión directa a Postgres local para pruebas de BD/RLS. |
| `TRUSTED_PROXY_HOPS` | Servidor | Proxies propios delante de la app; define de dónde se toma la IP para el límite de intentos. |
| `NEXT_PUBLIC_ENABLE_SW` | Navegador | `true` registra el service worker también en desarrollo. |
| `DEMO_PASSWORD`, `ALLOW_DEMO_USERS` | Script `demo:usuarios` | Contraseña de las cuentas demo; forzar su creación fuera de local (no recomendado). |
| `ADMIN_PASSWORD` | Script `crear-admin` | Solo al ejecutar el comando; no la guardes en archivos. |
| `PLAYWRIGHT_CHROMIUM_PATH`, `E2E_PORT`, `E2E_DEV` | Pruebas E2E | Ruta de Chromium, puerto y modo de desarrollo. |

## Configurar Supabase en la nube

1. Crea un proyecto en [supabase.com](https://supabase.com). Elige una región cercana.
2. Vincula y aplica las migraciones (no aplica los datos de demostración):
   ```bash
   npx supabase login
   npx supabase link --project-ref <REF_DEL_PROYECTO>
   npx supabase db push
   ```
   **Nunca** ejecutes `supabase/seeds/demo.sql` en producción ni uses `db push --include-seed`.
3. En **Authentication → Providers → Email**: deja habilitado el inicio con correo y contraseña y **desactiva el registro público** («Allow new users to sign up» = off). Las cuentas las crea Administración.
   En **Authentication → Policies/Passwords** usa longitud mínima de 12, requisitos de minúsculas, mayúsculas y dígitos, y «Secure password change». Activa CAPTCHA si el sitio es público. (`supabase/config.toml` ya lo configura así en local.)
4. En **Authentication → URL Configuration**: define *Site URL* con tu dominio (HTTPS).
5. Copia las llaves de **Project Settings → API** a las variables de entorno del despliegue.
6. Crea la primera cuenta de administración:
   ```bash
   ADMIN_PASSWORD='una-contraseña-larga-y-segura' npm run crear-admin -- persona@dominio.mx "Nombre"
   ```
7. En **Administración → Configuración**, revisa el aviso de privacidad (marcado *pendiente de revisión jurídica*), la política de conservación y los parámetros de registro.
8. Habilita la cobertura de otras entidades editando `states.enabled` cuando cargues datos.

## Proveedor de mapas

- Por omisión se usan las teselas públicas de OpenStreetMap. Su [política de uso](https://operations.osmfoundation.org/policies/tiles/) **no permite tráfico intenso**: para producción usa un proveedor con clave (MapTiler, Stadia Maps, Thunderforest, etc.) o un servidor propio.
- Configura `NEXT_PUBLIC_MAP_TILE_URL` (plantilla `{z}/{x}/{y}`, incluye la clave si el proveedor la exige) y **conserva la atribución** en `NEXT_PUBLIC_MAP_ATTRIBUTION` (OpenStreetMap y la del proveedor).
- El directorio sigue funcionando en modo lista si el mapa no carga.

## Datos: fuentes oficiales, importación y demostración

- **No se inventa un directorio.** Carga solo datos de fuentes oficiales accesibles y conserva su procedencia (`fuente`, `url_fuente`, fecha de verificación y estado verificado/pendiente).
- Valida nombres oficiales y categorías antes de cargar datos reales.

### Catálogo oficial de Nayarit (`datos-oficiales/`)

Incluye un catálogo listo para el importador, construido solo con fuentes oficiales y reproducible con `datos-oficiales/construir_instalaciones.py`. Las fuentes y reglas están en [`datos-oficiales/FUENTES.md`](datos-oficiales/FUENTES.md).

| Archivo | Contenido |
| --- | --- |
| `instalaciones_nayarit_imss_plantilla.csv` | 396 unidades IMSS e IMSS-Bienestar en operación, en el formato del importador. |
| `instalaciones_nayarit.csv` | 646 establecimientos de todas las instituciones (referencia; no se carga por omisión). |
| `fuentes/` | Extractos crudos: CLUES (DGIS, corte 2026-08), directorio público del IMSS y catálogos del INEGI. |

- **Fuente principal:** catálogo CLUES de la Secretaría de Salud (DGIS). La clave de unidad es la CLUES.
- **Validación cruzada:** 116 filas coinciden con el directorio público del IMSS y llevan `verificado`. Las 280 restantes quedan `pendiente`.
- **Coordenadas:** algunas se corrigieron con el directorio del IMSS o con el centro de la localidad del INEGI. La coordenada original queda en `observaciones`.
- **Antes de usarlo en producción:** revisa las filas pendientes y las marcadas `revisar` en `observaciones`, y confirma que el corte de CLUES sigue vigente.
- **Cómo cargarlo:** Administración → Instalaciones → Importar → `instalaciones_nayarit_imss_plantilla.csv` → Validar → Importar. Las unidades co-ubicadas con el mismo nombre se distinguen por su CLUES.
- **IMSS o IMSS-Bienestar:** 273 de las 396 unidades son de Servicios de Salud IMSS-Bienestar, que es otra institución. Si el directorio debe incluir solo el IMSS ordinario, carga `instalaciones_nayarit_solo_imss_plantilla.csv` (123 unidades). La institución de cada unidad queda en `descripcion` y `observaciones`.
- Importación: **Administración → Instalaciones → Importar** (CSV/Excel) y **Trabajadores → Importar**. Plantillas en `public/plantillas/`. El flujo valida, detecta duplicados (en el archivo y contra la base) y muestra una vista previa antes de aplicar.
- Datos de demostración: viven solo en `supabase/seeds/demo.sql`, tienen `is_demo = true` y el prefijo «[DEMO]». Se eliminan con **Administración → Configuración → Eliminar datos de demostración** (función `purge_demo_data`).

## Despliegue

Funciona en cualquier hospedaje de Node.js (Vercel, Render, Fly.io, servidor propio):

```bash
npm run build
npm run start
```

- Define las variables de entorno del proyecto (con `NEXT_PUBLIC_DEMO_MODE=false`).
- Sirve por **HTTPS** (requisito de la PWA y de cookies seguras).
- El service worker solo se registra en producción.

## Pruebas

```bash
npm run typecheck        # TypeScript
npm run lint             # ESLint
npm run test             # unidad (Vitest): cálculos, zonas horarias, importación, reportes, PWA…
npm run test:db          # base de datos real (Supabase local): RLS, funciones, triggers
npm run build && npm run test:e2e   # E2E (Playwright, móvil) contra next start + Supabase local
```

Requisitos de `test:db` y `test:e2e`: `npm run db:start`, `npm run db:reset` y `npm run demo:usuarios`. Si Playwright no encuentra Chromium, define `PLAYWRIGHT_CHROMIUM_PATH`.

**Verificación previa de E2E (global setup).** Antes de las pruebas, `tests/e2e/global-setup.ts` revisa en Postgres (`TEST_DATABASE_URL` o `postgresql://postgres:postgres@127.0.0.1:54322/postgres`), solo con lecturas, que la guardia demo «[DEMO] Guardia matutina» exista y esté **en curso** y que existan las cuentas demo. Las fechas del seed son relativas al momento del reset: si pasaron varias horas, la guardia ya terminó y las pruebas se detienen con el mensaje «Los datos de demostración no están listos o vencieron…». Solución: `npm run db:reset && npm run demo:usuarios`. (Playwright arranca el servidor web antes de esta verificación.)

### Criterios de aceptación y dónde se prueban

| # | Criterio | Pruebas |
| --- | --- | --- |
| 1 | Crear una instalación y encontrarla en mapa y lista | `tests/db/acceptance.test.ts` (1), `tests/e2e/criterios.spec.ts` |
| 2 | Registrar un trabajador y asignarlo a una sede | `tests/db` (2), `tests/e2e` |
| 3 | Crear una guardia y asignar trabajadores | `tests/db` (3), `tests/e2e` |
| 4 | Registrar entrada y verla en «En servicio» | `tests/db` (4–5), `tests/e2e` |
| 5 | Registrar salida y actualizar el historial | `tests/db` (4–5), `tests/e2e` |
| 6 | Guardia que cruza medianoche | `tests/unit/calc.test.ts`, `tests/unit/time.test.ts`, `tests/db` (6) |
| 7 | Salida y regreso sin contar el tiempo ausente | `tests/unit/calc.test.ts`, `tests/db` (7) |
| 8 | Detectar una entrada sin salida | `tests/unit/calc.test.ts`, `tests/db` (8) |
| 9 | Evitar duplicados por doble clic o reintento | `tests/db` (9), pruebas del componente de registro, `tests/e2e` |
| 10 | Corregir conservando la auditoría | `tests/db` (10), `tests/e2e` |
| 11 | Un trabajador no ve datos privados de otros | `tests/db` (11), `tests/e2e` |
| 12 | Un coordinador no accede a sedes ajenas | `tests/db` (12), `tests/e2e` |
| — | Importación del catálogo oficial (396 unidades, CLUES co-ubicadas) | `tests/e2e/importacion-oficial.spec.ts` |
| — | Endurecimiento: separación de funciones, salida inventada, alcance, columnas protegidas, servicios públicos | `tests/db/hardening.test.ts` |
| — | Registro con código QR: emisión por coordinación/administración, solo hash, uso por trabajadores asignados, método «Código QR», reintentos sin duplicar, códigos inventados o fuera de la ventana | `tests/db/qr.test.ts`, `tests/e2e/qr.spec.ts` |

## Integración continua

El flujo de GitHub Actions [`.github/workflows/plataforma-guardias.yml`](../.github/workflows/plataforma-guardias.yml) (en la raíz del repositorio) corre en cada `push` y `pull_request` que cambie archivos bajo `plataforma-guardias/` o el propio flujo; también se puede lanzar a mano (*Run workflow*). Una corrida nueva de la misma rama o PR cancela la anterior.

En `ubuntu-latest`, con Node.js 22 y caché de npm:

1. `npm ci` y Supabase local efímero (`npx supabase start` sin Studio ni servicios que no se usan).
2. Genera `.env.local` con las llaves que imprime `npx supabase status -o env` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`), `NEXT_PUBLIC_SITE_URL=http://localhost:3100`, `NEXT_PUBLIC_DEMO_MODE=true` y `TEST_DATABASE_URL`.
3. `npm run db:reset` y `npm run demo:usuarios`.
4. `npx next typegen` (tipos de rutas, no versionados), `typecheck`, `lint`, `test` (unidad), `test:db`, `build`.
5. `npx playwright install --with-deps chromium` y `test:e2e` (contra `next start` en el puerto 3100).

**No usa secretos**: todo es local y se descarta al terminar. **Dónde ver resultados:** pestaña **Actions** del repositorio → flujo *plataforma-guardias* → la corrida (también aparece como verificación en el PR). Si fallan las pruebas E2E, la corrida adjunta el artefacto `playwright-<id>` con el reporte HTML (`playwright-report/`) y las trazas y capturas (`test-results/`); descárgalo, descomprímelo y ábrelo con `npx playwright show-report playwright-report`, o abre un `trace.zip` de `test-results/` con `npx playwright show-trace` o en [trace.playwright.dev](https://trace.playwright.dev).

## Seguridad y privacidad

- Permisos validados en el servidor (DAL `src/lib/auth.ts` y cada Server Action) **y** en la base de datos (RLS + funciones con verificación de rol y sede).
- Directorio público separado (`public_facilities`): nunca expone trabajadores, teléfonos ni guardias.
- No se recopilan CURP, datos médicos, biométricos ni ubicación. Sin reconocimiento facial ni rastreo.
- «Entrada registrada» no equivale a presencia física verificada (se indica en la interfaz).
- Sin conexión, la interfaz nunca muestra un registro como guardado si el servidor no lo confirmó.
- Correcciones sin borrar el original; bitácora inmutable (triggers impiden editarla o borrarla).
- Política de conservación configurable; exportaciones restringidas por permisos (RLS).
- La llave de servicio solo existe en el servidor.
- **Separación de funciones:** nadie (salvo administración) corrige, agrega, anula o revisa su propia asistencia. Las horas capturadas a mano deben caer dentro de la guardia (±12 h).
- Una entrada olvidada nunca se cierra con la hora actual pasado el margen: se corrige con la hora real.
- Cabeceras: Content-Security-Policy (orígenes de teselas y Supabase), HSTS cuando el sitio es HTTPS, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy` sin cámara, micrófono ni ubicación. `/api/asistencia` exige mismo origen y JSON.
- Límite de intentos de inicio de sesión: bloqueo estricto por IP + correo y umbrales altos por IP y por correo, para no bloquear a una red compartida ni permitir bloqueos dirigidos. La IP solo se toma de proxies de confianza (`TRUSTED_PROXY_HOPS`). Es en memoria por instancia: con varias instancias usa un almacén compartido o el CAPTCHA de Supabase.
- Supabase Auth limita los inicios de sesión por IP, y aquí todos llegan desde la IP del servidor: sube «Sign-ins per 5 minutes» en el panel según el tamaño del personal (en local: 300).
- Importación XLSX: además del tamaño declarado, se descomprime por flujo contando bytes reales y se corta al pasar 50 MB.

## Configuración externa pendiente

- Proyecto de Supabase en la nube, llaves y primera cuenta de administración.
- Proveedor de teselas para producción y su clave.
- Fuentes oficiales de instalaciones y su validación antes de cargar datos reales.
- **Revisión jurídica del aviso de privacidad** (el texto incluido es un borrador marcado como pendiente).
