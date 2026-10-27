# VILLEDA Finanzas

Panel financiero privado para **VILLEDA Inc** y para las finanzas personales de su dueño, en un solo lugar
pero **siempre por separado**. Funciona en Mac, iPhone y iPad; guarda todo cifrado en el propio
dispositivo y no depende de internet ni de ningún servicio externo.

> **Estado: prototipo local (v1.0).** Sirve para llevar el control diario y para preparar la información del
> contador, pero **no sustituye** la contabilidad formal ni los estados de cuenta del banco. Lee la sección
> "Qué NO hace" antes de confiarle datos reales.

---

## 1. Qué es

Una aplicación web "instalable" (PWA) hecha sólo con HTML, CSS y JavaScript. No tiene servidor, no
tiene cuenta de usuario en la nube y no envía datos a nadie. Se abre como una página y se comporta como
una app: pantalla de bloqueo con contraseña, panel, movimientos, facturas, préstamos, presupuestos,
reportes y un asistente que responde preguntas sobre tus cifras.

Usa la misma lógica para la empresa y para lo personal, pero cada peso queda etiquetado como
**Empresa** (azul) o **Personal** (verde) y nunca se mezclan en los cálculos (ver §11).

## 2. Qué hace

| Sección | Para qué sirve |
|---|---|
| **Panel** | Resumen del mes (ingresos, gastos, utilidad o balance, disponible), próximos 7 días de cobros y pagos, gráfica de 6 meses, por cobrar, movimientos recientes y "para revisar". Selector Empresa / Personal / Combinado. |
| **Empresa** | Cuentas de VILLEDA (Mercado Pago empresa, Nu empresa, caja chica…), ventas e ingresos, gastos, transferencias, gastos por categoría. Accesos a facturas, proveedores y comisiones. |
| **Personal** | Tus cuentas (BBVA, Nu, Mercado Pago personal, tarjeta de crédito), ingresos y gastos personales, metas de ahorro y deudas. |
| **Facturas y Cobros** | Clientes, facturas con IVA 16 % automático, registro de pagos (totales o parciales), quién te debe, qué está vencido y desde cuándo. |
| **Proveedores** | Proveedores, cuentas por pagar y comisiones a vendedores o aliados, con sus pagos. |
| **Préstamos** | Préstamos que debes y préstamos que te deben, con tabla de amortización, próximo pago y saldo pendiente. |
| **Presupuestos** | Presupuesto mensual por categoría contra lo real, en empresa y en personal. |
| **Reportes** | Estado de resultados, flujo de efectivo, gastos por categoría, antigüedad de cuentas por cobrar, resumen de IVA (estimado), exportación a CSV, "Paquete para contador" e impresión / PDF. |
| **Asistente** | Responde preguntas en lenguaje natural con tus cifras reales (ver §9). Funciona sin internet. |
| **Ajustes** | Contraseña, autobloqueo, respaldos, datos de ejemplo, tema claro/oscuro, servidor de IA opcional. |

## 3. Qué NO hace (léelo antes de usarla)

- **Es un prototipo local.** No hay soporte técnico, ni garantía, ni actualizaciones automáticas.
- **No tiene inteligencia artificial generativa de fábrica.** El asistente entiende un conjunto fijo de
  preguntas por reglas y calcula las respuestas con tus datos. Conectar una IA real es opcional y requiere
  un pequeño servidor propio (ver `docs/IA-SERVIDOR.md`).
- **No se conecta a bancos.** Mercado Pago, Nu y BBVA no se consultan automáticamente; todo se captura a
  mano. La investigación sobre qué sería posible en el futuro está en `docs/CONEXION-BANCOS.md`.
- **No sincroniza entre dispositivos.** Lo que capturas en el iPhone no aparece en la Mac y viceversa. Cada
  dispositivo tiene su propia copia. Elige un dispositivo principal o mueve los datos con respaldos (§7).
- **No hace respaldos automáticos.** Si pierdes el dispositivo, borras el historial del navegador o
  reinstalas la app, los datos se pierden. Exporta un respaldo con regularidad.
