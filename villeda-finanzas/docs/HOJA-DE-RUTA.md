# VILLEDA Finanzas — Hoja de ruta

**Punto de partida (v1.0, octubre 2026):** PWA local sin dependencias; datos cifrados en el dispositivo;
asistente local por reglas; sin servidor, sin bancos, sin sincronización. Contrato técnico en
`ARQUITECTURA.md`; modelo en `MODELO-DATOS.md`; investigación bancaria en `CONEXION-BANCOS.md`; diseño del
puente de IA en `IA-SERVIDOR.md`.

**Principios que ninguna fase puede romper:** separación empresa/personal; sin cifras inventadas; sólo
lectura hacia bancos; nunca pedir contraseñas bancarias en la app; privacidad por defecto (lo que salga del
dispositivo debe ser explícito, mínimo y documentado).

**Cómo leer el esfuerzo:** S = días (hasta una semana de una persona), M = 2-4 semanas, L = más de un mes o
requiere terceros (contratos, altas, revisiones). Son estimaciones de planeación, **por confirmar** con quien
ejecute. Las etiquetas **[por confirmar]** marcan hechos no verificados en fuentes oficiales.

## Resumen

| Fase | Entrega | Esfuerzo | Depende de | Riesgo principal |
|---|---|---|---|---|
| 1 | Importador de estados de cuenta (CSV/PDF) por institución | M | v1.0 completa | Encabezados y layouts reales no verificados |
| 2 | Backend: bóveda cifrada en la nube, passkeys/2FA, sincronización, respaldos automáticos | L | Fase 1 opcional; decisión de arquitectura | Gestión de claves y recuperación; operación continua |
| 3 | IA generativa vía servidor de sólo lectura | S (mínimo) → M (endurecido) | Hosting HTTPS | Datos saliendo del dispositivo; costo variable |
| 4 | Conexión bancaria de sólo lectura (Mercado Pago API; BBVA evaluado; Nu según disponibilidad) | M (MP) / L (BBVA) | Fase 2 (servidor con tokens) | Token sin alcance de sólo lectura; marco regulatorio pendiente |
| 5 | CFDI y cumplimiento fiscal (PAC, timbrado, descarga masiva SAT) | L | Fase 2 (custodia de CSD/e.firma) | Custodia de llaves fiscales; cambios normativos |
| 6 | App nativa opcional (Capacitor o Swift) | M / L | Fases 2-3 estables | Costo y mantenimiento de dos plataformas |

Orden sugerido: **1 → 3 → 2 → 4 → 5 → 6**. La fase 3 se adelanta porque es barata, no toca los datos
locales y valida el interés real en la IA; la fase 2 es el pivote que habilita 4 y 5.

---

## Fase 1 — Importador de estados de cuenta (v1.1)

**Objetivo:** dejar de capturar a mano los movimientos de Mercado Pago (empresa y personal), Nu (empresa y
personal) y BBVA (personal), importando lo que cada institución ya exporta. Detalle y fuentes en
`CONEXION-BANCOS.md` §7-§8.

**Alcance**

| Institución | Entrada | Mecanismo | Esfuerzo |
|---|---|---|---|
| Mercado Pago (ambas cuentas) | CSV de "Actividad" (app) y CSV "Todas las transacciones" / "Liberaciones" (web negocio) | Parser CSV propio (UTF-8, separador configurable, comillas). Mapeo de `TRANSACTION_TYPE`, `SETTLEMENT_NET_AMOUNT`, `FEE_AMOUNT`, `SOURCE_ID`, `BALANCE_AMOUNT`, `PAYOUT_BANK_ACCOUNT_NUMBER`. | S-M |
| Nu (TDC y Cuenta Nu) | PDF (único formato) | "Pegar texto": el usuario copia la tabla del PDF y la app la interpreta con expresiones regulares (fecha, descripción, cargo/abono, saldo). Alternativa: conversor externo → CSV (datos salen a un tercero; decisión del dueño). | M |
| BBVA (personal) | PDF (hasta 10 años). CSV/Excel para personas **[por confirmar]** | Igual que Nu. Si existe descarga CSV, parser directo. Si VILLEDA abre cuenta empresarial con Net Cash: CSV/CAMT.053 oficial. | M |

