# VILLEDA Finanzas — Conexión con bancos (solo lectura)

**Para:** dirección de VILLEDA Inc. (constructora, México)
**Alcance:** Mercado Pago (cuenta personal y Cuenta Negocio/empresa), Nu México (cuenta y tarjeta personal con uso empresarial) y BBVA México (cuenta personal).
**Pregunta que responde:** ¿cómo puede una app financiera privada de **solo lectura** obtener saldos y movimientos de esas tres instituciones hoy (octubre de 2026) para alimentar VILLEDA Finanzas?
**Fecha de consulta de todas las fuentes:** 26 de octubre de 2026. Todo lo que no se pudo verificar en una fuente oficial está marcado **[por confirmar]**. No hay cifras inventadas: donde no hay precio público se dice "no publicado".

---

## 0. Resumen ejecutivo (lo que un dueño necesita saber)

| Institución | ¿API oficial para que el titular lea saldo/movimientos? | ¿Exporta archivo desde la app/web? | Veredicto para VILLEDA Finanzas |
|---|---|---|---|
| **Mercado Pago** | **Sí.** API de Reportes ("Todas las transacciones"/Dinero en cuenta y "Liberaciones") con Access Token de una aplicación creada en Mercado Pago Developers. | Sí: CSV/XLSX/PDF desde "Actividad" (app) o "Informes y facturación" (web). | Única institución con vía oficial y automatizable. Importador CSV en v1.1; API en v2. |
| **Nu México** | **No** se encontró API pública ni portal de desarrolladores para clientes. | Solo **PDF** (tarjeta de crédito y Cuenta Nu). Sin CSV: hay una petición de usuarios de mayo 2026 sin respuesta oficial. | Captura asistida desde PDF (texto pegado) o conversor externo. Ningún agregador consultado lista a Nu. |
| **BBVA México** | **No** para personas físicas. BBVA API Market México es solo para empresas (pagos/cobros), no consulta de saldos. | Personas: estado de cuenta **PDF** (hasta 10 años). CSV/TXT/C43/CAMT.053 solo en BBVA Net Cash (empresas). CSV para personas **[por confirmar]**. | PDF → texto pegado en v1.1; agregador (Belvo/Syncfy) solo si se acepta compartir credenciales con un tercero, lo cual **no** se recomienda para una app personal. |

**Marco regulatorio (clave para entender por qué no hay APIs bancarias):** la Ley Fintech (2018, art. 76) obliga a compartir datos vía APIs en tres capas: datos abiertos, agregados y transaccionales. La CNBV solo ha publicado las reglas de **datos abiertos** (DOF 4 de junio de 2020: cajeros, sucursales, productos). Las reglas de **datos transaccionales** (las que permitirían leer tu cuenta con tu consentimiento) **siguen sin publicarse** a octubre de 2026; dos emprendedores promovieron un amparo contra CNBV, Banxico y SHCP por la omisión (noticia del 12 de enero de 2026). Por eso en México los agregadores operan con credenciales del usuario (modelo "widget con usuario/contraseña"), no con APIs estandarizadas.

---

## 1. Mercado Pago