- **No la uses como único registro.** Conserva los estados de cuenta del banco, las facturas (CFDI) y la
  contabilidad de tu contador. Esta app ordena y resume; no es la fuente oficial.
- **No es asesoría financiera, contable ni fiscal** (ver §13).

## 4. Cómo abrirla en Mac

1. Abre la carpeta `villeda-finanzas`.
2. Haz doble clic en `index.html`. Se abre en tu navegador predeterminado (Safari o Chrome; ambos funcionan).
3. La primera vez verás **"Crear contraseña"**: escribe una contraseña de al menos 8 caracteres, confírmala y
   deja marcada la casilla **"Cargar datos de ejemplo"** si quieres explorar la app con información ficticia.
4. Las siguientes veces verás **"Desbloquear"**.

Consejos:
- Usa **siempre el mismo navegador**. Los datos quedan guardados dentro de ese navegador; si abres la app en
  Safari y luego en Chrome, verás dos copias distintas (la segunda, vacía).
- No borres el historial ni los "datos de sitios web" de ese navegador sin antes exportar un respaldo (§7).
- Si quieres un icono en el Dock, en Safari usa **Archivo → Agregar al Dock** (macOS Sonoma o posterior).
  En Chrome, menú **⋮ → Guardar y compartir → Instalar página como app** (por confirmar según la versión).

## 5. Cómo instalarla en iPhone o iPad

Para que iOS la trate como una app (icono propio, pantalla completa, uso sin conexión) la app tiene que
abrirse desde una dirección **https://**, no desde un archivo. Hay dos formas de lograrlo.

### Opción A (recomendada): publicarla en el sitio web, en una ruta no indexada

La carpeta `villeda-finanzas` puede publicarse junto con el sitio de la empresa (GitHub Pages o Cloudflare
Pages, que ya sirven el sitio por HTTPS), en la ruta `/villeda-finanzas/`. La dirección quedaría como
`https://<dominio-del-sitio>/villeda-finanzas/` (por ejemplo `https://isoval.com.mx/villeda-finanzas/`;
**por confirmar** con quien administra el sitio).

Qué significa "no indexada": el archivo `robots.txt` del sitio ya pide a Google y demás buscadores que no
rastreen esa ruta, y la página no aparece enlazada desde el sitio ni en el mapa del sitio. Aun así,
**cualquiera que conozca la dirección puede abrir la pantalla de bloqueo**; lo que protege tus datos es que
éstos nunca están en el servidor: viven cifrados sólo en tu dispositivo. En el servidor sólo hay el programa,
sin información tuya.

### Opción B: servidor local en la misma red Wi-Fi (para probar)

Sirve para probar en el iPhone sin publicar nada, con la Mac encendida y los dos dispositivos en la misma red:

1. En la Mac abre **Terminal** y escribe (ajusta la ruta a donde esté la carpeta):
   ```
   cd ~/Ruta/a/villeda-finanzas
   python3 -m http.server 8000
   ```
2. Averigua la dirección IP de la Mac: **Ajustes del Sistema → Red → Wi-Fi → Detalles**, o en Terminal
   `ipconfig getifaddr en0` (por ejemplo `192.168.1.25`).
3. En el iPhone abre Safari y entra a `http://192.168.1.25:8000/` (con tu IP).

Limitaciones de la opción B: es **http**, no **https**, así que iOS no instala el modo sin conexión (la Mac
debe seguir encendida con el servidor corriendo) y, si la IP de la Mac cambia, el iPhone verá la app "vacía"
porque los datos quedan ligados a la dirección exacta. Úsala para probar, no para el día a día.

### Agregar a la pantalla de inicio

1. Abre la dirección en **Safari** (tiene que ser Safari; Chrome en iOS no instala apps web).
2. Toca el botón **Compartir** (el cuadro con la flecha hacia arriba).
3. Elige **Agregar a pantalla de inicio** y confirma el nombre ("Finanzas").
4. Abre la app **siempre desde ese icono**. La app instalada guarda sus datos aparte de Safari: lo que
   captures en el icono no lo verás abriendo la misma dirección en Safari, y viceversa.