**Entregables**
- Vista "Importar" (en Empresa/Personal o en Ajustes) con: selección **obligatoria** de cuenta destino (fija el
  `ambito`), carga de archivo CSV o área de pegado de texto, vista previa editable, conteo de nuevos /
  posibles duplicados / ignorados, botón "Importar lote" y "Deshacer lote".
- Normalización al modelo `movimientos` (`MODELO-DATOS.md` §5): `fecha` ISO, `monto` positivo, `tipo` por
  signo o columna, `descripcion` ≤ 200 caracteres, `contraparte` si se identifica.
- Detección de **transferencias propias**: si el destino/origen coincide con otra cuenta registrada (CLABE,
  nombre de banco, `PAYOUT_BANK_ACCOUNT_NUMBER`), crear `transferencia` con `cuentaDestinoId`; si cruza
  ámbitos, aplicar "Retiro de socio / Aportación de capital".
- **Deduplicación**: `cuentaId + fecha + monto + tipo` más identificador externo (`mp:SOURCE_ID`) en
  `etiquetas`; los dudosos entran con `estado: 'revisar'`.
- Trazabilidad: etiquetas `importado:mercadopago|nu|bbva` y `lote:YYYYMMDD-hhmm`.
- Categorización mínima por palabras clave (SPEI, comisión, IVA, nómina, Oxxo…); el resto queda sin
  categoría para revisión.
- Validación de saldo: si el archivo trae saldo final, compararlo con `VF.calc.saldoCuenta` y avisar.
- Privacidad: el archivo se procesa en memoria y no se guarda; sólo persisten los movimientos cifrados.
- Pruebas: fixtures anónimos por institución en `tests/fixtures/` y pruebas unitarias del parser.

**Riesgos y mitigaciones**
- Encabezados del CSV de "Actividad" de la cuenta personal y layout de los PDF de Nu/BBVA **[por confirmar]**
  → obtener un archivo real de cada uno antes de programar; diseñar el parser por "perfil" configurable.
- El PDF copiado pierde columnas o une celdas → vista previa editable antes de importar.
- XLSX requiere ZIP+XML; sin dependencias no es viable en v1.1 → pedir CSV.
- Zona horaria GMT-04 por defecto en reportes de Mercado Pago → documentar configurar `America/Mexico_City`.
- Cambios de formato por parte del banco → versionar perfiles y mostrar error claro, nunca importar basura.

**Criterio de salida:** importar un mes real de cada institución sin duplicados, con saldos cuadrados contra
el estado de cuenta y utilidad de la empresa sin alteración por transferencias.

---

## Fase 2 — Backend: bóveda cifrada, autenticación fuerte, sincronización y respaldos

**Objetivo:** usar la misma información en iPhone, iPad y Mac sin perder la privacidad, y dejar de depender
de respaldos manuales.

**Arquitectura recomendada: "bóveda cifrada en la nube" (conocimiento cero)**
- El cliente sigue cifrando con AES-GCM y clave derivada de la contraseña; el servidor guarda **sólo texto
  cifrado** versionado (nunca puede leer saldos ni movimientos).
- Sincronización por **colección y registro** con `actualizado` (último en escribir gana) y registro de
  borrados (tombstones); conflicto visible al usuario sólo cuando dos dispositivos editan el mismo registro.
- "Bandeja de entrada" cifrada para datos que produzca el servidor en fases posteriores (movimientos de
  Mercado Pago, CFDI descargados): el cliente los descarga, descifra, revisa e integra.
- Autenticación: **passkeys (WebAuthn)** como método principal, **TOTP** como alternativa, códigos de
  recuperación impresos; lista de dispositivos y cierre remoto de sesión.
- Respaldos automáticos: instantáneas diarias de los blobs cifrados en almacenamiento de objetos
  (Cloudflare R2, Backblaze B2 o S3) con retención 30/90 días y restauración a un punto en el tiempo.