### 1.1 Quién es y cómo opera en México
- Sitio oficial operado por **"MP Agregador, S. de R.L. de C.V."** (pie de página de mercadopago.com.mx, consultado 2026-10-26).
- Autorizada por la CNBV para operar como **Institución de Fondos de Pago Electrónico (IFPE)** en mayo de 2022 (El CEO: https://elceo.com/mercados/mercado-pago-se-suma-a-las-fintech-autorizadas-por-la-cnbv/).
- Dos tipos de cuenta: **Cuenta Personal** y **Cuenta Negocio** (lanzada para pymes: personas morales y personas físicas con actividad empresarial; requiere RFC, identificación y comprobante de domicilio; Mercado Pago recomienda que correo y teléfono no estén ligados a una cuenta personal). Fuente: https://www.mercadopago.com.mx/blog/como-crear-una-cuenta-de-negocio.

### 1.2 API oficial: Reportes financieros (Mercado Pago Developers)
Documentación (México): https://www.mercadopago.com.mx/developers/es/docs/checkout-api-payments/additional-content/reports/introduction

Mercado Pago ofrece cinco reportes; los dos que importan para una app de solo lectura son:

| Reporte | Qué contiene (texto oficial) | Recurso de API |
|---|---|---|
| **Todas las transacciones** (antes "Dinero en cuenta" / Account Money) | "Informa sobre las transacciones/movimientos que afectaron su saldo en cuenta." Incluye disponible, en proceso y retenido. | `/v1/account/settlement_report` |
| **Liberaciones** (Released Money / release report) | "Proporciona la composición del saldo disponible en su cuenta" por período; incluye columna de **saldo** (`BALANCE_AMOUNT`) y retiros a banco. | `/v1/account/release_report` |

**Endpoints verificados** (base `https://api.mercadopago.com`, header `Authorization: Bearer ACCESS_TOKEN`). Fuente: https://www.mercadopago.com.mx/developers/es/docs/reports/account-money/api.md y https://www.mercadopago.com.mx/developers/es/docs/checkout-api-payments/additional-content/reports/released-money/api

| Acción | Todas las transacciones | Liberaciones |
|---|---|---|
| Crear/leer/actualizar configuración (columnas, prefijo, frecuencia, separador, zona horaria, idioma) | `POST/GET/PUT /v1/account/settlement_report/config` | `POST/GET/PUT /v1/account/release_report/config` |
| Generar reporte manual por rango de fechas (`begin_date`, `end_date` en ISO 8601 UTC) | `POST /v1/account/settlement_report` → HTTP 202 (asíncrono) | `POST /v1/account/release_report` → 202 |
| Listar reportes generados | `GET /v1/account/settlement_report/list` | `GET /v1/account/release_report/list` |
| Descargar archivo | `GET /v1/account/settlement_report/:file_name` | `GET /v1/account/release_report/:file_name` |
| Activar / desactivar generación automática | `POST` / `DELETE /v1/account/settlement_report/schedule` | documentado en la misma sección **[por confirmar ruta exacta]** |

Detalles operativos documentados:
- El reporte se genera **de forma asíncrona**; un HTTP 203 significa que no se pudo crear y hay que reintentar con las fechas que indique el sistema.
- `frequency.type` admite `daily`, `weekly`, `monthly`. "Configurar el atributo `frequency` no implica que el reporte se genere automáticamente": hay que activar el `schedule`.
- **Zona horaria por defecto GMT-04** si no se fija `display_timezone`: para México hay que configurar `America/Mexico_City` o se desfasan las fechas.
- Formato **CSV** (separador configurable) y XLSX; Mercado Pago recomienda CSV en **UTF-8**.
- `header_language` admite `es`, `en`, `pt`.
- Rango máximo de fechas por reporte: **no indicado en la documentación [por confirmar]**.

**Valores de `TRANSACTION_TYPE`** (Todas las transacciones): `SETTLEMENT` (pago aprobado), `REFUND`, `CHARGEBACK`, `DISPUTE`, `WITHDRAWAL` (retiro a banco), `WITHDRAWAL_CANCEL`, `PAYOUT`.
**Valores de `RECORD_TYPE`** (Liberaciones): `initial_available_balance`, `release`, `total`, `available_balance`; y `DESCRIPTION` con valores como `payment`, `payout`, `withdrawal`, `refund`, `chargeback`, `dispute`, `shipping`, `tax_*`, `reserve_for_*`, `asset_management_gain/loss` (rendimientos), entre otros.
Fuente de campos: https://www.mercadopago.com.mx/developers/es/docs/checkout-api-payments/additional-content/reports/account-money/report-fields (66 columnas) y https://www.mercadopago.com.mx/developers/es/docs/checkout-api-payments/additional-content/reports/released-money/report-fields (60 columnas).

### 1.3 Credenciales, alcance y cuentas personales
Fuente: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/credentials y https://www.mercadopago.com.mx/developers/es/docs/security/oauth/introduction

- Se crea una **aplicación** en "Tus integraciones"; requiere "contar con una cuenta de Mercado Pago o Mercado Libre". Genera **Public Key** y **Access Token** (prueba y producción) y, en producción, **Client ID / Client Secret** para OAuth.
- Para activar producción hay que completar sector de actividad y sitio web del negocio y aceptar términos.
- **Advertencia oficial sobre el Access Token:** "Nunca debe compartirse ni exponerse en el frontend." Es decir: **no puede vivir dentro de la PWA**; necesita un pequeño servidor.
- **Alcance de solo lectura:** la documentación pública **no lista scopes** (la URL de autorización OAuth no tiene parámetro `scope`; solo dice que la pantalla de consentimiento "explicita los ámbitos"). En la práctica el Access Token de una aplicación propia da acceso a toda la API de la cuenta (cobros, reembolsos, etc.). **Conclusión: no existe un token "solo lectura" documentado [por confirmar con soporte de Developers]**; hay que tratarlo como credencial de máximo privilegio.
- **OAuth** (para que una sola aplicación lea las dos cuentas): flujo `authorization_code` (código vence en 10 min), **Access Token válido 180 días**, **refresh_token 6 meses**; `client_credentials` da tokens de 6 horas. Alternativa más simple: crear una aplicación **en cada cuenta** (personal y negocio) y usar dos Access Tokens.
- **¿Cuenta personal?** La documentación de reportes habla de "vendedores" y el panel web "Informes y facturación" se describe en blogs orientados a negocio. Un blog oficial de agosto 2026 describe la exportación desde "Actividad" para cualquier "cuenta digital". Que una **cuenta personal** pueda crear aplicación y generar estos reportes por API **[por confirmar probando con la cuenta personal de VILLEDA]**; para la Cuenta Negocio está documentado.

### 1.4 Exportación manual (sin API)
Fuentes oficiales: blog "Cómo exportar y analizar tus movimientos" (28 ago 2026) https://www.mercadopago.com.mx/blog/exportar-analizar-movimientos-mercado-pago ; blog "Reportes de cuenta para tu contador" (7 jul 2026) https://www.mercadopago.com.mx/blog/descargar-reportes-de-cuenta-para-contador ; blog "Cómo consultar saldos y movimientos" (7 jul 2026) https://www.mercadopago.com.mx/blog/como-consultar-saldos-y-movimientos

- **App:** "Actividad" → filtro de fechas → "Descargar"/"Exportar"; o "Movimientos"/"Resumen de cuenta" → descarga en **PDF o Excel**.
- **Web (negocio):** "Informes y facturación" → "Reportes de ventas y extractos de cuenta" → "Todas las transacciones" o "Liberaciones" → rango → "Crear reporte" → enlace por correo. Formatos **.csv / .xlsx**.
- Historial en línea: "los seis meses inmediatos anteriores"; períodos anteriores se solicitan desde la app y se atienden en "menos de cinco días hábiles".
- Solo aparecen **operaciones aprobadas** (no pendientes ni rechazadas).
- Columnas que el blog oficial enumera para el archivo de "Actividad": fecha y hora, tipo de operación, monto y moneda (con signo), descripción o referencia, **saldo resultante**.

---

## 2. Nu México

### 2.1 Situación institucional
- Licencia bancaria aprobada por la CNBV el 24 de abril de 2025; autorización final de inicio de operaciones el 10 de julio de 2026; **opera como Institución de Banca Múltiple desde el 6 de agosto de 2026** (blog oficial, 13 ago 2026: https://blog.nu.com.mx/nubank/como-nu-se-convirtio-en-banco/). Ser banco no cambia nada para la lectura de datos: no hay regulación de datos transaccionales vigente (ver §4).

### 2.2 API pública
- **No se encontró** ningún portal de desarrolladores, API o programa de acceso a datos para clientes de Nu México (búsquedas en nu.com.mx, blog.nu.com.mx y comunidad.nu.com.mx, 2026-10-26). **Conclusión: no hay API oficial.**

### 2.3 Exportación desde la app
| Producto | Ruta en la app (fuente oficial) | Formato | Notas |
|---|---|---|---|
| Tarjeta de crédito | "Tarjeta de crédito" → "Estados de cuenta" → mes → NIP → "Guardar o compartir". Historial "desde que activaste tu tarjeta". Disponible "máximo 48 horas después de tu fecha de corte". También llega por correo. https://blog.nu.com.mx/productos-nu/tarjeta-de-credito/consultar-tu-estado-de-cuenta-en-la-app-nu/ | **PDF** | Sin CSV/Excel. |
| Cuenta Nu (débito) | "Cuenta Nu" → "Estados de cuenta" (misma ruta que la constancia anual; blog 29 may 2026 https://blog.nu.com.mx/productos-nu/cuenta-nu/constancia-ingresos-y-retenciones-cuenta-nu/). La función se desplegó "de manera gradual" desde septiembre 2023 (respuesta oficial en https://comunidad.nu.com.mx/t/estado-de-cuenta-en-la-tarjeta-de-debito/14471). | **PDF** | Estado mensual en PDF para Cuenta Nu: descrito por usuarios; ruta oficial confirmada solo para la constancia **[por confirmar en la app]**. |
| Exportar CSV/Excel | Petición de usuario del 29 may 2026 "Exportar movimientos de alguna forma que no sea PDF" **sin respuesta oficial** (https://comunidad.nu.com.mx/t/exportar-movimientos-de-alguna-forma-que-no-sea-pdf/31686). | — | **No existe.** |

### 2.4 Cobertura en agregadores
Ningún agregador consultado lista a Nu México: no aparece en la cobertura pública de Syncfy, ni en la tabla de instituciones mexicanas de Belvo (domiciliación), ni en la documentación pública de Prometeo o Fintoc (ver §5). Finos (conversor de PDF) sí lista a Nu entre los bancos cuyos PDF procesa (§6).

---

## 3. BBVA México

### 3.1 API oficial
- **BBVA API Market México** (https://www.bbva.mx/empresas/landings/bbva-api-market.html) ofrece a **empresas**: API Business Payments ("Instruye pagos a cuentas BBVA y transferencias SPEI desde tu cuenta empresarial"), API CoDi Request to Pay, API Pago Directo BBVA y webhooks de estado de pagos. El registro al sandbox es libre ("Crea tu cuenta, seas o no cliente de BBVA", pide razón social y RFC), pero "para operar en producción, sí necesitas cumplir las condiciones y contratos aplicables" (contrato de canales directos, cuenta BBVA habilitada). **No hay API de consulta de saldos/movimientos y nada para personas físicas.**
- En septiembre de 2023 BBVA anunció tres APIs de tesorería (una de "saldos y movimientos" de cuentas BBVA y de otras entidades) disponibles desde **BBVA Pivot** para clientes corporativos, "que se incluirán próximamente en API Market" (https://www.bbva.com/es/innovacion/bbva-agiliza-la-conexion-a-sus-soluciones-de-gestion-empresarial-con-tres-nuevas-apis/). Su disponibilidad en México para una pyme **[por confirmar]**; no aplica a la cuenta personal.
- El portal global https://www.bbvaapimarket.com/en/ se dirige a "companies and businesses"; no publica una API de cuentas de personas para México.

### 3.2 Exportación de movimientos
| Canal | Qué se puede obtener | Fuente |
|---|---|---|
| App BBVA / bbva.mx (personas) | Estado de cuenta en **PDF**, sin costo, con requisitos fiscales, **hasta 10 años** de antigüedad (cheques y tarjetas). | BBVA, 26 ene 2025: https://www.bbva.com/es/mx/salud-financiera/en-bbva-mexico-se-puede-obtener-un-estado-de-cuenta-sin-llamar-o-salir-de-casa/ |
| bbva.mx (personas) | Consulta de saldos y movimientos en línea (el folleto informativo menciona hasta dos meses atrás). Exportar movimientos a **CSV/Excel para personas: no encontrado en fuentes oficiales [por confirmar en la app, sección Movimientos]**. | https://www.bbva.mx/personas/banca-por-internet.html |
| BBVA Net Cash (empresas) | "Puedes obtener el detalle de los movimientos en formatos PDF, CSV y TXT o en formatos estandarizados (C43 y CAMT 053)." Consultas hasta 1 año atrás. | https://www.bbva.mx/empresas/servicios-digitales/nomina-en-tiempo-real.html ; https://www.bbva.mx/empresas/servicios-digitales/transferencias-en-tiempo-real.html |

Implicación: si en el futuro VILLEDA abre una cuenta **empresarial** BBVA con Net Cash, el CSV/CAMT.053 oficial resuelve la importación sin terceros. Para la cuenta personal, hoy la vía verificable es el PDF.

---

## 4. Open Banking en México: estado real a octubre de 2026

| Capa (art. 76 Ley Fintech) | Estado | Fuente |
|---|---|---|
| Datos abiertos (cajeros, sucursales, productos) | **Vigente.** "Disposiciones de carácter general relativas a las interfaces de programación de aplicaciones informáticas estandarizadas", DOF 4 jun 2020, en vigor 5 jun 2020. | Garrigues (15 jun 2020): https://www.garrigues.com/es_ES/garrigues-digital/fintech-mexico-aprueba-disposiciones-caracter-general-relativas-apis ; síntesis DOF SCJN: https://www.scjn.gob.mx/sites/default/files/sintesis_dof_gocdmx/documento/2020-06/DOF%2004062020%20%20S%C3%8DNTESIS.pdf |
| Datos agregados | **Pendiente** según Fiskil y los promoventes del amparo; Latinia (22 jun 2026) los describe como "operativos" — **discrepancia entre fuentes [por confirmar en CNBV]**. | https://www.fiskil.com/es/open-finance-tracker/mexico ; https://latinia.com/en/resources/open-finance-in-latam-regulatory-map-2026 |
| **Datos transaccionales** (leer cuentas con consentimiento) | **Sin reglas publicadas.** Plazo legal original: 24 meses desde la ley (vencido en 2020 según los promoventes). Amparo de Adrián Martínez Pérez y Gerardo Moreno José contra CNBV, Banxico y SHCP ante el Juzgado Octavo de Distrito en Materia Administrativa (CDMX); en trámite. | El CEO, 12 ene 2026: https://elceo.com/tecnologia/retraso-en-open-finance-llega-a-tribunales-promueven-amparo-contra-cnbv-banxico-y-hacienda/ ; El Financiero (opinión del promovente), 7 ene 2026 |

**Consecuencia práctica:** ningún banco mexicano está obligado hoy a exponer una API de cuentas al titular ni a terceros. Los agregadores conectan con **credenciales del usuario** (el cliente escribe su usuario y contraseña de banca en línea en el widget del agregador) o con acuerdos bilaterales. No hay fuentes oficiales (CNBV/DOF) que indiquen fecha de publicación de las reglas transaccionales.

---

## 5. Agregadores de datos financieros en México

Todos son **B2B**: contratan con empresas (contrato, alta comercial, en algunos casos KYC de la empresa); ninguno publica un plan para uso personal.

| Agregador | Qué es / cómo conecta | Cobertura verificada de BBVA / Nu / Mercado Pago | Precio público | Fuente (2026-10-26) |
|---|---|---|---|---|
| **Belvo** (México; IFPE autorizada por CNBV) | Open finance API: agregación (cuentas, transacciones, saldos), SAT, IMSS, pagos. Widget con credenciales del usuario; ID de institución tipo `<banco>_mx_retail`. | **BBVA:** aparece como `mx_bbva_bancomer` en la lista de **domiciliación** (pagos). La lista pública de instituciones para **agregación** en México no pudo consultarse (la documentación responde 404/429) **[por confirmar]**. **Nu y Mercado Pago:** no aparecen en ninguna lista mexicana pública de Belvo. | **Sandbox gratis; Launch 1,000 USD/mes; Growth a cotizar.** "Production access requires a paid plan." | https://belvo.com/plans-and-pricing/ ; https://developers.belvo.com/products/payments_mexico/direct-debit-institutions ; https://developers.belvo.com/reference/listinstitutions |
| **Syncfy** (Paybook, México) | Open Data: el usuario registra "usuario y contraseña o token" en un widget; Syncfy valida y "descarga automáticamente la información disponible en el portal" (equivale a lectura automatizada del portal). También SAT (CIEC) y wallets. | **BBVA Personal y BBVA Empresas: sí.** **Mercado Pago México: sí** (como digital wallet). **Nu: no aparece.** 95 integraciones en 6 países. | No publicado. Registro "Start Now" + ventas. | https://syncfy.com/coverage/ ; https://syncfy.com/products/opendata/ |
| **Finerio Connect** (México) | Agregación bancaria + categorización/PFM + APIs para "instituciones financieras". Contratación vía demo/sesión técnica. | No publica lista de bancos. **[por confirmar]** para los tres. | No publicado. | https://finerioconnect.com/ |
| **Prometeo** (Uruguay) | Banking API multi-país: login con credenciales del usuario; `bbva_mx` requiere OTP en cada login. Fuerte en validación de cuentas y pagos; afirma "100% SPEI bank coverage" (validación, no necesariamente movimientos). | **BBVA México: existe el proveedor `bbva_mx` (login con OTP).** Nu y Mercado Pago: no mencionados. Documentación completa protegida con contraseña. | No publicado. | https://prometeo-python.readthedocs.io/en/latest/guides/banking.html ; https://prometeoapi.com/ |
| **Fintoc** (Chile; IFPE en México 2025) | Pagos A2A y "Movimientos" (lectura de cuentas). | El módulo **Movimientos solo cubre bancos de Chile**; en México ofrece solo pagos. **No sirve** para este caso. | Publicado solo para pagos. | https://docs.fintoc.com/_llms/v2026-02-01/es/guias.txt |

**Riesgos de usar un agregador en una app personal:**
1. **Credenciales bancarias en manos de un tercero.** Aun cifradas, el titular entrega usuario/contraseña (y a veces token/OTP) de su banca en línea; los contratos bancarios suelen prohibir compartir claves y el banco puede rechazar aclaraciones por fraude. Para BBVA personal el login además pide **OTP**, lo que obliga a intervención humana en cada sincronización.
2. **Costo fijo desproporcionado**: el único precio público (Belvo Launch) es 1,000 USD/mes para un uso de 3 cuentas.
3. **Fragilidad**: cambios en el portal del banco rompen la conexión; sin regulación, el banco no está obligado a mantenerla.
4. **Alta como empresa**: contrato, posible KYC y responsabilidad de tratamiento de datos personales (LFPDPPP) para VILLEDA Inc.

**Recomendación: no integrar agregadores con credenciales del usuario en VILLEDA Finanzas**, salvo evaluación formal en v3 y únicamente para la cuenta BBVA si para entonces hay API regulada o un acuerdo bilateral documentado.

---

## 6. Círculo de Crédito y "Finos": qué son realmente

### Círculo de Crédito
- Es una **Sociedad de Información Crediticia** (buró de crédito): vende reportes de crédito, scores y analítica a "otorgantes" (bancos, fintech, retailers) y ofrece un **API marketplace B2B** (p. ej., alianza con Credolab en 2023 para scoring conductual). Atiende a más de 1,700 clientes empresariales.
- El 7 de julio de 2026 **Equifax** anunció un acuerdo definitivo para adquirirla (valor de empresa 750 millones USD; cierre previsto 4T 2026, sujeto a autorizaciones). Fuentes: https://assets.equifax.com/assets/mexico/spanish/acuerdo_definitivo_para_adquirir_circulo_de_credito_en_mexico.pdf ; https://expansion.mx/economia/2026/07/08/equifax-compra-circulo-de-credito-en-750-millones-de-dolares
- **No ofrece agregación de saldos ni movimientos de cuentas bancarias del usuario** ni API de open banking para titulares (no se encontró ningún producto así; el sitio principal no permitió consulta automatizada, 403). **No es una opción para VILLEDA Finanzas.**

### Finos (getfinos.com)
- **Sí existe.** Es un conversor de **estados de cuenta PDF a Excel/CSV/JSON** (no un agregador): "no necesitas dar tu usuario ni contraseña del banco — solo el PDF". Hecho en LATAM, soporte +52, precios en MXN; el pie de página acredita a "SɅCVS" (sacvs.com); **razón social y país de constitución no publicados [por confirmar]**.
- Bancos listados: 58, incluidos **BBVA México y Nu** (y Santander, Banamex, Banorte, HSBC, Scotiabank, Stori). **Mercado Pago no aparece** en la lista. Ofrece agregar un banco nuevo en 48–72 h con una muestra.
- Precio publicado: **30 hojas gratis al mes** (no acumulables), después **$5 MXN por hoja**, prepago sin suscripción. Tiene **API REST** (Bearer API key con scopes `read` y `statements:write`, carga asíncrona 202, PDF hasta 10 MB, `limit` máx. 200, 429 con `Retry-After`) y menciona MCP.
- Fuentes: https://getfinos.com/es/convertidor/ ; https://getfinos.com/es/api/
- **Riesgo:** se sube a un tercero un documento con nombre, CLABE, saldos y todos los movimientos. Para una constructora puede ser aceptable con contrato/aviso de privacidad revisado; para datos personales del dueño, decidir conscientemente. Alternativas del mismo tipo encontradas (sin verificar calidad): Contalink, ilovecfdi, AIContA, ExtractPro, Fisentia.

---

## 7. Alternativa sin API, recomendada para la v1.1: importar lo que cada institución ya exporta

Principio: el usuario descarga el archivo oficial desde la app del banco (nunca da contraseñas a VILLEDA Finanzas), lo arrastra a la PWA y la app lo normaliza al modelo `movimientos` de `docs/ARQUITECTURA.md` (`{ ambito, cuentaId, tipo, monto, fecha, categoria, descripcion, contraparte, estado, etiquetas }`).

### 7.1 Formatos disponibles por institución

| Institución | Archivo oficial | Cómo lo obtiene el usuario | Parseable en la PWA sin librerías |
|---|---|---|---|
| Mercado Pago (personal y negocio) | **CSV** (UTF-8, separador configurable) / **XLSX** / PDF | App: "Actividad" → "Descargar". Web negocio: "Informes y facturación" → "Todas las transacciones" o "Liberaciones". | **CSV: sí** (parser propio). XLSX: requiere leer ZIP+XML; evitar en v1.1 (la app no usa dependencias). |
| Nu (TDC y Cuenta Nu) | **PDF** únicamente | "Tarjeta de crédito" / "Cuenta Nu" → "Estados de cuenta" → NIP → guardar. | PDF binario: no. **Sí** vía "pegar texto": el usuario abre el PDF, selecciona la tabla de movimientos, copia y pega en la app; el importador parsea líneas con expresiones regulares. Alternativa: conversor externo (Finos) → CSV. |
| BBVA (personal) | **PDF** (hasta 10 años). CSV para personas **[por confirmar]**. | App/bbva.mx → estado de cuenta → PDF. Si existiera "Descargar movimientos" en Excel/CSV, usarlo. | Igual que Nu: pegar texto o conversor externo. Si VILLEDA abre cuenta empresarial con Net Cash: **CSV/CAMT.053 oficial**. |

### 7.2 Columnas típicas para diseñar el importador

**Mercado Pago — "Todas las transacciones" (CSV oficial; 66 columnas, las útiles):**

| Columna | Uso en VILLEDA Finanzas |
|---|---|
| `SOURCE_ID` | Identificador único → clave de deduplicación (etiqueta `mp:SOURCE_ID`). |
| `TRANSACTION_DATE` / `TRANSACTION_DATE_SHORT` (YYYY-MM-DD) | `fecha` (usar la versión corta; verificar zona horaria configurada). |
| `SETTLEMENT_DATE` | Fecha de aprobación (informativa). |
| `TRANSACTION_TYPE` | `SETTLEMENT` → ingreso; `REFUND`/`CHARGEBACK`/`DISPUTE` → gasto (o ajuste, estado `revisar`); `WITHDRAWAL`/`PAYOUT` → **transferencia** hacia la cuenta bancaria destino; `WITHDRAWAL_CANCEL` → reversa. |
| `TRANSACTION_AMOUNT` | Monto bruto. |
| `FEE_AMOUNT` | Comisiones + IVA → movimiento `gasto` categoría "Comisiones" (o restar para neto). |
| `SETTLEMENT_NET_AMOUNT` | "Monto neto de la operación que impactó en tu dinero" → `monto` recomendado. |
| `PAYMENT_METHOD`, `PAYMENT_METHOD_TYPE`, `ISSUER_NAME`, `POI_BANK_NAME` | `descripcion` / `contraparte`. |
| `EXTERNAL_REFERENCE`, `ORDER_ID`, `DESCRIPTION` | Referencia para conciliar con facturas (`facturaId`). |
| `TRANSACTION_CURRENCY` | Validar `MXN`. |

**Mercado Pago — "Liberaciones" (CSV oficial; 60 columnas, las útiles):** `DATE`, `SOURCE_ID`, `RECORD_TYPE` (`initial_available_balance` / `release` / `total` / `available_balance`), `DESCRIPTION` (`payment`, `payout`, `withdrawal`, `refund`, `chargeback`, `asset_management_gain`…), `NET_CREDIT_AMOUNT`, `NET_DEBIT_AMOUNT`, `GROSS_AMOUNT`, `MP_FEE_AMOUNT`, **`BALANCE_AMOUNT`** (saldo tras la operación → permite validar `saldoInicial`/saldo de la cuenta), `PAYOUT_BANK_ACCOUNT_NUMBER` (cuenta destino del retiro → detectar transferencia a BBVA/Nu).

**Mercado Pago — exportación de "Actividad" (app, cualquier cuenta):** según el blog oficial las filas traen fecha y hora, tipo de operación, monto y moneda con signo, descripción/referencia y saldo resultante. Los encabezados exactos del archivo **[por confirmar con una descarga real de la cuenta personal]**.

**Nu — PDF (estructura reportada por conversores de terceros; [por confirmar con un estado real]):**

| Campo | Notas |
|---|---|
| Fecha del movimiento | Por línea; el año suele inferirse del período del estado. |
| Descripción / comercio | Texto libre; en TDC incluye "Pago recibido", compras, intereses, comisiones. |
| Cargo / Abono (o monto con signo) | TDC: cargos = gasto, pagos = transferencia desde la cuenta pagadora. Cuenta Nu: depósitos/retiros, SPEI, rendimientos. |
| Saldo (Cuenta Nu) | Permite validar saldo final. |
| Secciones del PDF | Resumen del período (corte, pago mínimo, saldo total) + detalle de movimientos. |

**BBVA México — PDF personal (estructura reportada por conversores de terceros; [por confirmar con un estado real]):**

| Campo | Notas |
|---|---|
| Día de operación / día de registro (liquidación) | Dos fechas por fila; el PDF suele traer solo día y mes, el año viene del período. |
| Descripción / referencia | Texto del movimiento (SPEI, nómina, comisiones, compras). |
| Cargos (retiros) / Abonos (depósitos) | Columnas separadas → `tipo` gasto/ingreso. |
| Saldo | Saldo tras cada operación (validación). |
| Montos | Formato `1,234.56`. El PDF incluye folio fiscal y sello digital. |

**BBVA Net Cash (empresas, si aplica en el futuro):** CSV/TXT/C43/CAMT.053; el CAMT.053 (ISO 20022) es el más robusto y estandarizado para un importador.

### 7.3 Reglas del importador (propuesta alineada a ARQUITECTURA.md)
1. **Selección obligatoria de cuenta destino** (`cuentaId`) y por tanto de `ambito`: la cuenta define si el archivo es de empresa o personal; nunca se mezclan.
2. **Normalización**: `fecha` → `YYYY-MM-DD`; `monto` → positivo con 2 decimales; `tipo` por signo/columna; `descripcion` ≤ 200 caracteres; `contraparte` cuando se identifique.
3. **Transferencias entre cuentas propias**: si el destino/origen coincide con otra cuenta registrada (CLABE o nombre de banco en la descripción, `PAYOUT_BANK_ACCOUNT_NUMBER` en Mercado Pago), crear `tipo: 'transferencia'` con `cuentaDestinoId`; si los ámbitos difieren, aplicar la regla de "Retiro de socio / Aportación de capital".
4. **Deduplicación**: clave = `cuentaId + fecha + monto + tipo` (ya definida en `movimientosARevisar`) + identificador externo cuando exista (`SOURCE_ID`); los posibles duplicados entran con `estado: 'revisar'`.
5. **Trazabilidad**: etiquetas `importado:mercadopago|nu|bbva` y `lote:YYYYMMDD-hhmm`; permitir "deshacer importación" por lote.
6. **Sin categoría automática en v1.1** salvo reglas simples por palabra clave (SPEI, comisión, IVA, nómina); lo demás queda `sinCategoria` para revisión.
7. **Validación de saldo**: si el archivo trae saldo (Liberaciones de MP, PDF de BBVA/Nu), comparar el saldo final con `VF.calc.saldoCuenta` y avisar diferencias.
8. **Privacidad**: el archivo se procesa en memoria del navegador y no se guarda; solo se persisten los movimientos normalizados (cifrados).

---

## 8. Recomendación final por fases

| Fase | Qué se hace | Instituciones | Dependencias / requisitos |
|---|---|---|---|
| **v1.1 — Importador de archivos** | Importar CSV de Mercado Pago (Actividad y "Todas las transacciones"/"Liberaciones"); importador "pegar texto" para PDF de Nu y BBVA; deduplicación y lotes. | MP (ambas), Nu, BBVA | Ninguna externa. Obtener un archivo real de cada institución para fijar encabezados **[por confirmar]**. |
| **v2 — Mercado Pago por API oficial** | Servidor mínimo (propio, no en la PWA) que guarda los Access Tokens de la Cuenta Personal y la Cuenta Negocio, programa el reporte `settlement_report`/`release_report` (diario), descarga el CSV y expone a la PWA solo los movimientos normalizados. | MP (ambas cuentas) | Aplicación en Mercado Pago Developers por cuenta (o una aplicación + OAuth con refresh de 6 meses); activar producción; configurar `display_timezone` México. Confirmar acceso de la cuenta personal a reportes. |
| **v3 — Evaluar BBVA por agregador o API** | Solo si: (a) la CNBV publica reglas de datos transaccionales y BBVA expone API al titular; o (b) VILLEDA abre cuenta empresarial con Net Cash (CSV/CAMT.053 oficial, sin terceros); o (c) se acepta formalmente un agregador (Belvo/Syncfy) con contrato y evaluación de riesgo. | BBVA | Costo (Belvo desde 1,000 USD/mes), contrato B2B, OTP en cada login para BBVA personal. |
| **Nu — lo que haya** | Mantener importación por PDF (texto pegado o conversor). Revisar cada 6 meses si Nu publica exportación CSV o API. | Nu | Ninguna. |

### 8.1 Tabla resumen

| Institución | Método | ¿Solo lectura real? | Esfuerzo | Confiabilidad | Fase |
|---|---|---|---|---|---|
| Mercado Pago (personal) | Exportar CSV desde "Actividad" | Sí (archivo) | S | Alta (archivo oficial; encabezados por confirmar) | v1.1 |
| Mercado Pago (negocio) | Exportar CSV "Todas las transacciones"/"Liberaciones" | Sí (archivo) | S | Alta (columnas documentadas) | v1.1 |
| Mercado Pago (ambas) | API de Reportes con Access Token en servidor propio | **No existe token de solo lectura documentado**; el token es de privilegio total → mitigar en servidor | M | Alta (API oficial, asíncrona, programable) | v2 |
| Nu (TDC y Cuenta Nu) | PDF → pegar texto en la app | Sí | M (parser de texto) | Media (depende del layout del PDF) | v1.1 |
| Nu | PDF → conversor externo (Finos u otro) → CSV | Sí, pero datos salen a un tercero | S | Media | opcional |
| Nu | API o agregador | No disponible | — | — | pendiente |
| BBVA (personal) | PDF → pegar texto en la app | Sí | M | Media | v1.1 |
| BBVA (personal) | CSV/Excel desde app o bbva.mx | Sí | S | **[por confirmar que exista]** | v1.1 si existe |
| BBVA (empresa, futuro) | CSV / CAMT.053 desde Net Cash | Sí | M | Alta (formato estándar) | v3 (b) |
| BBVA (personal) | Agregador con credenciales (Belvo/Syncfy/Prometeo) | Técnicamente lectura, pero el tercero recibe usuario/contraseña y pide OTP | L | Baja-media (sin API regulada) | v3 (c), no recomendado |
| BBVA | API Market México | No aplica (solo pagos para empresas) | — | — | — |

### 8.2 Riesgos legales y de seguridad (reglas no negociables)
1. **Nunca pedir contraseñas bancarias en la app.** VILLEDA Finanzas no debe tener un campo de usuario/contraseña de Nu, BBVA ni Mercado Pago. La única credencial que la solución maneja es el Access Token de Mercado Pago, y **fuera de la PWA**.
2. **Tokens en servidor, no en el cliente.** Mercado Pago lo exige ("nunca debe compartirse ni exponerse en el frontend"). El servidor debe: guardar tokens cifrados, exponer a la PWA solo endpoints de lectura de movimientos normalizados, autenticar a la PWA (clave propia), registrar accesos y permitir revocar la aplicación desde Mercado Pago si hay sospecha de fuga.
3. **Privilegio mínimo imperfecto.** Como no hay scope de solo lectura documentado en Mercado Pago, el token podría operar pagos. Mitigaciones: aplicación dedicada solo a reportes, rotación periódica, servidor sin endpoints de escritura, alertas de uso.
4. **Datos personales (LFPDPPP).** Los movimientos de la cuenta personal del dueño son datos personales financieros; mantener el principio de la app: cifrado local (AES-GCM), sin telemetría, exportación de respaldo bajo control del usuario. Si se usa un conversor externo de PDF, leer su aviso de privacidad y preferir no subir estados personales.
5. **Separación empresa/personal.** Cada importación o sincronización se asocia a una cuenta con `ambito` fijo; el importador no debe permitir volcar un archivo de la Cuenta Negocio en una cuenta personal ni viceversa.
6. **Agregadores con credenciales**: evitar. Contravienen el punto 1, dependen de scraping sin respaldo regulatorio y su costo (1,000 USD/mes en el único precio público) no se justifica para tres cuentas.
7. **Vigilar el marco regulatorio**: cuando la CNBV publique las disposiciones de datos transaccionales (hoy sin fecha), reevaluar BBVA y Nu con APIs reguladas y consentimiento explícito; hasta entonces, archivos oficiales.

---

## 9. Pendientes de verificación ("por confirmar") — lista de trabajo
1. Descargar un CSV de "Actividad" de la **cuenta personal** de Mercado Pago y registrar los encabezados reales.
2. Comprobar si la cuenta personal puede crear una aplicación en Mercado Pago Developers y generar `settlement_report`/`release_report`.
3. Preguntar a Mercado Pago Developers si existe scope de solo lectura para OAuth o aplicaciones.
4. Descargar un PDF de Nu (TDC y Cuenta Nu) y uno de BBVA personal para fijar el parser de texto (columnas, formato de fecha, separadores de miles).
5. Revisar en la app BBVA México si "Movimientos" ofrece descarga en Excel/CSV para personas.
6. Si se abre cuenta empresarial BBVA: confirmar disponibilidad de CAMT.053 en Net Cash.
7. Volver a consultar en abril de 2027: estado de las disposiciones de datos transaccionales de la CNBV y resolución del amparo; novedades de exportación en Nu.

## 10. Fuentes consultadas (todas el 2026-10-26)
- Mercado Pago Developers (México): introducción a reportes; API de "Todas las transacciones"/Dinero en cuenta; API de Liberaciones; campos de ambos reportes; credenciales; OAuth (introducción y obtención de token). URLs en §1.
- Mercado Pago blog México: "Cómo exportar y analizar tus movimientos" (28 ago 2026); "Reportes de cuenta para tu contador" (7 jul 2026); "Cómo consultar saldos y movimientos" (7 jul 2026); "Cómo crear una cuenta de negocio".
- El CEO: autorización IFPE de Mercado Pago (2022); amparo open finance (12 ene 2026).
- Nu México: blog TDC estados de cuenta; blog constancia Cuenta Nu (29 may 2026); blog "Cómo Nu se convirtió en banco" (13 ago 2026); ComunidadNu hilos 14471 (sep 2023) y 31686 (29 may 2026).
- BBVA: API Market México (landing empresas); bbvaapimarket.com; nota de APIs de tesorería (sep 2023); "estado de cuenta sin salir de casa" (26 ene 2025); Net Cash nómina y transferencias en tiempo real; banca por internet personas.
- Regulación: Garrigues (disposiciones APIs, DOF 4 jun 2020); síntesis DOF SCJN; Fiskil Open Finance Tracker México; Latinia mapa regulatorio 2026.
- Agregadores: Belvo (planes y precios; instituciones de domiciliación México; referencia de instituciones; página de estado); Syncfy (cobertura; Open Data); Finerio Connect (sitio); Prometeo (SDK Python docs; sitio); Fintoc (índice de guías v2026-02-01).
- Círculo de Crédito: comunicado Equifax (7 jul 2026); Expansión (8 jul 2026); Credolab (sep 2023).
- Finos: convertidor y página de API (getfinos.com).
- Terceros sobre estructura de PDF (no oficiales): ExtractPro (BBVA México), Extractofacil (Nu).