Importante en iOS: Safari puede borrar los datos de sitios que no abres en varios días (por confirmar los
plazos exactos por versión de iOS). Las apps instaladas en la pantalla de inicio están mejor protegidas,
pero la única garantía real es **exportar respaldos** (§7).

## 6. Contraseña y cifrado

- Toda tu información se guarda **cifrada** (AES-GCM de 256 bits) con una clave derivada de tu contraseña
  (PBKDF2, 310,000 iteraciones). Sin la contraseña, lo guardado es ilegible, incluso para quien tenga el
  dispositivo o el archivo de respaldo cifrado.
- **No existe recuperación de contraseña.** No hay correo de "olvidé mi contraseña", ni pregunta secreta, ni
  nadie que pueda abrir los datos. Si la olvidas, la única salida es **"Borrar todo y empezar de nuevo"** (y
  restaurar un respaldo, si lo tienes).
- Guarda la contraseña en un gestor de contraseñas (Llaveros de iCloud, 1Password, etc.).
- La app se **bloquea sola** tras unos minutos sin actividad o al dejar la pestaña oculta (configurable en
  Ajustes → Autobloqueo; 0 = nunca). También puedes bloquearla con el candado de la cabecera.
- Cambiar la contraseña: **Ajustes → Cambiar contraseña**. Vuelve a cifrar todo con la nueva.

## 7. Respaldos: hacer y restaurar

**Hacer un respaldo** (recomendado cada semana y antes de cualquier cambio en el dispositivo):

1. **Ajustes → Respaldo → Exportar**.
2. Pulsa **Respaldo cifrado (.vf.json)** (recomendado). Ese archivo sólo se puede leer con la contraseña que tenía
   la app en ese momento. El botón **Sin cifrar (.json)** pide confirmar en un aviso (**Exportar sin cifrar**) porque
   el archivo es legible por cualquiera: guárdalo únicamente en un lugar seguro (disco cifrado, bóveda del gestor de
   contraseñas).
3. Guarda el archivo en iCloud Drive, un USB o una carpeta respaldada. Pon la fecha en el nombre.

**Restaurar un respaldo:**

1. Abre la app (si es un dispositivo nuevo, primero crea una contraseña; puede ser distinta a la del respaldo).
2. **Ajustes → Respaldo → Elegir archivo de respaldo…**, elige el archivo y confirma con **Reemplazar e importar**.
3. Si el respaldo está cifrado con otra contraseña, escríbela en el campo **Contraseña del respaldo** del mismo aviso
   (déjalo vacío si es tu contraseña actual). Después, los datos se guardan con la contraseña actual del dispositivo.
4. La importación **reemplaza** todo lo que hubiera en la app. Si el dispositivo tenía capturas recientes,
   expórtalas antes.

Advertencia: un respaldo cifrado con una contraseña que olvidaste es tan inaccesible como la app. Por eso
conviene conservar, además, un respaldo plano en un lugar realmente seguro, o tener la contraseña en un gestor.

## 8. Quitar los datos de ejemplo

Mientras la app tenga datos ficticios verás un banner amarillo arriba. Para empezar con tus datos reales:

1. **Ajustes → Borrar datos de ejemplo**. Se eliminan únicamente los registros ficticios (cuentas, movimientos,
   clientes, facturas, etc.); lo que tú hayas capturado se conserva.
2. Si prefieres partir de cero, **Ajustes → Zona de peligro → Borrar todo** elimina la bóveda completa y vuelve a la
   pantalla "Crear contraseña" (pide confirmar y, después, escribir **BORRAR**).

Los datos de ejemplo son inventados: clientes, proveedores, RFC y montos no corresponden a nadie real.

## 9. El asistente: qué preguntas entiende

El asistente responde con tus cifras reales, en pesos, y ofrece un enlace "Ver detalle" a la sección
correspondiente. No necesita internet. Las preguntas que mejor entiende son:

1. **"¿Cuánto dinero tengo disponible entre todas mis cuentas?"** → saldo líquido de empresa y de personal,
   cada uno por separado, y el total combinado etiquetado como "solo informativo".
2. **"¿Cuánto gastó VILLEDA esta semana?"** → gastos de la empresa en la semana en curso (también "hoy",
   "ayer", "este mes", "mes pasado", "semana pasada", "próximos N días").
3. **"¿Qué clientes todavía me deben?"** → facturas pendientes agrupadas por cliente, con lo vencido.
4. **"¿Cuánto puedo gastar personalmente sin afectar los pagos del negocio?"** → disponible personal
   (líquido personal menos tus compromisos de los próximos 30 días) y recordatorio de que la empresa tiene su
   propia reserva operativa; nunca mezcla ambas bolsas.
5. **"¿Qué pagos y cobros tengo pendientes mañana?"** → vencimientos de facturas, cuentas por pagar,
   préstamos, tarjetas y comisiones para la fecha pedida.

También entiende: "¿Cuál fue mi utilidad este mes?", "¿Qué movimientos debo revisar?" (duplicados, gastos
atípicos, marcados, sin categoría), "¿Cómo voy con el presupuesto?", "¿Cómo se ve mi flujo a 30 días?",
"¿Cuánto hay en Nu?", "¿Qué préstamos tengo?", "¿Qué comisiones debo?", "¿Cómo van mis metas?".

Cómo hablarle: "VILLEDA", "la empresa" o "el negocio" = empresa; "yo", "personal", "mío" = personal. Si no
reconoce la pregunta te lo dice y muestra sugerencias; **nunca inventa cifras**: si no hay movimientos,
responde "Sin movimientos".

Con un servidor de IA configurado (opcional, `docs/IA-SERVIDOR.md`), la pregunta y un **resumen de totales**
(sin descripciones, sin nombres de clientes o proveedores, sin contraseñas) se envían a ese servidor y la
respuesta se muestra indicando que vino de la IA; si el servidor falla, responde el asistente local y lo avisa.

## 10. Reportes para el contador

En **Reportes** elige ámbito (normalmente Empresa) y rango de fechas:

- **Estado de resultados** (ingresos, gastos, utilidad y margen), **flujo de efectivo mensual**, **gastos por
  categoría**, **antigüedad de cuentas por cobrar** (0-30, 31-60, 61-90, 90+ días).
- **Resumen de IVA**: IVA trasladado (de tus facturas emitidas en el rango) e IVA acreditable **estimado**
  (16/116 de los gastos en categorías con IVA). Es una aproximación; el contador debe validarlo contra los CFDI.
- **CSV movimientos**, **CSV facturas**, **CSV cuentas por pagar**: se abren en Excel o Numbers.
- **Paquete para contador**: descarga los tres CSV más un resumen `.txt` del periodo.
- **Imprimir / PDF**: usa la impresión del navegador; en Mac elige "Guardar como PDF".

Las transferencias entre tus propias cuentas (incluidos retiros de socio y aportaciones de capital) **no**
aparecen como ingresos ni gastos en estos reportes: mueven dinero, no generan utilidad.

## 11. Separación empresa / personal: la regla de oro

Cada cuenta, movimiento, préstamo, presupuesto y meta pertenece a **un** ámbito: Empresa o Personal. La app
nunca suma dinero de la empresa con dinero personal en ningún cálculo (ingresos, gastos, utilidad,
presupuesto, disponible, proyección). La única vista que junta ambos es "Total combinado", y lo muestra como
dos cifras separadas más una suma marcada "solo informativo".

Cuando pasas dinero de una cuenta de la empresa a una personal, la app lo registra como **"Retiro de socio"**;
al revés, como **"Aportación de capital"**. Son transferencias: cambian los saldos de las dos cuentas pero no
cuentan como gasto de la empresa ni como ingreso personal. Así la utilidad de VILLEDA refleja sólo el
negocio, y tu "disponible personal" sólo tu dinero.