- Alternativa evaluable: Supabase/Firebase (menos operación, dependencia de un tercero) frente a un VPS
  propio con Node + SQLite/Postgres (más control, más mantenimiento). **[por confirmar]** costos vigentes.

**Entregables:** API mínima (`PUT/GET /boveda`, versiones, dispositivos, sesiones); cliente de
sincronización en `VF.store` (cola, reintentos, modo sin conexión); pantalla de dispositivos; política de
respaldo y procedimiento de restauración probado; aviso de privacidad (LFPDPPP) actualizado.

**Esfuerzo:** L.

**Riesgos y mitigaciones**
- Olvido de contraseña = pérdida total (igual que hoy) → kit de recuperación (clave de recuperación impresa
  que envuelve la clave de datos), nunca custodia de la contraseña en el servidor.
- Conflictos de sincronización → diseño por registro, no por archivo; pruebas con dos dispositivos.
- Passkeys dentro de una PWA instalada en iOS **[por confirmar]** comportamiento por versión → mantener TOTP.
- Operación continua (certificados, actualizaciones, monitoreo) → automatizar; presupuesto mensual explícito.
- Al existir un servidor, el dueño pasa a ser responsable del tratamiento de datos personales (aunque
  cifrados) → aviso de privacidad y bitácora de accesos.

**Criterio de salida:** capturar en el iPhone y ver el cambio en la Mac en menos de un minuto; restaurar un
respaldo de hace 7 días en un dispositivo nuevo; el servidor no puede leer ningún dato financiero.

---

## Fase 3 — IA generativa conectada vía servidor de sólo lectura

**Objetivo:** que el asistente responda preguntas libres ("¿qué pasa si adelanto el pago del préstamo?",
"explícame por qué bajó la utilidad") con la IA de Claude, sin exponer la clave de API ni los datos
detallados. Diseño, código de referencia, costos y despliegue en **`IA-SERVIDOR.md`**.

**Alcance**
- v3.0 (S): servidor mínimo (Node, `@anthropic-ai/sdk`) que recibe `{ pregunta, contexto }` y devuelve
  `{ texto }`; `contexto` = `VF.calc.resumenParaIA(estado)` (totales, sin descripciones ni contrapartes);
  CORS al origen de la app; clave en variable de entorno; límite de tasa; timeout; modelo `claude-opus-5-5`
  con esfuerzo bajo; `fallbacks: "default"`. Configuración de URL en Ajustes y "Probar".
- v3.1 (M): endurecimiento (clave compartida app-servidor, bitácora sin contenido, límites por día,
  caché del prompt de sistema), conjunto de evaluación con las 5 preguntas del brief más 20 casos reales,
  medición de costo con `response.usage`.
- v3.2 (decisión del dueño): permitir que el asistente vea **listas** (facturas pendientes por cliente,
  movimientos a revisar) implica enviar nombres y descripciones → nueva pantalla de consentimiento y ajuste
  "nivel de detalle compartido".

**Esfuerzo:** S → M.

**Riesgos y mitigaciones**
- Cifras inventadas → prompt de sólo lectura que obliga a usar únicamente el contexto y a declarar faltantes;
  evaluación periódica; la app sigue mostrando sus propias cifras de `VF.calc`.
- Datos saliendo del dispositivo → resumen agregado por diseño, HTTPS, sin registro de contenido en el
  servidor, revisión de la política de retención de datos de la API **[por confirmar]** vigente.
- Costo variable → límite de tasa, `max_tokens` corto, esfuerzo bajo; estimación en `IA-SERVIDOR.md`.
- Dependencia de conectividad → siempre cae al asistente local y lo indica.

**Criterio de salida:** las 5 preguntas del brief respondidas por la IA coinciden con las cifras del
asistente local; una pregunta sin dato en el contexto recibe "ese dato no viene en el resumen".

---

## Fase 4 — Conexión bancaria de sólo lectura

**Objetivo:** reducir la importación manual de la fase 1 con lectura automática donde exista una vía
oficial. Toda la investigación y las reglas no negociables están en **`CONEXION-BANCOS.md`** (§1-§5, §8.2).