Por qué importa: evita confundir el dinero de la empresa con el tuyo (un problema fiscal y de control muy
común en negocios familiares), permite saber si la constructora es rentable por sí misma y te dice cuánto
puedes gastar sin dejar a VILLEDA sin fondos para nómina, proveedores o impuestos.

## 12. Para la persona técnica

- **Stack:** HTML + CSS + JavaScript clásico (sin módulos ES, sin dependencias, sin CDN). Funciona desde
  `file://` y como PWA por HTTPS. Contrato de implementación: `docs/ARQUITECTURA.md`.
- **Estructura:** `index.html` (shell), `css/app.css`, `js/core/` (`util`, `crypto`, `store`, `seed`, `calc`,
  `ui`, `router`), `js/modules/` (una vista por archivo), `js/app.js` (arranque y bloqueo), `sw.js` (service
  worker cache-first; sube `VF_VERSION` en cada publicación), `manifest.webmanifest`, `icons/`,
  `tools/generar-iconos.py`, `tests/`, `docs/`.
- **Persistencia:** `localStorage['vf.boveda.v1']` con `{ version, salt, iv, datos, verificador }`; AES-GCM 256
  con clave PBKDF2-SHA256 (310,000 iteraciones). La clave sólo vive en memoria mientras la app está
  desbloqueada. Modelo de datos: `docs/MODELO-DATOS.md`.
- **Pruebas** (Node 22):
  ```
  node tests/calc.test.js     # cálculos puros, separación de ámbitos, amortización, vencimientos
  node tests/store.test.js    # util, crypto, store y seed con localStorage simulado
  node tests/smoke.js         # E2E con Playwright (chromium) sobre un servidor http local
  ```
  Para `smoke.js` hace falta Playwright: `npm i -D playwright && npx playwright install chromium`. `VF_SMOKE=B,C`
  limita los escenarios de navegador (A móvil claro, B escritorio oscuro, C `file://`, D móvil oscuro / olvidé).
  Las capturas quedan en `tests/capturas/` (ignoradas por git).
- **Publicación:** copiar la carpeta tal cual a la ruta `/villeda-finanzas/` del sitio. El `robots.txt` raíz
  ya contiene `Disallow: /villeda-finanzas/` y el sitemap no la incluye; `index.html` lleva además
  `<meta name="robots" content="noindex, nofollow">`. Si el hosting lo permite, añade la cabecera
  `X-Robots-Tag: noindex`. Al publicar una versión nueva sube `VF_VERSION` en `sw.js`.
- **Hoja de ruta** (importador de estados de cuenta, backend con sincronización, IA, bancos, CFDI, app
  nativa): `docs/HOJA-DE-RUTA.md`. Investigación bancaria: `docs/CONEXION-BANCOS.md`. Servidor de IA:
  `docs/IA-SERVIDOR.md`.

## 13. Privacidad y aviso legal

- **Privacidad.** Los datos se guardan cifrados en el dispositivo y no se envían a ningún servidor, no hay
  telemetría ni analítica. Las únicas salidas de información ocurren cuando tú las provocas: exportar un
  respaldo o descargar un CSV, y, si lo configuras, enviar el resumen de totales al servidor de IA
  (`docs/IA-SERVIDOR.md` detalla exactamente qué viaja).
- **Responsabilidad.** VILLEDA Finanzas es un prototipo que se entrega "tal cual", sin garantía de exactitud,
  disponibilidad ni conservación de datos. Los cálculos (incluido el resumen de IVA) son aproximaciones de
  apoyo. **No constituye asesoría financiera, contable, fiscal ni legal**; las decisiones y obligaciones
  fiscales deben validarse con un contador o asesor autorizado y con los documentos oficiales (CFDI, estados
  de cuenta, declaraciones).
- **Datos de ejemplo.** Son ficticios. Cualquier coincidencia con personas o empresas reales es casual.
- **Marcas.** Mercado Pago, Nu y BBVA son marcas de sus respectivos titulares; aquí sólo se usan para
  identificar tus cuentas.