| Institución | Vía | Qué se hace | Esfuerzo | Estado |
|---|---|---|---|---|
| **Mercado Pago (empresa y personal)** | **API oficial de Reportes** (`/v1/account/settlement_report`, `/v1/account/release_report`) con Access Token de una aplicación propia, **guardado en el servidor** de la fase 2 | Programar el reporte diario, descargar el CSV, normalizar y depositar en la "bandeja de entrada" cifrada; la PWA sólo recibe movimientos normalizados. Una aplicación por cuenta (o una + OAuth con refresh de 6 meses). Configurar `display_timezone` México. | M | Primero. Acceso de la **cuenta personal** a reportes **[por confirmar]**. |
| **BBVA (personal)** | Agregador con credenciales (Belvo/Syncfy/Prometeo) o API regulada | **Sólo evaluar**; no integrar salvo que: (a) la CNBV publique las reglas de datos transaccionales y BBVA exponga API al titular; (b) VILLEDA abra cuenta empresarial con Net Cash (CSV/CAMT.053 oficial, sin terceros); o (c) se acepte formalmente un agregador con contrato y análisis de riesgo. | L | Evaluación; hoy **no recomendado** (credenciales a terceros, OTP en cada login, desde 1,000 USD/mes en el único precio público). |
| **Nu (empresa y personal)** | Ninguna API ni exportación CSV encontradas | Mantener importación por PDF (fase 1). Revisar cada 6 meses. | — | Según disponibilidad. |

**Riesgos y mitigaciones**
- Mercado Pago no documenta un alcance de **sólo lectura**: el token puede operar pagos → aplicación dedicada
  únicamente a reportes, servidor sin endpoints de escritura, rotación periódica, alertas de uso, revocación
  inmediata desde Mercado Pago ante sospecha. Nunca en la PWA ("nunca debe exponerse en el frontend").
- Marco regulatorio: reglas de datos transaccionales de la Ley Fintech **sin publicarse** (amparo en trámite,
  enero 2026) → no diseñar sobre APIs bancarias inexistentes; releer la situación en abril de 2027.
- Fragilidad de agregadores (scraping sin respaldo regulatorio) → evitar.
- Separación de ámbitos: cada sincronización se asocia a **una** cuenta con `ambito` fijo.

**Criterio de salida:** los movimientos de ambas cuentas de Mercado Pago aparecen cada mañana en la bandeja
de entrada, deduplicados contra lo importado a mano, y el saldo coincide con `BALANCE_AMOUNT`.

---

## Fase 5 — CFDI, facturación y cumplimiento fiscal

**Objetivo:** que las facturas de la app sean CFDI reales y que la información fiscal (ingresos, gastos
deducibles, IVA) salga cuadrada con el SAT.

**Alcance**
- **Emisión CFDI 4.0** a través de un **PAC** (Proveedor Autorizado de Certificación): timbrado desde la app
  (datos fiscales del cliente: RFC, régimen, código postal, uso de CFDI), **complemento de recepción de
  pagos (REP)** para facturas pagadas después (método PPD), cancelación con motivo y aceptación del receptor.
- **Descarga masiva** de CFDI emitidos y recibidos vía el servicio web del SAT (requiere e.firma) o a través
  del PAC/terceros, para conciliar automáticamente: CFDI recibidos ↔ cuentas por pagar y gastos; CFDI
  emitidos ↔ facturas y cobros. Límites y plazos del servicio **[por confirmar]**.
- **Resumen de IVA real** (trasladado y acreditable por CFDI y por fecha de pago) sustituyendo el estimado
  16/116 actual; paquete para el contador con XML + PDF + CSV.
- Obligaciones informativas relacionadas (p. ej. DIOT) **[por confirmar]** alcance con el contador.

**Esfuerzo:** L (integración PAC, SAT, pruebas en ambiente de pruebas del PAC, revisión con contador).

**Dependencias:** fase 2 (el **CSD** y la **e.firma** son llaves privadas que **nunca** deben estar en la
PWA; se custodian en el servidor con cifrado y uso bajo autorización explícita del dueño), contrato con PAC
(costo por timbre y mensualidad **[por confirmar]**), datos fiscales de VILLEDA Inc y de los clientes.

**Riesgos y mitigaciones**
- Custodia de llaves fiscales → cifrado en reposo, módulo de firma aislado, bitácora, revocación.
- Cambios normativos (versiones de CFDI, catálogos del SAT) → depender del PAC para validaciones; pruebas
  automatizadas con el ambiente de pruebas.
- Errores de emisión con consecuencias fiscales → flujo de revisión antes de timbrar; cancelación guiada.
- Disponibilidad del SAT → reintentos y colas; nunca bloquear el uso normal de la app.

**Criterio de salida:** una factura emitida desde la app con UUID válido en el portal del SAT; un mes
conciliado (CFDI emitidos y recibidos contra facturas, CxP y movimientos) revisado y aprobado por el contador.

---

## Fase 6 — App nativa (opcional)

**Objetivo:** sólo si la PWA deja de bastar. Disparadores a vigilar: notificaciones confiables de
vencimientos (las PWA instaladas en iOS admiten notificaciones web desde iOS 16.4 **[por confirmar]**
alcance), desbloqueo con Face ID / Touch ID, recibir PDF/CSV desde la hoja "Compartir" de iOS, sincronización
en segundo plano.

| Opción | Qué implica | Esfuerzo |
|---|---|---|
| Seguir con la PWA | Cero costo adicional; limitaciones de iOS en notificaciones y almacenamiento. | — |
| **Capacitor** (envoltorio nativo del mismo código) | Reutiliza HTML/CSS/JS; añade Face ID, Keychain, notificaciones push, extensión de compartir. Publicación en App Store (Apple Developer Program, costo anual **[por confirmar]**) o distribución interna por TestFlight. | M |
| SwiftUI nativo | Reescritura; mejor integración; dos bases de código. | L |

**Riesgos:** revisión de la App Store para apps financieras; mantenimiento duplicado; dependencia del
ecosistema Apple. **Recomendación:** no iniciar antes de que las fases 2 y 3 estén estables y usadas.

---

## Transversal (todas las fases)

- **Pruebas:** mantener `node tests/calc.test.js`, `node tests/store.test.js` y `node tests/smoke.js` en
  verde; añadir pruebas por fase (parsers, sincronización, servidor de IA con respuestas simuladas).
- **Versionado:** subir `VF_VERSION` en `sw.js` y `VF.app.version` en cada publicación; migraciones de
  `estado.version` documentadas en `MODELO-DATOS.md` §16.
- **Seguridad:** revisión de dependencias (hoy ninguna en la PWA); cabeceras de seguridad en el hosting;
  nunca secretos en el cliente.
- **Privacidad y legal:** aviso de privacidad cuando exista servidor; registro de qué sale del dispositivo
  por fase; aviso permanente "prototipo, no es asesoría financiera ni contable".

## Decisiones que debe tomar el dueño

1. ¿Publicar la PWA en el sitio (ruta no indexada) o usarla sólo en la Mac? (habilita la instalación en iPhone/iPad).
2. ¿Aceptar que un resumen de totales viaje a un servidor de IA propio? (fase 3).
3. ¿Invertir en servidor y operación mensual para sincronizar dispositivos? (fase 2).
4. ¿Crear aplicaciones en Mercado Pago Developers con token guardado en servidor? (fase 4).
5. ¿Contratar PAC y custodiar CSD/e.firma en el servidor? (fase 5).
6. ¿Subir estados de cuenta en PDF a un conversor externo (Finos u otro) o pegar texto a mano? (fase 1).

## Pendientes de verificación (consolidado)

Lista de trabajo en `CONEXION-BANCOS.md` §9 más: comportamiento de passkeys en PWA iOS; notificaciones web en
PWA iOS; costos vigentes de hosting, PAC y Apple Developer Program; política de retención de datos de la API
de Anthropic; límites del servicio de descarga masiva del SAT. Revisar en **abril de 2027**.
