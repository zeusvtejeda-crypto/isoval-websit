# VILLEDA FINANZAS — Arquitectura y contrato de implementación (v1.0)

Este documento es el CONTRATO entre todos los archivos de la aplicación. Toda función,
colección y ruta aquí descrita debe existir con exactamente ese nombre y firma. Si algo
no está aquí y lo necesitas, agrégalo como función auxiliar privada dentro de tu archivo;
no inventes API pública nueva sin documentarla al final de este archivo en la sección
"Extensiones".

## 0. Principios no negociables

1. **Separación empresa / personal.** Cada cuenta, movimiento, préstamo, presupuesto y meta
   tiene `ambito: 'empresa' | 'personal'`. NINGÚN cálculo (ingresos, gastos, utilidad,
   presupuesto, disponible, proyección) puede sumar registros de ámbitos distintos. La única
   excepción es la vista "Total combinado", que muestra los dos totales por separado y una
   suma etiquetada explícitamente como "combinado (solo informativo)".
2. **Sin cifras inventadas.** Todo número en pantalla sale de `VF.calc` sobre los registros
   reales. Si no hay datos, se muestra "Sin movimientos", nunca ceros falsos ni ejemplos.
3. **Privacidad local.** Los datos viven cifrados (AES-GCM) en `localStorage` del dispositivo.
   Nada sale del navegador salvo que el usuario configure explícitamente un servidor de IA
   (opcional) o exporte un respaldo.
4. **Sin dependencias externas.** Cero CDNs, cero fuentes web, cero librerías. Sólo HTML, CSS
   y JavaScript clásico (NO módulos ES, NO `import`/`export`, NO `type="module"`), para que
   funcione abriendo `index.html` desde el disco (`file://`) en Safari/Chrome y también
   servido por HTTPS como PWA.
5. **Español, México.** Toda la interfaz en español. Moneda MXN con
   `Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })`. Fechas `YYYY-MM-DD`
   internamente; en pantalla `d MMM yyyy` (es-MX).
6. **Seguridad en el DOM.** Todo texto de usuario que se inserte vía `innerHTML` pasa por
   `VF.util.esc()`. Nunca `eval`, nunca `new Function`, nunca inline handlers `onclick="..."`
   con datos de usuario; usar `addEventListener` o delegación con `data-accion`.
7. **Sólo lectura hacia bancos.** Esta versión no se conecta a bancos. Cualquier integración
   futura será de lectura (ver `docs/HOJA-DE-RUTA.md`).

## 1. Estructura de archivos

```
villeda-finanzas/
├── index.html                 # shell: pantalla de bloqueo + app + <script> en orden fijo
├── manifest.webmanifest       # PWA (name, short_name, start_url "./index.html", display standalone, theme_color)
├── sw.js                      # service worker cache-first del shell, versionado (VF_VERSION)
├── css/app.css                # tokens, layout, componentes, modo oscuro, safe-area
├── icons/                     # icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon-180.png favicon-32.png
├── tools/generar-iconos.py    # genera los PNG con Pillow (ya está instalado)
├── js/core/util.js            # VF.util
├── js/core/crypto.js          # VF.crypto
├── js/core/store.js           # VF.store (estado + persistencia cifrada + eventos)
├── js/core/seed.js            # VF.seed (datos ficticios de ejemplo)
├── js/core/calc.js            # VF.calc (funciones puras, SIEMPRE con ámbito)
├── js/core/ui.js              # VF.ui (componentes, modal, formularios, toast, gráficas SVG)
├── js/core/router.js          # VF.router (rutas por hash)
├── js/modules/panel.js        # #/panel
├── js/modules/empresa.js      # #/empresa (cuentas, ventas/ingresos, gastos, transferencias)
├── js/modules/personal.js     # #/personal (bancos, ahorro/metas, deudas)
├── js/modules/facturas.js     # #/facturas y #/cobros (clientes, facturas, cuentas por cobrar)
├── js/modules/proveedores.js  # #/proveedores (proveedores, cuentas por pagar, comisiones)
├── js/modules/prestamos.js    # #/prestamos
├── js/modules/presupuestos.js # #/presupuestos
├── js/modules/reportes.js     # #/reportes (estado de resultados, flujo, antigüedad, CSV, impresión)
├── js/modules/asistente.js    # #/asistente
├── js/modules/ajustes.js      # #/ajustes (contraseña, respaldo, datos de ejemplo, IA, autobloqueo)
├── js/app.js                  # arranque: bloqueo, router, SW, autobloqueo
├── tests/calc.test.js         # pruebas unitarias de VF.calc en Node (node tests/calc.test.js)
├── tests/smoke.js             # prueba E2E con Playwright (node tests/smoke.js) — servidor http local + chromium
├── README.md                  # uso, instalación en iPhone/iPad/Mac, respaldos, límites
└── docs/                      # ARQUITECTURA.md (este), MODELO-DATOS.md, HOJA-DE-RUTA.md, IA-SERVIDOR.md
```

Orden de `<script>` en `index.html` (al final del `<body>`, todos `defer`-free, clásicos):
`util, crypto, store, seed, calc, ui, router, panel, empresa, personal, facturas, proveedores,
prestamos, presupuestos, reportes, asistente, ajustes, app`.

Cada archivo JS empieza con:
```js
'use strict';
window.VF = window.VF || {};
(function (VF) { ... VF.nombre = { ... }; })(window.VF);
```
Los módulos de `js/modules/` se registran al final con `VF.router.registrar(...)`. El router
debe tolerar que un módulo no exista (muestra "Módulo no disponible").

## 2. Modelo de datos (estado en memoria, un solo objeto `estado`)

```js
{
  version: 1,
  ajustes: {
    nombreUsuario: 'Zeus', nombreEmpresa: 'VILLEDA Inc', moneda: 'MXN',
    autobloqueoMin: 5,            // 0 = nunca
    reservaOperativaDias: 30,     // para "disponible" empresa
    asistenteEndpoint: '',        // URL opcional de servidor IA (vacío = asistente local)
    tema: 'auto',                 // 'auto' | 'claro' | 'oscuro'
    datosEjemplo: true            // true mientras existan datos ficticios
  },
  cuentas: [ { id, ambito, nombre, banco, tipo, saldoInicial, moneda:'MXN', limiteCredito, diaCorte, diaPago, color, activa:true, creado, actualizado } ],
  //   tipo: 'cheques' | 'ahorro' | 'credito' | 'efectivo' | 'inversion' | 'billetera'
  //   Para 'credito': saldo actual negativo = deuda. limiteCredito, diaCorte (1-31), diaPago (1-31).
  movimientos: [ { id, ambito, cuentaId, tipo, monto, fecha, categoria, descripcion, contraparte,
                   cuentaDestinoId, facturaId, cxpId, prestamoId, comisionId, estado, etiquetas:[], creado, actualizado } ],
  //   tipo: 'ingreso' | 'gasto' | 'transferencia'. monto SIEMPRE positivo (número, 2 decimales).
  //   estado: 'confirmado' | 'revisar'.
  //   transferencia: resta en cuentaId y suma en cuentaDestinoId. Si los ámbitos de origen y destino
  //   difieren, el movimiento lleva ambito = ambito de la cuenta ORIGEN y categoria
  //   'Retiro de socio' (empresa→personal) o 'Aportación de capital' (personal→empresa).
  //   Las transferencias NUNCA cuentan como ingreso ni gasto en utilidad/presupuestos; sí afectan saldos.
  clientes:    [ { id, nombre, rfc, email, telefono, notas, creado, actualizado } ],
  facturas:    [ { id, folio, clienteId, fechaEmision, fechaVencimiento, concepto, subtotal, iva, total,
                   estado, pagos:[{ id, fecha, monto, cuentaId, movimientoId }], uuidCfdi, notas, creado, actualizado } ],
  //   ámbito implícito: empresa. iva = subtotal*0.16 redondeado a 2 decimales. total = subtotal+iva.
  //   estado almacenado: 'borrador' | 'emitida' | 'cancelada'. Los estados derivados los da VF.calc.estadoFactura():
  //   'pagada' (pendiente<=0), 'parcial' (0<pagado<total), 'vencida' (pendiente>0 y fechaVencimiento<hoy), 'emitida'.
  proveedores: [ { id, nombre, rfc, categoria, contacto, telefono, email, notas, creado, actualizado } ],
  cuentasPorPagar: [ { id, proveedorId, concepto, fecha, fechaVencimiento, monto, pagos:[{ id, fecha, monto, cuentaId, movimientoId }], estado, notas, creado, actualizado } ],
  //   ámbito implícito: empresa. estado: 'pendiente' | 'cancelada'. Derivados: 'pagada', 'parcial', 'vencida'.
  comisiones:  [ { id, beneficiario, facturaId, base, porcentaje, monto, fecha, estado, movimientoId, notas, creado, actualizado } ],
  //   ámbito implícito: empresa. estado: 'pendiente' | 'pagada'. monto = round2(base*porcentaje/100).
  prestamos:   [ { id, ambito, tipo, contraparte, principal, tasaAnual, plazoMeses, fechaInicio, diaPago,
                   pagos:[{ id, fecha, monto, capital, interes, movimientoId }], estado, notas, creado, actualizado } ],
  //   tipo: 'recibido' (debo) | 'otorgado' (me deben). estado: 'activo' | 'liquidado' | 'cancelado'.
  //   Amortización francesa: pagoMensual = P*r/(1-(1+r)^-n), r = tasaAnual/100/12. Si tasaAnual=0 → P/n.
  presupuestos:[ { id, ambito, periodo, categoria, monto, creado, actualizado } ],   // periodo 'YYYY-MM'
  metas:       [ { id, ambito:'personal', nombre, objetivo, cuentaId, fechaMeta, notas, creado, actualizado } ],
  categorias:  { empresa: { ingreso:[...], gasto:[...] }, personal: { ingreso:[...], gasto:[...] } }
}
```

Categorías por defecto (seed y store.vacio()):
- empresa.ingreso: `Ventas`, `Servicios`, `Anticipos`, `Otros ingresos`, `Aportación de capital`
- empresa.gasto: `Nómina`, `Renta`, `Proveedores`, `Materiales`, `Comisiones`, `Servicios (luz, agua, internet)`,
  `Impuestos`, `Software`, `Transporte`, `Publicidad`, `Honorarios`, `Préstamos`, `Retiro de socio`, `Otros gastos`
- personal.ingreso: `Sueldo`, `Retiro de socio`, `Intereses`, `Otros ingresos`
- personal.gasto: `Vivienda`, `Supermercado`, `Restaurantes`, `Transporte`, `Gasolina`, `Salud`, `Educación`,
  `Entretenimiento`, `Suscripciones`, `Ropa`, `Tarjeta de crédito`, `Préstamos`, `Ahorro`, `Aportación de capital`, `Otros gastos`

`id`: `VF.util.uid(prefijo)` → `prefijo_` + 10 caracteres base36 aleatorios (`crypto.getRandomValues`).
`creado`/`actualizado`: ISO 8601 completo.

## 3. API de núcleo

### VF.util
```js
uid(prefijo)                       // 'mov_x8d1k2...'
hoy()                              // 'YYYY-MM-DD' en hora local
fechaISO(date)                     // Date → 'YYYY-MM-DD' local
parseFecha('YYYY-MM-DD')           // → Date local a medianoche
sumarDias(iso, n)                  // → iso
inicioMes(iso) / finMes(iso)       // → iso
inicioSemana(iso)                  // lunes → iso
periodo(iso)                       // 'YYYY-MM'
diasEntre(isoA, isoB)              // entero (B - A)
fmtMXN(n)                          // '$12,345.67' (es-MX). null/undefined/NaN → '—'
fmtNumero(n, dec=2)
fmtFecha(iso)                      // '25 oct 2026'
fmtFechaLarga(iso)                 // 'sábado, 25 de octubre de 2026'
round2(n)
parseMonto(str)                    // acepta '1,234.50', '$1,234.50', ' 1234 ' → 1234.5 ; inválido → NaN
esc(str)                           // escapa & < > " ' para innerHTML
normalizar(str)                    // minúsculas sin acentos, trim, espacios colapsados (para el asistente)
agrupar(arr, fn)                   // → { clave: [items] }
suma(arr, fn)                      // suma de fn(item) (o del número si no hay fn), round2
ordenar(arr, campo, dir='asc')
debounce(fn, ms)
descargar(nombreArchivo, contenido, mime)   // crea blob + <a download>
csv(filas, columnas)               // columnas: [{clave, titulo}] → string CSV con BOM UTF-8, separador ',', comillas escapadas
```

### VF.crypto (WebCrypto; todo async)
```js
generarSalt()                              // Uint8Array(16) → base64
derivarClave(contrasena, saltB64)          // PBKDF2-SHA256, 310000 iteraciones → CryptoKey AES-GCM 256
cifrar(objeto, clave)                      // → { iv: b64, datos: b64 }  (JSON → UTF-8 → AES-GCM)
descifrar({iv, datos}, clave)              // → objeto; lanza Error('CONTRASENA_INCORRECTA') si falla
```

### VF.store
Persistencia: `localStorage['vf.boveda.v1'] = JSON.stringify({ version:1, salt, iv, datos, verificador })`.
`verificador` = cifrado de la cadena `'VF-OK'` con la misma clave, para distinguir contraseña
incorrecta de datos corruptos. Clave derivada se mantiene sólo en memoria.
```js
existeBoveda()                     // bool
crear(contrasena, { conEjemplo })  // crea bóveda nueva; si conEjemplo → VF.seed.datos(); guarda; emite 'desbloqueado'
desbloquear(contrasena)            // → Promise<void>; lanza 'CONTRASENA_INCORRECTA'
bloquear()                         // borra estado y clave de memoria; emite 'bloqueado'
estaDesbloqueado()
estado()                           // referencia al objeto estado (sólo lectura por convención)
guardar()                          // cifra + persiste; emite 'cambio'
agregar(coleccion, obj)            // asigna id/creado/actualizado si faltan, push, guardar(); → obj
actualizar(coleccion, id, cambios) // merge superficial, actualizado=ahora, guardar(); → obj | null
eliminar(coleccion, id)            // guardar(); → bool. Reglas de integridad en 2.1
obtener(coleccion, id)             // → obj | undefined
listar(coleccion, filtro?)         // filtro: función u objeto {campo: valor}; → arreglo NUEVO (copia superficial)
setAjustes(parcial)                // merge en estado.ajustes + guardar()
cambiarContrasena(actual, nueva)   // → Promise<void>
exportarJSON({ cifrado:true })     // → string. cifrado: el mismo formato de la bóveda. Sin cifrar: estado plano.
importarJSON(texto, contrasenaOpcional) // detecta formato, reemplaza estado, guardar()
borrarDatosEjemplo()               // elimina TODO registro con id que termine en '_demo' + ajustes.datosEjemplo=false
borrarTodo()                       // elimina la bóveda del localStorage y bloquea
on(evento, fn) / off(evento, fn)   // eventos: 'desbloqueado' | 'bloqueado' | 'cambio'
```
2.1 Integridad al eliminar: eliminar una cuenta con movimientos → lanzar Error('CUENTA_CON_MOVIMIENTOS');
eliminar cliente con facturas → Error('CLIENTE_CON_FACTURAS'); eliminar proveedor con CxP → Error('PROVEEDOR_CON_CXP');
eliminar factura/CxP/préstamo/comisión con pagos → también eliminar sus movimientos vinculados (`facturaId`, etc.).

### VF.seed
```js
datos()      // → estado completo con datos FICTICIOS, ids terminados en '_demo', fechas relativas a hoy (últimos 120 días
             //    y próximos 45), ambos ámbitos poblados. Incluye: 3 cuentas empresa, 4 personales (una 'credito'),
             //    ≥70 movimientos, 5 clientes, 8 facturas (pagadas/parciales/vencidas/emitidas), 4 proveedores,
             //    6 CxP, 3 comisiones, 1 préstamo empresa recibido, 1 préstamo personal recibido, 1 otorgado,
             //    presupuestos del mes actual en ambos ámbitos, 2 metas de ahorro, 1 movimiento duplicado y
             //    1 movimiento 'revisar' para que el asistente tenga qué detectar.
vacio()      // → estado vacío con categorías por defecto y ajustes por defecto (datosEjemplo:false)
```

### VF.calc  (funciones PURAS: reciben `estado` como primer argumento, no tocan el DOM ni el store)
```js
hoy()                                                 // = VF.util.hoy() (para poder inyectar fecha en pruebas: VF.calc.fijarHoy(iso))
saldoCuenta(estado, cuentaId)                         // saldoInicial + ingresos − gastos − transf. salientes + transf. entrantes
saldosPorAmbito(estado, ambito)                       // { liquido, credito (deuda negativa), total, cuentas:[{cuenta, saldo}] }
                                                      //   liquido = suma de cuentas no 'credito' activas; total = liquido + credito
combinado(estado)                                     // { empresa: saldosPorAmbito, personal: saldosPorAmbito, combinadoInformativo }
movimientosEn(estado, ambito, desde, hasta, filtros?) // inclusive ambos extremos; filtros {tipo, categoria, cuentaId, estado}
ingresos(estado, ambito, desde, hasta)                // suma tipo 'ingreso' (excluye transferencias)
gastos(estado, ambito, desde, hasta)                  // suma tipo 'gasto'
balance(estado, ambito, desde, hasta)                 // ingresos − gastos
utilidadMes(estado, periodo)                          // SOLO empresa: { ingresos, gastos, utilidad, margen }
gastosPorCategoria(estado, ambito, desde, hasta)      // [{categoria, monto, porcentaje}] desc
ingresosPorCategoria(...)
serieMensual(estado, ambito, meses=6)                 // [{periodo, ingresos, gastos, balance}] del más antiguo al actual
pagadoFactura(f) / pendienteFactura(f) / estadoFactura(f, hoy)
porCobrar(estado)                                     // { total, vencido, facturas:[...pendientes con pendiente y dias], porCliente:[{cliente, total, vencido, facturas}] }
antiguedadCxC(estado)                                 // { '0-30', '31-60', '61-90', '90+' } montos
pendienteCxP(c) / estadoCxP(c, hoy)
porPagar(estado)                                      // { total, vencido, cuentas:[...], porProveedor:[...] }
comisionesPendientes(estado)                          // { total, lista }
tablaAmortizacion(prestamo)                           // [{n, fecha, pago, capital, interes, saldo}]
pagoMensual(prestamo)
saldoPrestamo(prestamo)                               // principal − suma(pagos.capital)
proximoPagoPrestamo(prestamo, hoy)                    // { fecha, monto } | null
vencimientos(estado, desde, hasta)                    // lista ordenada por fecha de { fecha, tipo:'cobro'|'pago', ambito, concepto, monto, origen:{coleccion,id} }
                                                      //   incluye: facturas por cobrar (vencimiento), CxP, préstamos (próximo pago), tarjetas (diaPago, deuda),
                                                      //   comisiones pendientes, préstamos otorgados (cobro)
presupuestoVsReal(estado, ambito, periodo)            // [{categoria, presupuesto, real, diferencia, porcentaje}] + { totalPresupuesto, totalReal }
disponiblePersonal(estado, dias=30)                   // SOLO cuentas personales: { liquido, compromisos:[...], totalCompromisos, disponible }
                                                      //   compromisos = vencimientos tipo 'pago' con ambito 'personal' en los próximos `dias` + deuda de tarjetas con pago en el periodo
disponibleEmpresa(estado, dias)                       // análogo con reservaOperativaDias y SOLO cuentas empresa
flujoProyectado(estado, ambito, dias=30)              // [{fecha, entradas, salidas, saldo}] partiendo del líquido actual
movimientosARevisar(estado, ambito?)                  // { duplicados:[[a,b]], atipicos:[{mov, mediana}], marcados:[...], sinCategoria:[...] }
                                                      //   duplicado = misma cuenta, fecha, monto y tipo; atípico = gasto > 3× mediana de su categoría (mín. 4 muestras)
metaProgreso(estado, meta)                            // { ahorrado (saldo de cuentaId o 0), objetivo, porcentaje, faltante }
resumenParaIA(estado)                                 // objeto compacto SIN descripciones ni contrapartes: totales por ámbito, por cobrar/pagar, vencimientos 14 días, utilidad mes
```
Reglas: nunca mezclar ámbitos; `hoy` siempre vía `VF.calc.hoy()`; montos con `round2`; todas las listas devueltas son nuevas.

### VF.ui
```js
el(html)                                   // string → Element (primer hijo)
render(contenedor, html)                   // contenedor.innerHTML = html (html ya escapado por quien lo construye)
badgeAmbito(ambito)                        // '<span class="badge badge-empresa">Empresa</span>'
kpi({ titulo, valor, sub, tono })          // tono: 'neutro'|'positivo'|'negativo'|'alerta'; valor ya formateado
tarjeta({ titulo, acciones, cuerpo })
tabla({ columnas:[{clave, titulo, alinear, render}], filas, vacio:'Sin registros', onFila? })  // responsive: en móvil se convierte en tarjetas (data-titulo)
lista(items)                               // lista simple con título/sub/valor
barraProgreso(porcentaje, tono)
graficaBarras({ series:[{etiqueta, valores:[...]}], categorias:[...], alto })   // SVG inline, accesible (<title>, role="img"), colores por tokens CSS
graficaDona({ datos:[{etiqueta, valor}] })
modal({ titulo, cuerpo, botones:[{texto, tono, accion}] , alCerrar })   // → { cerrar() }; cierra con Esc y clic fuera; focus trap básico
confirmar(mensaje, { peligro })            // → Promise<bool>
toast(mensaje, tipo='info', ms=3000)       // tipo: 'info'|'exito'|'error'|'alerta'
formulario(campos, valores={})             // campos: [{nombre, etiqueta, tipo:'texto'|'monto'|'fecha'|'select'|'textarea'|'numero'|'checkbox',
                                           //   opciones:[{valor, texto}], requerido, ayuda, min, max, paso}] → string HTML <form class="form">
leerFormulario(formEl)                     // → objeto con valores tipados (monto → número via parseMonto; fecha → iso; checkbox → bool)
validar(formEl, reglas)                    // marca errores en línea; → bool
segmentos(opciones, activo, onCambio)      // control segmentado (Empresa | Personal, etc.)
vacio(mensaje, accionTexto?, accion?)      // estado vacío con ilustración simple
fechaRelativa(iso)                         // 'hoy', 'mañana', 'en 3 días', 'hace 2 días'
```
Antes de implementar `graficaBarras`/`graficaDona`, el autor de ui.js debe invocar la skill `dataviz`
y seguir sus reglas (colores por tokens, accesibilidad, un sistema).

### VF.router
```js
registrar(ruta, { titulo, icono, nav: 'principal'|'mas'|false, render(contenedor, params) })
ir(ruta, params?)                          // location.hash = '#/ruta?a=b'
actual()                                   // { ruta, params }
iniciar()                                  // escucha hashchange, pinta nav, renderiza
rutas()                                    // [{ruta, titulo, icono, nav}] en orden de registro
```
Navegación: en pantallas < 900 px una barra inferior con 5 pestañas: Panel, Empresa, Personal,
Asistente, Más (Más abre hoja con el resto). En ≥ 900 px barra lateral con todas las rutas.
Rutas: `panel`, `empresa`, `personal`, `facturas`, `cobros` (alias de facturas con filtro pendientes),
`proveedores`, `prestamos`, `presupuestos`, `reportes`, `asistente`, `ajustes`. Ruta vacía → `panel`.
`cobros` y `facturas` las registra facturas.js. Al renderizar una ruta: `document.title = titulo + ' · VILLEDA Finanzas'`,
foco al `<h1>` de la vista, scroll arriba.

### app.js
- Si `!VF.store.existeBoveda()` → pantalla "Crear contraseña" (contraseña + confirmar + casilla "Cargar datos de ejemplo"
  activada por defecto, mínimo 8 caracteres, medidor de fortaleza simple). Botón "Crear".
- Si existe → pantalla "Desbloquear" (contraseña, botón, enlace "Olvidé mi contraseña" → explica que no hay recuperación y
  ofrece "Borrar todo y empezar de nuevo" con doble confirmación).
- Al desbloquear: oculta `#pantalla-bloqueo`, muestra `#app`, `VF.router.iniciar()`.
- Autobloqueo: temporizador reiniciado con `pointerdown/keydown/visibilitychange`; al vencer `ajustes.autobloqueoMin` → `VF.store.bloquear()`.
  También bloquear cuando la pestaña queda oculta más de `autobloqueoMin` minutos.
- Registrar `sw.js` SOLO si `location.protocol.startsWith('http')`.
- Banner de datos de ejemplo visible mientras `ajustes.datosEjemplo` sea true, con enlace a Ajustes.
- Tema: aplicar `data-tema` en `<html>` según ajustes ('auto' usa prefers-color-scheme).

## 4. Vistas (qué debe mostrar cada módulo)

**Panel (`#/panel`)** — Selector segmentado `Empresa | Personal | Combinado`. KPIs del mes actual:
Ingresos, Gastos, Balance (o Utilidad en empresa), Disponible (según `disponibleEmpresa`/`disponiblePersonal`).
Bloque "Próximos 7 días" con `vencimientos` (cobros en verde, pagos en rojo) y botón "Ver todo".
Gráfica de barras ingresos vs gastos últimos 6 meses (`serieMensual`). Lista "Por cobrar" (top 5) en empresa.
"Movimientos recientes" (10). "Para revisar" (conteo de `movimientosARevisar`). En Combinado: dos columnas Empresa / Personal
con sus líquidos y una fila "Total combinado (solo informativo)".

**Empresa (`#/empresa`)** y **Personal (`#/personal`)** — Mismo componente parametrizado por ámbito (escribirlo en empresa.js como
`VF.vistas.ambito(ambito)` y reutilizarlo en personal.js). Secciones: Cuentas (tarjetas con saldo; crear/editar/archivar), Movimientos
(filtros: periodo rápido Hoy/Semana/Mes/Personalizado, tipo, cuenta, categoría, búsqueda; tabla; alta rápida "+ Ingreso", "+ Gasto",
"+ Transferencia"), Gastos por categoría (dona). Personal añade "Metas de ahorro" y "Deudas" (tarjetas de crédito + préstamos recibidos
personales). Empresa añade accesos a Facturas/CxC, Proveedores/CxP, Comisiones.
Formulario de movimiento: tipo, cuenta (sólo del ámbito), monto, fecha (hoy por defecto), categoría (según ámbito y tipo), descripción,
contraparte, estado. Transferencia: cuenta destino puede ser de otro ámbito → mostrar aviso "Se registrará como Retiro de socio / Aportación de capital".

**Facturas y Cobros (`#/facturas`, `#/cobros`)** — Clientes (CRUD), facturas (CRUD, folio autoincremental `F-0001`, IVA 16 % automático,
estado derivado con color), "Registrar pago" (monto, fecha, cuenta empresa → crea movimiento ingreso categoría Ventas vinculado),
resumen Por cobrar / Vencido / Antigüedad. `#/cobros` abre con filtro "pendientes" y agrupado por cliente.

**Proveedores (`#/proveedores`)** — pestañas Proveedores | Cuentas por pagar | Comisiones. Pago de CxP → movimiento gasto
categoría Proveedores. Pago de comisión → movimiento gasto categoría Comisiones. Comisión calculada por porcentaje sobre factura o base manual.

**Préstamos (`#/prestamos`)** — Lista por ámbito con saldo insoluto, próximo pago, progreso. Detalle con tabla de amortización.
"Registrar pago" divide capital/interés según la tabla (interés = saldo × r; capital = pago − interés) y crea movimiento (gasto 'Préstamos'
si recibido; ingreso 'Otros ingresos' si otorgado) en la cuenta elegida del MISMO ámbito.

**Presupuestos (`#/presupuestos`)** — selector ámbito + mes; tabla categoría / presupuesto / real / diferencia con barra; "Copiar del mes anterior";
alta/edición en línea.

**Reportes (`#/reportes`)** — selector ámbito + rango. Estado de resultados (empresa), Flujo de efectivo mensual, Gastos por categoría,
Antigüedad de saldos CxC, Resumen de IVA (trasladado = suma iva de facturas emitidas en el rango; acreditable = 16/116 de gastos con
categoría Proveedores/Materiales/Servicios/Software/Honorarios/Publicidad — marcado como estimado). Botones: "CSV movimientos",
"CSV facturas", "CSV cuentas por pagar", "Paquete para contador" (descarga los 3 CSV + resumen .txt), "Imprimir / PDF" (`window.print()` con
hoja de estilos de impresión).

**Asistente (`#/asistente`)** — Chat local. Chips con preguntas sugeridas (las 5 del brief + "¿Cuál fue mi utilidad este mes?",
"¿Qué movimientos debo revisar?", "¿Cómo voy con el presupuesto?", "¿Cómo se ve mi flujo a 30 días?"). Entrada de texto. Respuestas
en tarjetas con cifras y, cuando aplique, listas/tablas pequeñas y enlace "Ver detalle" a la vista correspondiente.
Motor local `VF.asistente.responder(pregunta, estado)` → `{ texto, html?, intent, ambito, enlaces:[{texto, ruta}] }`.
Intenciones mínimas (detectar con `VF.util.normalizar` + sinónimos; soportar "VILLEDA", "la empresa", "el negocio" = empresa;
"yo", "personal", "mío" = personal; "hoy", "ayer", "esta semana", "semana pasada", "este mes", "mes pasado", "mañana", "próximos N días"):
`disponible_total`, `gastos_periodo`, `ingresos_periodo`, `por_cobrar`, `por_pagar`, `disponible_personal`, `vencimientos`, `utilidad`,
`presupuesto`, `revisar`, `flujo`, `saldo_cuenta` ("¿cuánto hay en Nu?"), `prestamos`, `comisiones`, `metas`, `ayuda`, `desconocido`.
Si `ajustes.asistenteEndpoint` está configurado: `POST { pregunta, contexto: VF.calc.resumenParaIA(estado) }` con `fetch`, mostrar respuesta
`{ texto }`; si falla, caer al motor local e indicarlo. Nunca enviar descripciones, contrapartes ni contraseñas.

**Ajustes (`#/ajustes`)** — Nombre, empresa, autobloqueo, reserva operativa, tema, cambiar contraseña, exportar respaldo (cifrado o plano
con advertencia), importar respaldo, borrar datos de ejemplo, borrar todo, servidor de IA (URL + botón probar), acerca de (versión, aviso
"prototipo, no es asesoría financiera ni contable").

## 5. Diseño visual

- Tokens en `:root`: `--fondo`, `--superficie`, `--superficie-2`, `--texto`, `--texto-2`, `--borde`, `--primario` (#1D4ED8 empresa azul),
  `--personal` (#047857 verde), `--positivo`, `--negativo` (#B91C1C), `--alerta` (#B45309), `--radio` 14px, `--sombra`.
  Modo oscuro con `@media (prefers-color-scheme: dark)` y `html[data-tema="oscuro"]`; claro forzado con `html[data-tema="claro"]`.
- Tipografía del sistema: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif`;
  cifras con `font-variant-numeric: tabular-nums`.
- Mobile-first. Área táctil mínima 44×44 px. `env(safe-area-inset-*)` en barra inferior y header. Sin scroll horizontal.
- Ámbito siempre visible: el header cambia un acento de color (azul/verde) según el ámbito activo y muestra el badge.
- Accesibilidad: contraste AA, `aria-label` en iconos, `role="status"` en toasts, `aria-live` en respuestas del asistente,
  foco visible, formularios con `<label for>`.
- Iconos: SVG inline simples (trazo 1.75, 24px) definidos en ui.js como `VF.ui.icono(nombre)`.

## 6. Pruebas

- `node tests/calc.test.js`: carga `js/core/util.js` y `js/core/calc.js` en Node (simulando `window = globalThis`, `crypto` nativo),
  construye un estado de prueba pequeño y verifica: saldos, exclusión de transferencias en utilidad, separación de ámbitos
  (ningún total de empresa cambia al agregar movimientos personales y viceversa), estados derivados de factura, amortización,
  vencimientos, disponiblePersonal, duplicados. Salida: `OK n pruebas` o lista de fallos y `process.exit(1)`.
- `node tests/smoke.js`: servidor `http` de Node sirviendo `villeda-finanzas/` en un puerto libre; Playwright chromium (ya instalado,
  `require('playwright')`, `chromium.launch()` sin opciones). Escenarios en viewport iPhone (390×844, `isMobile`) y escritorio (1280×800):
  crear contraseña con datos de ejemplo → panel con KPIs no vacíos; visitar todas las rutas sin errores de consola (`pageerror`,
  `console.error`); crear movimiento gasto empresa y verificar saldo de cuenta; transferencia empresa→personal no altera utilidad;
  asistente responde a las 5 preguntas del brief con una cifra en MXN; registrar pago de factura cambia estado; exportar CSV genera
  descarga; recargar → bloqueo → desbloquear → datos persisten; contraseña incorrecta muestra error; modo oscuro no rompe layout
  (captura en `tests/capturas/`). Falla con `process.exit(1)` y mensaje claro.

## 7. Criterios de aceptación de la v1.0

1. Abrir `index.html` desde disco en Chrome/Safari funciona sin consola roja.
2. Toda cifra visible proviene de `VF.calc`; sin datos → "Sin movimientos".
3. Ningún cálculo mezcla ámbitos (verificado en `calc.test.js`).
4. Las 5 preguntas del brief reciben respuesta correcta con las cifras del seed.
5. Flujo completo CRUD en todas las colecciones sin errores; eliminar respeta integridad.
6. Recarga mantiene datos; contraseña incorrecta no revela nada; cambio de contraseña funciona.
7. Exportar/Importar respaldo redondea sin pérdida.
8. iPhone 390 px: sin scroll horizontal, barra inferior usable, formularios cómodos.
9. PWA instalable (manifest válido, iconos, SW) cuando se sirve por HTTPS.
10. `node tests/calc.test.js` y `node tests/smoke.js` pasan.

## Extensiones
(Agregar aquí cualquier API pública nueva que un módulo haya necesitado: archivo, nombre, firma, motivo.)

### Base/datos (util, crypto, store, seed)

- `js/core/store.js` — `guardar()` devuelve `Promise<boolean>` (true si persistió). Las escrituras se encolan y se
  serializan: cada llamada toma una instantánea del estado, de modo que `agregar/actualizar/eliminar` pueden seguir
  siendo síncronos y `bloquear()` justo después no pierde cambios. Motivo: AES-GCM es asíncrono.
- `js/core/store.js` — evento adicional `'error'` (carga: `Error`) emitido cuando falla la persistencia (p. ej. cuota
  de localStorage). La promesa de `guardar()` resuelve `false` en ese caso en vez de rechazar, para que las llamadas
  internas sin `await` no generen rechazos no manejados.
- `js/core/store.js` — códigos de error (mensaje del `Error`) además de los del contrato: `BLOQUEADO` (operar sin
  desbloquear), `SIN_BOVEDA` (desbloquear/cambiar contraseña sin bóveda), `BOVEDA_EXISTE` (`crear` sobre una bóveda ya
  existente; usar `borrarTodo()` antes), `DATOS_CORRUPTOS` (la contraseña abre el verificador pero no los datos),
  `CONTRASENA_VACIA`, `CONTRASENA_REQUERIDA` (importar respaldo cifrado de otra bóveda sin contraseña),
  `JSON_INVALIDO`, `FORMATO_DESCONOCIDO` (importar), `COLECCION_INVALIDA`, `AMBITO_INVALIDO` (registro de
  cuentas/movimientos/prestamos/presupuestos/metas sin `ambito` 'empresa'|'personal'; metas asume 'personal'),
  `REGISTRO_INVALIDO`, `ID_DUPLICADO`.
- `js/core/store.js` — `borrarDatosEjemplo()` devuelve el número de registros eliminados; también limpia `pagos[]`
  anidados con id `_demo`. `exportarJSON({cifrado:true})` devuelve la bóveda tal como está persistida (última escritura
  completada); `importarJSON` requiere estar desbloqueado, acepta la contraseña del respaldo y re-cifra con la clave
  actual (la contraseña de la bóveda no cambia). Si el respaldo cifrado tiene el mismo `salt` que la bóveda abierta, no
  requiere contraseña. `actualizar()` ignora cambios a `id` y `creado`.
- `js/core/seed.js` — las transferencias entre cuentas del MISMO ámbito usan la categoría `'Transferencia entre
  cuentas'` (no está en las listas de ingreso/gasto porque las transferencias nunca cuentan en utilidad ni
  presupuestos). Las cruzadas usan 'Retiro de socio' / 'Aportación de capital' según el contrato.
- `js/core/util.js` — `fmtFecha`/`fmtFechaLarga` se construyen a mano (no con `Intl.DateTimeFormat`) para que Safari y
  Chrome muestren exactamente '25 oct 2026' / 'sábado, 25 de octubre de 2026'. `agrupar(arr, fn)` acepta también el
  nombre de un campo. `csv()` usa CRLF, acepta arreglos (unidos con '; ') y booleanos ('sí'/'no').
- `tests/store.test.js` — `node tests/store.test.js`: pruebas de util, crypto, store y seed en Node (polyfill mínimo de
  localStorage; WebCrypto nativo de Node 22). Salida `OK n pruebas` o lista de fallos y `process.exit(1)`.

### Base/interfaz (index.html, css/app.css, ui.js, router.js, app.js, sw.js) — v1.0

**Convención de retorno de VF.ui.** Todos los componentes (`kpi`, `tarjeta`, `tabla`, `lista`, `barraProgreso`,
`graficaBarras`, `graficaDona`, `formulario`, `segmentos`, `vacio`, `badgeAmbito`, `icono`) devuelven **string HTML**.
Los callbacks se resuelven por **delegación global** con ids internos `data-vf-id`, así que el string puede insertarse
con `innerHTML` o convertirse con `VF.ui.el()` y el callback funciona igual:
- `tabla({ onFila })` → `onFila(id, trEl, evento)`; `id` es `fila.id` (o el índice si no hay id). Las filas reciben
  `data-fila` y `tabindex="0"` (Enter/Espacio = clic). Un clic sobre `button/a/input` dentro de la fila NO dispara `onFila`.
- `segmentos(opciones, activo, onCambio)` → `onCambio(valor, botonEl)`; actualiza `aria-selected` por sí solo; flechas ←/→ navegan.
  `opciones` admite strings o `{valor, texto}`.
- `vacio(mensaje, accionTexto, accion)` → `accion(evento)`.
- `lista(items)`: items `{ icono?, titulo, sub?, valor?, tono?('positivo'|'negativo'|'alerta'), accion?, id? }`. Si hay `accion`,
  el `<li>` lleva `data-accion`/`data-id` y `role="button"`; la delegación la hace el módulo (no VF.ui).
- `kpi.valor` se escapa (pasar ya formateado). `tarjeta({ titulo, acciones, cuerpo, clase? })`: `acciones` y `cuerpo` son HTML ya construido.

**VF.ui — API añadida / detalles de firma**
```js
icono(nombre, etiqueta?)        // SVG inline 24px trazo 1.75; con `etiqueta` → role="img" aria-label; sin ella aria-hidden.
                                // nombres: panel empresa personal facturas cobros proveedores prestamos presupuestos reportes asistente
                                // ajustes mas bloquear desbloquear cerrar agregar buscar editar eliminar exportar importar descargar guardar
                                // alerta info exito error flecha flecha-izq ojo ojo-cerrado calendario transferencia ingreso gasto imprimir
                                // copiar enviar luna sol tema cuenta meta revisar filtro refrescar ayuda archivo vacio chat pago
ambitoActivo(ambito)            // 'empresa' | 'personal' | 'combinado' | null → fija <html data-ambito> (acento azul/verde) y el badge
                                // de la cabecera (#badge-ambito). El router lo llama al entrar a cada ruta (empresa/facturas/cobros/
                                // proveedores → empresa; personal → personal; resto → null). Los módulos con selector de ámbito
                                // (panel, presupuestos, reportes, préstamos) deben llamarlo al cambiar de segmento.
cerrarModales()                 // cierra todos los modales abiertos (se invoca automáticamente en hashchange y al bloquear).
modal({ titulo, cuerpo, botones, alCerrar, hoja? })
                                // cuerpo: string HTML o Element. botones: [{texto, tono:'primario'|'secundario'|'peligro'|'fantasma', accion}]
                                // accion(api) → si devuelve `false` (o una promesa que resuelve `false`) el modal NO se cierra (útil para
                                // validar formularios); en cualquier otro caso se cierra. Devuelve { cerrar(), elemento }.
                                // hoja:true → variante "hoja inferior" (la usa el router para "Más").
confirmar(mensaje, { peligro, titulo?, textoAceptar?, textoCancelar? })
formulario(campos, valores)     // tipos extra admitidos: 'oculto', 'contrasena', 'email', 'tel', 'url'. Propiedades extra por campo:
                                // placeholder, valor (default si no viene en `valores`), deshabilitado, autofoco, filas (textarea), maxlength.
                                // Cada control lleva data-campo / data-tipo; el contenedor .campo lleva data-campo-cont.
leerFormulario(formEl)          // monto → número (NaN si inválido o vacío); numero → número | null; checkbox → bool; resto → string trim.
validar(formEl, reglas)         // reglas: { campo: fn(valor, valores) → string(error) | false | null } o [{campo, fn, mensaje}].
                                // Valida solo requeridos, montos (NaN, min/max), números, fechas y email; enfoca el primer error.
graficaBarras({ series, categorias, alto, titulo? })
                                // Se re-dibuja al ancho real del contenedor (MutationObserver + resize) para que el texto no escale.
                                // Incluye leyenda (≥2 series), <title> por barra (tooltip nativo) y <details> "Ver datos en tabla".
graficaDona({ datos, titulo? }) // máx. 6 segmentos (el resto se agrupa en "Otros"); leyenda con monto y %.
```

**VF.router — API añadida**
```js
renderizar()                    // vuelve a pintar la ruta actual sin cambiar el hash (p. ej. tras guardar un registro).
```
Comportamiento: el router NO renderiza mientras `VF.store.estaDesbloqueado()` sea false. La navegación muestra siempre
las 11 rutas del contrato (aunque el módulo no se haya registrado → "Módulo no disponible"). `registrar()` acepta
`nav: 'principal' | 'mas' | false`; `nav` por defecto para rutas conocidas: panel/empresa/personal/asistente = principal,
cobros = false, resto = mas. `ir()` con el mismo hash actual re-renderiza. Cada vista recibe `render(contenedor, params)` con
`contenedor = <main id="vista">` ya vacío.

**VF.app** (app.js) `{ version:'1.0.0', bloquear(), aplicarTema(tema) }`. app.js guarda la preferencia de tema del
dispositivo en `localStorage['vf.tema']` (no sensible) para aplicarla antes de desbloquear; tras desbloquear manda
`ajustes.tema`. Escucha `VF.store.on('cambio')` para re-aplicar tema y banner de ejemplo: ajustes.js solo necesita
`VF.store.setAjustes({...})`.

**Clases CSS disponibles para los módulos** (css/app.css): layout `vista-cabecera` (h1 + `vista-acciones`), `kpis`,
`rejilla-2|3|4`, `fila`, `fila-entre`; botones `btn btn-primario|secundario|peligro|fantasma|enlace btn-chico|grande|icono|bloque`;
`badge badge-empresa|personal|combinado|positivo|negativo|alerta|info`; `aviso aviso-alerta|error|exito`; `chips`/`chip`;
`pestanas`/`pestana[aria-selected]`; `filtros` (contenedor de `.campo` en fila); `form-fila` (2 columnas ≥560px),
`form-acciones`; `chat`, `burbuja burbuja-usuario|asistente`; texto `positivo|negativo|alerta|texto-2|texto-3|derecha|centro|truncar`;
impresión `no-imprimir` / `solo-imprimir`. Las tablas de `VF.ui.tabla` se vuelven tarjetas < 720px usando `td[data-titulo]`.

**sw.js**: constante `VF_VERSION` (cambiar al publicar). **tests/capturas/base-*.png**: capturas de la base (bloqueo, shell,
modal, hoja "Más") en 390×844 y 1280×800, claro y oscuro.

### Base/cálculo (calc)

- `js/core/calc.js` — `fijarHoy(iso)` fija la fecha que devuelve `VF.calc.hoy()` (sólo para pruebas);
  `fijarHoy(null)` vuelve a la fecha real. Toda función que recibe `ambito` lanza `Error('AMBITO_REQUERIDO')`
  si no es 'empresa' | 'personal'.
- `saldosPorAmbito()` sólo considera cuentas con `activa !== false` (las archivadas no suman ni aparecen en
  `cuentas`; usar `saldoCuenta()` directo para ellas). El resultado incluye `ambito`.
  `combinado().combinadoInformativo` lleva `{ etiqueta, liquido, credito, total }`.
- `movimientosEn()` devuelve la lista ordenada por `fecha` descendente (a igual fecha, `creado` descendente);
  `desde`/`hasta` en `null` = sin límite; el filtro `cuentaId` también incluye transferencias RECIBIDAS por esa cuenta.
- `utilidadMes()` incluye `periodo` y `margen` en % (`null` cuando no hubo ingresos). `periodo` omitido = mes de hoy().
- `gastosPorCategoria()`/`ingresosPorCategoria()` añaden `cantidad`; los movimientos sin categoría se agrupan
  como 'Sin categoría'.
- `estadoFactura()`/`estadoCxP()`: una factura/CxP con pago parcial YA vencida se reporta 'parcial' (orden del
  contrato), pero su pendiente sí cuenta en `porCobrar().vencido` / `porPagar().vencido`. Los elementos de
  `porCobrar().facturas` y `porPagar().cuentas` llevan `{ pendiente, pagado, dias, vencida, estado, fecha }`
  (`dias` = días desde el vencimiento, negativo si aún no vence) y se ordenan por vencimiento; `porCliente` /
  `porProveedor` se ordenan por total descendente e incluyen `clienteId` / `proveedorId`.
- `antiguedadCxC()` clasifica por días desde el vencimiento; lo que aún no vence cuenta en '0-30'. Los cuatro
  tramos suman exactamente `porCobrar().total` (porVencer = total − vencido).
- Amortización (`tablaAmortizacion`, `pagoMensual`, `proximoPagoPrestamo`): redondeo a 2 decimales en cada
  paso (interés = round2(saldo × r), capital = round2(pago − interés)); la ÚLTIMA fila toma como capital el saldo
  restante para cerrar en 0, por lo que su `pago` puede diferir unos centavos de `pagoMensual()`. Fecha del pago n =
  fechaInicio + n meses el día `diaPago` (o el día de fechaInicio) ajustado al máximo del mes. `proximoPagoPrestamo()`
  calcula sobre el saldo REAL (`saldoPrestamo`) y devuelve `{ fecha, monto, capital, interes, n, vencido }`; `null` si
  el préstamo no está 'activo' o su saldo ≤ 0. El cálculo coincide con los pagos que genera `VF.seed`.
- `vencimientos()` añade a cada elemento `vencido` (fecha < hoy) y `dias` (días desde hoy, negativo si ya pasó);
  `desde`/`hasta` en `null` = sin límite. Tarjetas de crédito: una sola ocurrencia (el próximo `diaPago` ≥ hoy) por
  la deuda completa (`origen.coleccion = 'cuentas'`). Comisiones pendientes usan su `fecha` como vencimiento.
  Orden: fecha, luego cobros antes que pagos, luego monto descendente.
- `presupuestoVsReal()` devuelve un ARREGLO con propiedades adicionales `totalPresupuesto`, `totalReal`,
  `totalDiferencia`, `ambito`, `periodo` (usar `res.totalPresupuesto`, no `res.filas`). Cada fila:
  `{ categoria, tipo, presupuestoId, presupuesto, real, diferencia, porcentaje, sinPresupuesto }`;
  las categorías con gasto real pero sin presupuesto aparecen con `presupuesto: 0, sinPresupuesto: true`;
  `diferencia = presupuesto − real` (positivo = por debajo); `porcentaje = null` si presupuesto 0. Una categoría que
  sólo exista en la lista de ingresos se trata como presupuesto de ingreso; los totales sólo suman filas de gasto.
- `disponiblePersonal()`/`disponibleEmpresa()`: los `compromisos` son los vencimientos tipo 'pago' del ámbito en
  [hoy, hoy+dias] MÁS los ya vencidos y aún pendientes (siguen debiéndose). Resultado:
  `{ ambito, dias, hasta, liquido, credito, compromisos, totalCompromisos, disponible }`. `disponibleEmpresa` sin
  `dias` usa `ajustes.reservaOperativaDias` (30 si no existe).
- `flujoProyectado()` devuelve una fila por día (dias + 1 filas, de hoy a hoy+dias); lo ya vencido se carga en la
  fila de hoy. Parte del `liquido` del ámbito (no incluye tarjetas).
- `movimientosARevisar()` añade `total` (conteo de hallazgos) y en `atipicos` el campo `veces` (monto / mediana).
  Las transferencias no cuentan como `sinCategoria`. Sin `ambito` revisa ambos ámbitos por separado (los duplicados
  y la mediana nunca cruzan ámbitos).
- `metaProgreso()`: `ahorrado` se acota a ≥ 0 y `porcentaje` a ≤ 100; si `cuentaId` no existe, ahorrado = 0.
- `resumenParaIA()` incluye además `generado`, `periodo`, `prestamos` (saldo y próximo pago, sin contraparte),
  `empresa.cuentas`/`personal.cuentas` (`{ tipo, banco, saldo }`, sin nombre de cuenta), top 5 de
  `gastosPorCategoria`, `presupuesto` (totales), `revisar` (conteos) y `metas` (sin nombre). Sin descripciones,
  contrapartes, nombres de clientes/proveedores/metas ni conceptos.
- `tests/calc.test.js` — fija hoy = 2026-10-25 con `fijarHoy`; estado de prueba propio (no usa el seed) y
  propiedad de separación: ninguna instantánea de totales de un ámbito cambia al agregar registros del otro.

### Integración base (shell de punta a punta, pruebas E2E)

- `tests/servidor.js` — servidor `http` estático de Node sin dependencias que sirve la raíz del proyecto con
  tipos MIME correctos (`.webmanifest` → `application/manifest+json`), `Cache-Control: no-store` y sin salir de
  la raíz. `node tests/servidor.js [puerto]` imprime la URL; como módulo `iniciar(puerto?) → Promise<{ url,
  puerto, raiz, cerrar() }>` (puerto 0/omitido = libre, sólo 127.0.0.1).
- `tests/ayuda.js` — utilidades Playwright compartidas: `iniciarServidor()`, `abrir(viewport, { url,
  colorScheme, navegar })` (viewport `'movil'` 390×844 isMobile/táctil, `'escritorio'` 1280×800 u objeto; cada
  llamada crea un contexto NUEVO con almacenamiento limpio, locale es-MX, zona America/Mexico_City; la página
  lleva `page.vf.errores`), `crearBoveda(page, contrasena, conEjemplo)`, `desbloquear(page, contrasena) →
  true|false` (false = se mostró `#desbloquear-error`), `bloquear(page)`, `recogerErrores(page)` (arreglo vivo
  de `pageerror` + `console.error`), `hayScrollHorizontal(page)`, `quitarToasts(page)`, `captura(page,
  nombre)` (espera 320 ms a que terminen las animaciones y guarda `tests/capturas/<nombre>.png`), `cerrar()`,
  más `URL_FILE` (index.html por `file://`) y `RAIZ`.
  **TODO módulos:** mientras no existan los diez `js/modules/*.js`, `recogerErrores` ignora únicamente los
  avisos "Failed to load resource" / `ERR_FILE_NOT_FOUND` cuya URL sea `/js/modules/<nombre>.js` (quedan en
  `page.vf.ignorados`); cualquier otro error de consola sí cuenta. Quitar ese filtro cuando lleguen los módulos.
- `tests/smoke.js` — `node tests/smoke.js` → `OK n comprobaciones` o lista de fallos y `process.exit(1)`
  (guardia de 4 minutos). Escenarios actuales: (A) móvil claro por http: bloqueo, validaciones de crear
  (longitud/coincidencia/medidor), crear con ejemplo, shell (cabecera, 5 pestañas, `<main>` con h1 y foco),
  hoja "Más" (6 secciones), ámbito Personal (badge + `data-ambito` + badge cabe en 390 px), bloquear,
  contraseña incorrecta, desbloquear, bóveda cifrada en localStorage, recarga → bloqueo → datos persisten;
  (B) escritorio oscuro por http: bóveda sin ejemplo (sin banner), 10 enlaces laterales, las 11 rutas
  (título, `data-ambito`, enlace activo, sin scroll horizontal), ruta desconocida, botón de tema y
  `ajustes.tema`, evento `cambio` → banner/tema, `VF.store.bloquear()` desde código; (C) `file://`: carga sin
  errores, 9 espacios de nombres, crear, recargar, desbloquear; (D) "Olvidé mi contraseña" con cancelaciones y
  doble confirmación → bóveda borrada → crear de nuevo. Capturas `tests/capturas/smoke-*.png`. Los escenarios
  de §6 que dependen de módulos (KPIs, movimientos, asistente, pago de factura, CSV) están marcados
  `// TODO módulos`.
- `css/app.css` — en pantallas < 480 px, cuando la cabecera muestra un badge de ámbito (`html[data-ambito]` o
  `.cabecera:has(#badge-ambito .badge)`), la marca se abrevia a "VILLEDA" para que el badge quepa entre la
  marca y los dos botones de la cabecera. `.cabecera-acciones` es `flex: none`.

### Módulo Panel (js/modules/panel.js)

- Registro: `VF.router.registrar('panel', { titulo:'Panel', icono:'panel', nav:'principal', render })`. Acepta
  `#/panel?ambito=empresa|personal|combinado` (fija el segmento). El segmento elegido se recuerda en
  `sessionStorage['vf.panel.ambito']` (por pestaña, no sensible; por defecto 'empresa'). Al pintar y al cambiar de
  segmento llama a `VF.ui.ambitoActivo(ambito)` ('combinado' → badge "Combinado" en la cabecera, sin acento).
- **API pública `VF.panel`** (para otros módulos y pruebas; todos los modales devuelven la api `{ cerrar, elemento }`):
  ```js
  render(contenedor, params)          // la misma función registrada en el router
  ambito()                            // 'empresa' | 'personal' | 'combinado' activo en el panel
  fijarAmbito(ambito)                 // cambia el segmento (aria-selected) y vuelve a pintar el cuerpo
  nuevoMovimiento({ ambito?, tipo?, id? }) // modal de alta rápida; con `id` edita (null si está vinculado a factura/CxP/préstamo/comisión)
  verMovimiento(id)                   // modal de detalle: Eliminar (con confirmación) y Editar sólo si NO está vinculado
  vencimientos(ambito?)               // modal "Ver todo" con VF.calc.vencimientos(estado, null, null) del ámbito (combinado = ambos)
  revision(ambito?)                   // modal "Para revisar" con VF.calc.movimientosARevisar(estado, ambito|undefined)
  ```
- Alta rápida de movimientos (auxiliar privado del panel, reutilizable vía `VF.panel.nuevoMovimiento`): el ámbito del
  registro es el de la cuenta origen; transferencia entre ámbitos distintos → categoría 'Retiro de socio' (empresa→personal)
  o 'Aportación de capital' (personal→empresa) con aviso en el formulario; mismo ámbito → 'Transferencia entre cuentas'.
  Si el movimiento guardado es de otro ámbito que el segmento visible, el panel cambia al segmento del movimiento.
- Parámetros de ruta que el panel ENVÍA al tocar un vencimiento, cuenta o cliente (los módulos destino deberían
  honrarlos): `#/facturas?id=<facturaId>`, `#/proveedores?pestana=cxp&id=<cxpId>`,
  `#/proveedores?pestana=comisiones&id=<comisionId>`, `#/prestamos?id=<prestamoId>`, `#/empresa?cuenta=<cuentaId>` /
  `#/personal?cuenta=<cuentaId>`, `#/cobros?cliente=<clienteId>`, `#/asistente?pregunta=<texto>`.
- Eventos: un solo oyente de `click` en `document` para `[data-accion^="panel-"]` (`panel-nuevo-movimiento`,
  `panel-ver-movimiento`, `panel-ver-vencimientos`, `panel-ver-revision`, `panel-ir-origen`, `panel-ir-cuenta`,
  `panel-ir-cliente`); no actúa con la bóveda bloqueada. `VF.store.on('cambio')` re-pinta sólo `#panel-cuerpo` (retardo
  de 30 ms) y únicamente si `VF.router.actual().ruta === 'panel'`; no se desuscribe nunca (la comprobación basta).
- Cifras: todo sale de `VF.calc` (ingresos/gastos/balance/utilidadMes/disponibleEmpresa|Personal/vencimientos/
  serieMensual/porCobrar/saldosPorAmbito/combinado/movimientosARevisar). Sin cuentas ni movimientos en el ámbito →
  `VF.ui.vacio(..., 'Agregar movimiento')`; con cuentas pero sin movimientos en el mes → KPIs con "—" y "Sin movimientos
  en <mes>" (nunca ceros falsos). En Combinado no hay KPIs: dos columnas (cuentas + líquido + cifras del mes de cada
  ámbito) y la tarjeta "Total combinado (solo informativo)" con `combinado().combinadoInformativo`.
- Layout (defecto corregido): dentro de `.rejilla-2` las columnas con tarjetas apiladas van envueltas en
  `<div class="tarjeta-cuerpo">`. Un elemento de rejilla tiene `min-width:auto`, y las listas con `.lista-titulo`
  (`white-space:nowrap`) ensanchaban la pista hasta ~900 px → scroll horizontal en 390 px. `.tarjeta-cuerpo` es la única
  clase de css/app.css cuyo único efecto es `min-width:0`. **Resuelto en «Integración total»**: css/app.css aplica
  `.rejilla > *, .rejilla-2 > *, .rejilla-3 > *, .rejilla-4 > * { min-width: 0 }`, así que el panel puede volver a `<div>` simples. Los badges
  de ámbito/estado van al INICIO de `.lista-sub` porque la línea se trunca con elipsis en móvil.
- Pruebas E2E del panel (Playwright + `tests/ayuda.js`; capturas `tests/capturas/panel-*.png` en 390×844 y 1280×800, claro
  y oscuro): KPIs = VF.calc en los tres ámbitos, próximos 7 días (tonos), gráfica (tabla gemela = serieMensual), por cobrar
  top 5 sólo en empresa, recientes (orden y badges), alta con validación → saldo/KPI/lista, detalle, edición, eliminación
  con confirmación, transferencia cruzada (categoría, saldos, utilidad intacta), vinculados sólo lectura, "Ver todo" y
  navegación al origen, reactividad a 'cambio' dentro y fuera de la ruta, sessionStorage y `?ambito=`, estados vacíos,
  `file://`. Nota para quien escriba E2E: con `html { scroll-behavior: smooth }` los clics de Playwright sobre elementos
  bajo el pliegue fallan por intercepción (el scroll anima); usar `page.emulateMedia({ reducedMotion: 'reduce' })`.

### Módulos Empresa y Personal (js/modules/empresa.js, js/modules/personal.js)

- Registro: empresa.js registra `'empresa'` y personal.js `'personal'` (ambos `nav:'principal'`). Las dos rutas honran
  `?cuenta=<cuentaId>` (filtran los movimientos por esa cuenta, hacen scroll a la sección y limpian el hash con
  `history.replaceState`). personal.js requiere que empresa.js se haya cargado antes (orden de `<script>` del contrato).
- **Componente reutilizable `VF.vistas.ambito(contenedor, ambito, { extras, params })`** — firma real del componente
  que §4 cita como `VF.vistas.ambito(ambito)`; `contenedor` es el `<main id="vista">` (o un selector). Pinta: cabecera
  (h1, subtítulo con líquido y botones "+ Ingreso", "+ Gasto", "+ Transferencia"), Cuentas (tarjetas `.kpi` con saldo de
  `VF.calc.saldoCuenta`; tarjetas de crédito con deuda, límite, uso, corte y pago; resumen `saldosPorAmbito`; bloque
  `<details id="ambito-archivadas">`), Movimientos (segmentos Hoy/Semana/Mes/Personalizado, filtros tipo/cuenta/categoría/
  búsqueda, chips de filtros activos, resumen ingresos/gastos/balance/transferencias del periodo, `VF.ui.tabla` paginada de
  20 en 20 con "Mostrar más"), Gastos por categoría (`VF.ui.graficaDona` sobre `gastosPorCategoria` del periodo
  filtrado) y las tarjetas `extras` en `.rejilla-2|3|4` según su número. Llama a `VF.ui.ambitoActivo(ambito)`.
  ```js
  extras: [{ id, titulo, acciones?: string | fn(ctx) → string, render(el, ctx) }]  // el = .tarjeta-cuerpo de su tarjeta
  ctx = { ambito, estado, hoy, repintar(), nuevoMovimiento({ tipo?, cuentaId?, id? }), verCuenta(id) }
  // devuelve { ambito, repintar(), pintarMovimientos(), filtros() }
  VF.vistas.formularioMovimiento(ambito, { tipo?, cuentaId?, id? })  // → api del modal { cerrar, elemento } | null
  VF.vistas.formularioCuenta(ambito, { id? })                        // → api del modal | null
  VF.vistas.detalleMovimiento(ambito, id)                            // → api del modal | null
  VF.empresa  = { render(contenedor, params), nuevoMovimiento(o), nuevaCuenta() }
  VF.personal = { render(contenedor, params), nuevaMeta(), editarMeta(id), nuevoMovimiento(o), nuevaCuenta() }
  ```
  `formularioMovimiento` devuelve `null` (con toast) si el movimiento no existe o está vinculado a factura/CxP/préstamo/
  comisión: esos se editan/eliminan desde su sección (el detalle los muestra en sólo lectura con aviso).
- Reglas: el ámbito del movimiento es SIEMPRE el de la cuenta origen; el select de cuenta sólo ofrece cuentas activas del
  ámbito; el de cuenta destino ofrece las activas de ambos ámbitos (primero las del propio). Transferencia a otro ámbito →
  categoría 'Retiro de socio' (empresa → personal) / 'Aportación de capital' (personal → empresa) con aviso en el
  formulario; mismo ámbito → 'Transferencia entre cuentas'. Al cambiar el tipo (ingreso ↔ gasto) se descarta la categoría
  que ya no pertenece a la lista (salvo la original del movimiento en edición). Toda cifra sale de `VF.calc`; sin cuentas
  → `VF.ui.vacio` con "Crear cuenta"; sin movimientos en el periodo → "Sin movimientos · <periodo>" (sin ceros).
- Cuentas: crear / editar / archivar (`activa:false`; conserva movimientos; deja de contar en `saldosPorAmbito`) /
  restaurar / eliminar. Archivar una cuenta con movimientos o con saldo pide confirmación explicando que el historial se
  conserva. Eliminar una cuenta con movimientos se impide con un modal amable ("Esta cuenta no se puede eliminar", n
  movimientos, regla 2.1) que ofrece "Archivar cuenta"; sin movimientos pide confirmación de peligro. Para tarjetas de
  crédito el formulario pide "Deuda inicial" y la guarda como `saldoInicial` negativo; límite, día de corte y día de pago
  sólo aplican a 'credito'.
- Filtros: se recuerdan por ámbito en memoria mientras la app esté abierta (no se persisten; la paginación se reinicia al
  entrar); periodo por defecto "Mes"; "Personalizado" por defecto últimos 30 días; búsqueda local con `VF.util.normalizar`
  sobre descripción, contraparte, categoría, monto, fecha, cuenta origen/destino y "revisar". El filtro de cuenta usa
  `movimientosEn(... {cuentaId})` (incluye transferencias recibidas del mismo ámbito). Tabla: < 720 px una sola celda por
  fila (concepto, fecha · categoría · cuenta, monto; la fila abre el detalle con Editar / Eliminar / Marcar por revisar);
  ≥ 720 px columnas Fecha / Concepto / Categoría / Cuenta / Monto / acciones (revisar-confirmar, editar, eliminar; las dos
  últimas deshabilitadas si el movimiento está vinculado).
- Eventos: un oyente de `click` en `document` para `[data-accion^="ambito-"]` con `data-ambito` (+ `data-id`):
  `ambito-nuevo-movimiento` (`data-tipo`, `data-cuenta`), `ambito-nueva-cuenta`, `ambito-editar-cuenta`,
  `ambito-restaurar-cuenta`, `ambito-ver-cuenta` (filtra por cuenta; desde otra ruta navega con `?cuenta=`),
  `ambito-ver-movimiento`, `ambito-editar-movimiento`, `ambito-eliminar-movimiento`, `ambito-alternar-estado`,
  `ambito-mas-movimientos`, `ambito-quitar-filtro` (`data-filtro`), `ambito-limpiar-filtros`; `change`/`input` sobre
  `[data-filtro]` (búsqueda con debounce 250 ms); Enter/Espacio sobre `[role="button"][data-accion^="ambito-|empresa-|personal-"]`.
  personal.js: `[data-accion^="personal-"]` → `personal-nueva-meta`, `personal-editar-meta`. La vista se re-pinta completa
  con `VF.store.on('cambio')` (retardo 30 ms) sólo si su ruta sigue activa y su raíz sigue en el documento; `'bloqueado'`
  descarta la instancia. Al cruzar 720 px (`matchMedia`) se re-pinta la tabla con las columnas adecuadas.
- Extras de Empresa (`EXTRAS_EMPRESA`): `facturas` (`VF.calc.porCobrar`: por cobrar, vencido, top 3 clientes; enlaces
  `#/facturas`, `#/cobros`), `proveedores` (`VF.calc.porPagar`: por pagar, vencido, 3 CxP próximas; `#/proveedores`,
  `#/proveedores?pestana=cxp`), `comisiones` (`VF.calc.comisionesPendientes` + pagadas; `#/proveedores?pestana=comisiones`).
- Extras de Personal (`EXTRAS_PERSONAL`): `metas` (CRUD en modal: nombre, objetivo, cuenta personal no 'credito', fecha
  meta, notas; progreso con `VF.calc.metaProgreso` y `VF.ui.barraProgreso`; sin cuenta asignada muestra "Sin cuenta", nunca
  "$0.00"; `data-meta="<id>"` por elemento) y `deudas` (tarjetas de crédito personales activas: deuda = −`saldoCuenta`,
  límite, uso, corte, pago y próximo pago tomado de `VF.calc.vencimientos` con `origen.coleccion === 'cuentas'`; préstamos
  recibidos personales activos: `saldoPrestamo`, progreso, `proximoPagoPrestamo`, enlace `#/prestamos?id=`; "Deuda total
  personal"). Nunca lee registros de empresa.
- Área táctil: los dos módulos no usan `btn-chico` (36 px) en ninguna acción; el `summary` de cuentas archivadas mide 44 px.
  Los controles del núcleo por debajo de 44 px (`.segmento`, `.chip`, botón de `VF.ui.vacio`) están en "Pendientes".
- Pruebas E2E ejecutadas con Playwright + `tests/ayuda.js` (390×844 isMobile y 1280×800; claro, más una pasada en oscuro):
  separación de ámbitos contra `VF.store.estado()` (tarjetas, filas, selects), saldos y resumen = `VF.calc`, CRUD de
  cuentas (eliminar con movimientos impedido, archivar/restaurar), "+ Gasto"/"+ Ingreso"/"+ Transferencia" (cruzada:
  categoría, saldos de ambas cuentas, `utilidadMes` e ingresos/gastos de ambos ámbitos intactos, no aparece en el otro
  ámbito), validación en línea, filtros (periodo, tipo, cuenta, categoría, búsqueda, chips, paginación), detalle, editar,
  revisar/confirmar, eliminar con confirmación, vinculados sólo lectura, reactividad a 'cambio', metas (crear/editar/
  eliminar, progreso), deudas, `?cuenta=`, estados vacíos, sin scroll horizontal (vista y modales), botones ≥ 44 px.
  Capturas: `tests/capturas/empresa-*.png` y `personal-*.png`.
- **Pendientes detectados en núcleo/CSS** (resueltos en «Integración total»): `.segmento`, `.chip` y `.btn-chico` miden
  44 px con puntero grueso (se compactan sólo con `(hover: hover) and (pointer: fine)`), el botón de `VF.ui.vacio()` ya no
  usa `btn-chico` y el registro de callbacks de `VF.ui` se poda al re-registrar.

### Módulo Ajustes (js/modules/ajustes.js)

- Registro: `VF.router.registrar('ajustes', { titulo:'Ajustes', icono:'ajustes', nav:'mas', render })`. Dos columnas
  (`.rejilla-2` con columnas `.tarjeta-cuerpo`, misma solución que el panel): Preferencias · Cambiar contraseña · Servidor
  de IA | Respaldo · Datos de ejemplo · Zona de peligro · Acerca de. Toda cifra/texto de usuario pasa por `VF.util.esc`.
- **API pública `VF.ajustes`** (para otros módulos y pruebas):
  ```js
  render(contenedor, params)
  exportarRespaldo({ cifrado })          // → Promise<bool>. cifrado:true espera VF.store.guardar() y descarga la bóveda persistida como
                                         //   villeda-finanzas-respaldo-YYYY-MM-DD.vf.json; cifrado:false descarga el estado plano como
                                         //   villeda-finanzas-datos-YYYY-MM-DD.json (el botón pasa antes por un modal de advertencia).
  importarArchivo(file)                  // → Promise<bool>. Lee el File (file.text() o FileReader) y llama a abrirImportar.
  abrirImportar(texto, nombre, tamano)   // → Promise<bool>. Detecta formato (bóveda cifrada {salt,iv,datos} | estado plano), muestra resumen
                                         //   y modal de confirmación "Reemplazar e importar"; si está cifrado pide la contraseña del respaldo
                                         //   (vacía = la actual; CONTRASENA_REQUERIDA / CONTRASENA_INCORRECTA / DATOS_CORRUPTOS se muestran en el modal).
  borrarDatosEjemplo()                   // → Promise<bool>. VF.ui.confirmar + VF.store.borrarDatosEjemplo(); toast con el número eliminado.
  borrarTodo()                           // → Promise<bool>. VF.ui.confirmar + modal donde hay que escribir BORRAR + VF.store.borrarTodo().
  probarServidor(url, { timeoutMs })     // → Promise<{ ok, ms, texto? , error? }>, nunca rechaza. POST { pregunta:'ping', contexto:{} } con
                                         //   AbortController (10 s por defecto); valida http(s) y bloquea http desde una página https.
  aplicarTema(tema)                      // aplica y persiste ('auto'|'claro'|'oscuro').
  TIMEOUT_IA_MS                          // 10000
  ```
- Tema: el `<select>` lo aplica y guarda al instante con el mismo mecanismo que el botón de la cabecera:
  `VF.app.aplicarTema(tema)` + `VF.store.setAjustes({ tema })` + `localStorage['vf.tema']` (clave no sensible documentada
  en app.js; ajustes.js la escribe para que la pantalla de bloqueo use el mismo tema antes de desbloquear).
- Eventos: un oyente `click` en `document` para `[data-accion^="ajustes-"]` (`ajustes-exportar-cifrado`,
  `ajustes-exportar-plano`, `ajustes-elegir-archivo`, `ajustes-borrar-ejemplo`, `ajustes-borrar-todo`, `ajustes-probar-ia`);
  `submit` para los formularios dentro de `[data-ajustes-form="preferencias|contrasena|ia"]` (los botones Guardar son
  `type="submit"`); `change` para `[data-ajustes-archivo]` (input file oculto) y para el select de tema. Nada actúa con la
  bóveda bloqueada. `VF.store.on('cambio')` repinta `#ajustes-cuerpo` (30 ms) sólo si `VF.router.actual().ruta === 'ajustes'`;
  los guardados síncronos propios (`setAjustes`, el `guardar()` previo a exportar) se silencian con una bandera interna para
  no repintar en bucle ni perder lo que el usuario está escribiendo; importar y borrar ejemplo sí repintan (y muestran toast).
- Contraseñas: se leen sin `trim` (leerFormulario recorta los textos); los campos `tipo:'contrasena'` reciben el botón
  `.btn-ver[data-ver]` que ya gestiona app.js globalmente. El cambio exige nueva ≥ 8, confirmación igual y distinta de la actual.
- Borrar todo: `VF.store.borrarTodo()` emite 'bloqueado' y app.js (desde «Integración total») muestra la pantalla de
  bloqueo sin modo fijo: "Crear contraseña" si ya no existe bóveda, "Desbloquear" si existe. El auxiliar privado que
  ajustes.js usaba para corregirlo se retiró; también existe `VF.app.mostrarBloqueo(modo)`.
- La "Zona de peligro" usa `VF.ui.tarjeta({ clase: 'tarjeta-peligro' })` (borde `--negativo`, definido en css/app.css desde
  «Integración total») con `.aviso.aviso-error` dentro.
- Pruebas E2E (Playwright + `tests/ayuda.js`, 76 comprobaciones; capturas `tests/capturas/ajustes-*.png` en 390×844 y
  1280×800, claro y oscuro): guardar ajustes y persistencia tras recarga, tema inmediato sin repintado, escape de HTML en
  nombres, cambio de contraseña (errores en línea; la vieja deja de abrir), exportar cifrado y plano (descargas leídas y
  validadas), importar plano, cifrado con la clave actual y cifrado con una contraseña anterior (estado idéntico; errores de
  contraseña en el modal), borrar datos de ejemplo (0 ids `_demo`, banner oculto), servidor de IA (ok, no JSON, sin `texto`,
  URL inválida, inalcanzable, tiempo agotado, cuerpo del POST), borrar todo (pantalla "Crear contraseña", sin
  `vf.boveda.v1`). Notas para E2E: tras importar, el repintado por 'cambio' sustituye el `<input type=file>` → esperar
  ~150 ms antes de otro `setInputFiles`; un `fetch` a un servidor inalcanzable produce un `console.error` del navegador
  ("Failed to load resource: net::ERR_CONNECTION_REFUSED") que no es defecto del código: filtrarlo en las pruebas.

### Módulo Presupuestos (js/modules/presupuestos.js)

- Registro: `VF.router.registrar('presupuestos', { titulo:'Presupuestos', icono:'presupuestos', nav:'mas', render })`. Acepta
  `#/presupuestos?ambito=empresa|personal&periodo=YYYY-MM`. El ámbito se recuerda en `sessionStorage['vf.presupuestos.ambito']`
  (por pestaña, no sensible; por defecto 'empresa'); el mes vuelve al actual (`VF.calc.hoy()`) en cada entrada a la ruta. Al pintar
  y al cambiar de segmento llama a `VF.ui.ambitoActivo(ambito)`. No usa ninguna API del núcleo fuera del contrato.
- **API pública `VF.presupuestos`** (para el asistente y las pruebas):
  ```js
  render(contenedor, params)            // la misma función registrada en el router
  ambito()                              // 'empresa' | 'personal' visible
  periodo()                             // 'YYYY-MM' visible
  fijarAmbito(ambito)                   // cambia el segmento (aria-selected) y repinta
  fijarPeriodo('YYYY-MM')               // cambia el mes y repinta
  asignar(categoria, monto, { ambito?, periodo? }) // crea o actualiza el presupuesto de la categoría → bool. Si existieran
                                        //   registros duplicados de la misma categoría/mes conserva el primero y elimina el resto.
  copiarMesAnterior()                   // → Promise<número copiado>. Pide confirmación; NUNCA duplica categorías que ya existen
                                        //   en el mes visible; si el mes anterior no tiene presupuestos o no hay nada que copiar → toast.
  ```
- Cifras: todo sale de `VF.calc.presupuestoVsReal(estado, ambito, periodo)` (KPIs con `totalPresupuesto/totalReal/totalDiferencia`,
  filas y porcentajes). Las filas `sinPresupuesto` se separan en la tarjeta "Sin presupuesto" (botón "Asignar" → edición en línea).
  Tono de `VF.ui.barraProgreso`: `porcentaje > 100` → 'negativo', `> 90` → 'alerta', resto acento del ámbito; una categoría de tipo
  'ingreso' invierte la lectura (≥ 100 % = meta cumplida). Sin filas con presupuesto → estado vacío (`VF.ui.vacio` con "Copiar del mes
  anterior" si el mes anterior tiene presupuestos del MISMO ámbito; si no, "Agregar presupuesto" que enfoca el formulario de alta) +
  formulario de alta. Sin gasto en el mes → "Gasto real" y "Diferencia" muestran "—" y la fila "Sin gasto" (nunca ceros falsos).
- Alta en línea: `form[data-ppto-alta]` (select con las categorías de gasto del ámbito que aún no tienen presupuesto en el mes +
  monto; Enter o botón "Agregar"). Edición en línea por fila (`input[data-ppto-monto]`: Enter guarda, Esc cancela; botones
  Guardar/Cancelar). Eliminar con `VF.ui.confirmar`. Un solo oyente de `click` en `document` para `[data-accion^="ppto-"]`
  (`ppto-mes-anterior`, `ppto-mes-siguiente`, `ppto-mes-actual`, `ppto-copiar`, `ppto-editar`, `ppto-asignar`, `ppto-guardar`,
  `ppto-cancelar`, `ppto-eliminar`) más `submit` y `keydown` delegados; no actúa con la bóveda bloqueada. `VF.store.on('cambio')`
  repinta sólo `#ppto-cuerpo` (retardo de 30 ms) y únicamente si `VF.router.actual().ruta === 'presupuestos'`; conserva la edición en
  curso y devuelve el foco al control equivalente (teclado).
- Estilos: el módulo no añade CSS; los ajustes de layout (ancho del input dentro de la celda, acciones alineadas a la derecha,
  ancho mínimo del nombre del mes, `flex-wrap` del `.lista-item` en edición) van como atributos `style` sobre clases existentes.
  **Resuelto en «Integración total»**: css/app.css define `.celda-acciones` y `.lista-item.envolver`, y el módulo las usa
  (quedan en línea sólo `margin-left:auto`, `flex:none` y anchos de inputs).
- Pruebas E2E (Playwright + `tests/ayuda.js`; capturas `tests/capturas/presupuestos-*.png` en 390×844 y 1280×800, claro y oscuro):
  KPIs, filas, totales, tonos/aria-valuenow de las barras y "Sin presupuesto" iguales a `VF.calc.presupuestoVsReal` en ambos ámbitos y
  tres meses; alta válida/inválida; edición (Enter, Esc, inválida); eliminación con confirmación; asignar desde "Sin presupuesto";
  mes siguiente vacío → copiar (completa, repetida sin duplicar, parcial tras borrar una); mes anterior / "Mes actual"; cambio de ámbito
  sin categorías del otro ámbito; `?ambito=&periodo=`; reactividad a 'cambio' dentro y fuera de la ruta; bóveda sin ejemplo; sin scroll
  horizontal en 390 px. Mientras otro módulo de `js/modules/` esté a medio escribir (no pasa `node --check`), el navegador reporta un `pageerror` de sintaxis
  ajeno a este módulo (la prueba lo identifica con `node --check` y lo descuenta de forma explícita).

### Módulo Préstamos (js/modules/prestamos.js)

- Registro: `VF.router.registrar('prestamos', { titulo:'Préstamos', icono:'prestamos', nav:'mas', render })`. Acepta
  `#/prestamos?ambito=empresa|personal` (fija el segmento) y `#/prestamos?id=<prestamoId>` (abre el detalle y cambia al ámbito
  del préstamo; es el parámetro que envían el Panel y Personal → Deudas). Tras abrir, el parámetro se limpia del hash con
  `history.replaceState` para que recargar no reabra el modal. El segmento se recuerda en `sessionStorage['vf.prestamos.ambito']`
  (por defecto 'empresa'). Al pintar y al cambiar de segmento llama a `VF.ui.ambitoActivo(ambito)`.
- **API pública `VF.prestamos`** (los modales devuelven la api `{ cerrar, elemento }`):
  ```js
  render(contenedor, params)                 // la misma función registrada en el router
  ambito() / fijarAmbito(ambito)             // segmento activo / cambiarlo (aria-selected) y repintar
  nuevo({ ambito?, tipo?, id? })             // modal de alta (pago mensual e intereses totales en vivo); con `id` edita
  ver(id)                                    // modal de detalle (saldo, progreso, pagos registrados, tabla de amortización)
  pagar(id)                                  // modal "Registrar pago" (recibido) / "Registrar cobro" (otorgado)
  registrarPago(id, { monto, fecha, cuentaId })  // → { pago, movimiento, liquidado }. Lanza Error('PRESTAMO_NO_EXISTE' |
                                             //   'PRESTAMO_NO_ACTIVO' | 'CUENTA_INVALIDA' | 'CUENTA_DE_OTRO_AMBITO' |
                                             //   'MONTO_INVALIDO' | 'MONTO_EXCEDE_SALDO' | 'FECHA_INVALIDA')
  eliminarPago(id, pagoId)                   // → bool. Elimina también el movimiento vinculado; 'liquidado' → 'activo' si vuelve a haber saldo
  dividirPago(prestamo, monto)               // puro → { pago, interes, capital, interesPeriodo, saldoAntes, saldoDespues, liquida, cubreInteres, maximo }
  ```
- Reglas de pago (sobre el saldo REAL `VF.calc.saldoPrestamo`): interés = round2(saldo × tasaAnual/100/12); capital = pago − interés;
  si capital ≥ saldo (liquida) → capital = saldo e interés = pago − capital (nunca negativo); si el pago no cubre el interés del
  periodo → capital 0 e interés = pago (se avisa en el formulario). Monto máximo aceptado = saldo + interés del periodo (`maximo`).
  Monto por defecto = `VF.calc.proximoPagoPrestamo().monto`, que coincide con `pagoMensual()` salvo en el último pago (liquida).
  Movimiento creado: `{ ambito: prestamo.ambito, cuentaId, tipo:'gasto'|'ingreso', categoria:'Préstamos'|'Otros ingresos',
  descripcion:'Pago|Cobro de préstamo — pago n de N · contraparte', contraparte, prestamoId, estado:'confirmado', etiquetas:[] }`.
  Sólo se admiten cuentas activas del MISMO ámbito (el selector no ofrece otras y `registrarPago` lo verifica). El préstamo pasa
  a 'liquidado' automáticamente cuando `saldoPrestamo ≤ 0` (también al editar el principal); si falla `actualizar` tras crear el
  movimiento, el movimiento se revierte.
- Esquema: cada elemento de `prestamos[].pagos[]` lleva además `cuentaId` (la cuenta usada), redundante con el movimiento pero
  útil si éste se elimina desde otra vista (el detalle lo marca "Sin movimiento"). `diaPago` vacío en el formulario se rellena con
  el día de `fechaInicio` (misma regla que `VF.calc`). Con pagos registrados no se permite cambiar ámbito ni tipo (los pagos ya
  generaron movimientos) ni reducir el principal por debajo del capital ya pagado. Eliminar un préstamo usa `VF.store.eliminar`
  (que borra sus movimientos vinculados) tras confirmación con el número de movimientos afectados.
- Detalle: tabla de `VF.calc.tablaAmortizacion` marcando las primeras `pagos.length` filas como "Pagado", la siguiente como
  "Próximo" o "Vencido" (fecha < hoy) y el resto "Pendiente". Para caber en el modal (560 px) sin desplazamiento horizontal, la
  amortización usa 5 columnas (estado bajo la fecha; capital / interés en una celda) y la tabla de pagos 4 columnas (n.º + fecha +
  cuenta, monto, capital / interés, eliminar). El detalle abierto se refresca en sitio al recibir 'cambio' (conserva abierta la
  tabla de amortización) y se cierra si el préstamo desaparece.
- Cifras: KPIs Debo / Me deben / Mensualidad (debo) / Próximo vencimiento sólo con préstamos activos del ámbito; '—' cuando no hay
  préstamos del tipo (nunca ceros falsos); sin préstamos en el ámbito → `VF.ui.vacio(..., 'Registrar préstamo')`. Lista "Activos"
  ordenada por próximo pago y tarjeta aparte "Liquidados y cancelados". Etiquetas de tipo: "Debo" (recibido, saldo en rojo) y
  "Me deben" (otorgado, saldo en verde).
- Eventos: un oyente de `click` en `document` para `[data-accion^="prestamos-"]` (`prestamos-nuevo`, `prestamos-ver`,
  `prestamos-pagar`, `prestamos-editar`, `prestamos-eliminar`, `prestamos-eliminar-pago` con `data-pago`); no actúa con la bóveda
  bloqueada. `VF.store.on('cambio')` re-pinta `#prestamos-cuerpo` y el detalle (30 ms) sólo si `VF.router.actual().ruta === 'prestamos'`.
- Pruebas E2E (Playwright + `tests/ayuda.js`, script temporal borrado al terminar; capturas `tests/capturas/prestamos-*.png` en
  390×844 claro y 1280×800 oscuro): KPIs = VF.calc, Debo / Me deben, segmento + sessionStorage + `ambitoActivo`, alta por la interfaz
  con pago mensual en vivo = fórmula independiente en Node (P·r/(1−(1+r)^−n) y P/n con tasa 0), escape de la contraparte, detalle con
  24/48 filas de amortización y marcas Próximo/Pagado, registrar pago (monto por defecto, sólo cuentas del ámbito, desglose en vivo,
  capital/interés/saldo, movimiento gasto 'Préstamos' con prestamoId y saldo de la cuenta), eliminar pago revierte el movimiento,
  tasa 0 otorgado → ingreso 'Otros ingresos', cuenta de otro ámbito y sobrepago rechazados, liquidación automática y vuelta a 'activo',
  `?id=` y `?ambito=`, reactividad a 'cambio', edición (estado cancelado) y eliminación, estado vacío, validación de plazo, sin scroll
  horizontal en página ni en las tablas del modal. Mientras otros `js/modules/*.js` no pasen `node --check` (archivos ajenos a medio
  escribir), la prueba los sirve vacíos vía `page.route` para que su `pageerror` no se atribuya a este módulo.

### Módulo Reportes (js/modules/reportes.js)

- Registro: `VF.router.registrar('reportes', { titulo:'Reportes', icono:'reportes', nav:'mas', render })`. Acepta
  `#/reportes?ambito=empresa|personal&rango=mes|mes-anterior|trimestre|anio|personalizado&desde=YYYY-MM-DD&hasta=YYYY-MM-DD`.
  Ámbito y rango se recuerdan en `sessionStorage['vf.reportes']` (JSON, no sensible; por defecto empresa / mes). Al pintar y al
  cambiar de segmento llama a `VF.ui.ambitoActivo(ambito)`. No existe "Combinado": los reportes nunca mezclan ámbitos.
- Controles: segmentado Empresa | Personal; el rango es un `<select>` (cinco opciones no caben como segmentado en 390 px sin
  scroll oculto) más dos `<input type="date">` visibles sólo en personalizado (fechas invertidas se normalizan; vacías → últimos
  30 días). El subtítulo bajo el `<h1>` siempre dice ámbito y periodo (visible también al imprimir).
- **API pública `VF.reportes`** (para pruebas y otros módulos):
  ```js
  render(contenedor, params)
  ambito() / fijarAmbito(ambito)              // 'empresa' | 'personal' (cambia el segmento y repinta)
  rango() / fijarRango(tipo, desde?, hasta?)  // → { tipo, desde, hasta, etiqueta, sufijo }
  calcularRango(tipo, desde?, hasta?)         // puro. sufijo para archivos: '2026-10', '2026-09', '2026-T4', '2026', '2026-09-26_2026-10-26'
  estadoResultados(estado, desde, hasta)      // SOLO empresa: { ingresos:[ingresosPorCategoria], gastos:[gastosPorCategoria], totalIngresos, totalGastos, utilidad, margen|null }
  resumenIVA(estado, desde, hasta)            // SOLO empresa, estimado: { trasladado, facturas, subtotalFacturado, acreditable, gastosConIVA, baseGastos, neto, categorias, estimado:true }
  serieFlujo(estado, ambito, desde, hasta)    // { serie:[...serieMensual], extendida, desdePeriodo, hastaPeriodo }
  csvMovimientos() / csvFacturas() / csvCxP() // descargan el CSV del ámbito y rango actuales → { nombre, filas } (filas 0 = no se descargó)
  paquete()                                   // CSV disponibles + resumen.txt, 450 ms entre descargas → bool
  imprimir()                                  // abre los <details> y llama a window.print()
  CATEGORIAS_IVA                              // copia de la lista de categorías con IVA
  ```
- Cálculos propios (sobre VF.calc; no tocan el store): IVA trasladado = Σ `iva` de facturas con `fechaEmision` en el rango cuyo
  estado almacenado no sea cancelada ni borrador (incluye las derivadas emitida/pagada/parcial/vencida); acreditable =
  round2(Σ gastos de empresa en Proveedores, Materiales, Servicios (luz, agua, internet), Software, Honorarios, Publicidad × 16/116),
  aceptando también 'Servicios' por si se renombró la categoría; neto = trasladado − acreditable (≥ 0 "a cargo", < 0 "a favor");
  siempre marcado "Estimado". Margen del rango = utilidad / ingresos × 100 (`utilidadMes` sólo cubre un mes). Flujo mensual:
  `serieMensual` con n = meses del rango hasta el mes actual, mínimo 6 (se completa hacia atrás como contexto y la tarjeta lo
  avisa); nunca pinta meses futuros con ceros. Antigüedad CxC y por pagar son "al día de hoy" (independientes del rango) y la
  tarjeta lo indica. Sin movimientos ni facturas/gastos con IVA en el rango → KPIs con "—" y `VF.ui.vacio('Sin movimientos…')`.
- CSV (`VF.util.csv` + `VF.util.descargar`, mime `text/csv;charset=utf-8`): nombres `villeda-<ambito>-<movimientos|facturas|cxp>-<sufijo>.csv`
  y `villeda-<ambito>-resumen-<sufijo>.txt`. Movimientos: fecha, tipo, cuenta (transferencias: "Origen → Destino"), categoría,
  descripción, contraparte, monto, estado; orden cronológico ascendente. Los montos se pasan como texto con dos decimales
  (`toFixed(2)`) porque `csv()` escribe los números tal cual (41200 en vez de 41200.00). Facturas: por `fechaEmision` en el rango,
  todos los estados (columna `estado` derivada con `estadoFactura`). CxP: por `fecha` en el rango (`estadoCxP`). En Personal sólo
  existe el CSV de movimientos (facturas y CxP son colecciones de empresa); el paquete personal trae 2 archivos y el de empresa 4.
  Sin registros → toast de aviso y no se descarga nada (en el paquete se omite ese archivo y resumen.txt lo indica).
- Impresión: aprovecha `@media print` de css/app.css (oculta cabecera, navegación, botones, `.segmentos`, `.filtros`,
  `.vista-acciones`, `.no-imprimir`; la tarjeta "Exportar y compartir" lleva `no-imprimir`). El módulo añade un bloque
  `.solo-imprimir` (empresa, ámbito, periodo, fecha de generación, moneda) y abre los `<details>` en `beforeprint`
  (un `<details>` cerrado no se imprime aunque el CSS marque su tabla `display:table`), cerrando en `afterprint` sólo los que abrió.
  La tabla completa de categorías reutiliza `<details class="grafica-tabla">`.
- Eventos: un oyente de `click` en `document` para `button[data-accion^="reportes-"]` (`reportes-csv-movimientos`,
  `reportes-csv-facturas`, `reportes-csv-cxp`, `reportes-paquete`, `reportes-imprimir`) y uno de `change` para
  `reportes-rango` / `reportes-fecha`; nada actúa con la bóveda bloqueada. `VF.store.on('cambio')` repinta `#reportes-cuerpo`
  (retardo 30 ms) sólo si `VF.router.actual().ruta === 'reportes'`.
- Layout: en empresa, "Gastos por categoría" y "Resumen de IVA" van a ancho completo porque en media columna de `.rejilla-2` la
  leyenda de `graficaDona` partía palabras ("Proveedo / res"). Desde «Integración total» `.leyenda-etq` usa
  `overflow-wrap: break-word; hyphens: manual` (sólo parte una palabra si ella sola no cabe); la dona sigue a ancho completo
  en empresa (volver a media columna es opcional).
- Pruebas E2E ejecutadas con Playwright y `tests/ayuda.js` (script temporal borrado; capturas `tests/capturas/reportes-*.png` en
  390×844 y 1280×800, claro, oscuro y vista de impresión): KPIs, estado de resultados, flujo, categorías, antigüedad e IVA = VF.calc
  evaluado en la página; los tres CSV leídos del disco (BOM UTF-8, encabezados, 2 decimales, sólo registros del ámbito y rango,
  comillas `""` escapadas, orden); paquete (4 archivos en empresa, 2 en personal, resumen.txt con totales); rangos mes, mes
  anterior, trimestre, año, personalizado e invertido; `emulateMedia('print')` sin navegación; reactividad dentro y fuera de la
  ruta; `sessionStorage` y `?ambito=&rango=`; estado vacío (sin descarga, toast); `file://`; sin scroll horizontal en móvil.

### Módulo Asistente (js/modules/asistente.js)

- Registro: `VF.router.registrar('asistente', { titulo:'Asistente', icono:'asistente', nav:'principal', render })`. Acepta
  `#/asistente?pregunta=<texto>` (la responde al entrar y limpia el hash con `history.replaceState` para no repetirla al
  re-renderizar). El historial vive en memoria de la sesión y se borra en `VF.store 'bloqueado'`.
- **API pública `VF.asistente`** (el motor sólo depende de `VF.util` y `VF.calc`, por eso corre en Node sin DOM):
  ```js
  responder(pregunta, estado)   // → { texto, html, intent, ambito:'empresa'|'personal'|null, periodo, enlaces:[{texto, ruta}], pregunta }
                                //   `periodo` = { clave, etiqueta, desde, hasta, futuro, dias, periodo:'YYYY-MM', esMes } | null
                                //   `ruta` va sin '#/' y puede llevar query ('proveedores?pestana=cxp', 'empresa?cuenta=<id>').
  intenciones()                 // → [{ id, descripcion, ejemplo }] (17: las 16 del contrato + 'desconocido')
  responderRemoto(pregunta, estado) // → Promise<{ texto, remoto:true }>; POST JSON { pregunta, contexto: VF.calc.resumenParaIA(estado) }
                                //   a ajustes.asistenteEndpoint; rechaza con Error('SIN_ENDPOINT'|'TIEMPO_AGOTADO'|'HTTP_<n>'|'RESPUESTA_INVALIDA')
  detectar(pregunta, estado)    // → { normalizada, ambito, periodo, intent } (para pruebas)
  preguntas()                   // → las 9 preguntas sugeridas (chips)
  preguntar(texto)              // vista: procesa una pregunta (remoto con respaldo local) y pinta la respuesta; → Promise<respuesta>
  historial() / limpiar() / render(contenedor, params)
  ```
- Detección (sobre `VF.util.normalizar` sin signos): ámbito por palabras (`villeda|empresa|negocio|despacho|compania|firma|
  oficina` → empresa; `personal(es|mente)|yo|mio|mia|propio|familia|casa|hogar|bolsillo` → personal; sin pista o con ambas →
  `null` = se responde cada ámbito por separado). `mi`/`mis`/`me`/`tengo` NO son pista de ámbito ("mis cuentas"). Periodos:
  hoy, ayer, mañana, pasado mañana, esta/próxima/pasada semana, este/próximo/pasado mes, mes nombrado (con o sin año),
  este/pasado año, "próximos/en/dentro de/a N días|semanas", "últimos N días", quincena; N en cifra o en palabra
  (`siete`, `quince`, `treinta`…). Orden de intenciones: ayuda → saldo_cuenta → disponible_personal → revisar → presupuesto →
  flujo → utilidad → comisiones → metas → prestamos → por_cobrar → por_pagar (ambas sólo sin periodo futuro) → vencimientos
  (palabras clave o periodo futuro + pago/cobro; filtra tipo si sólo se menciona uno) → gastos_periodo → ingresos_periodo →
  disponible_total → desconocido.
- `saldo_cuenta`: una cuenta se reconoce por nombre completo, por el "núcleo" del nombre (tokens no genéricos: "Nu Empresa"
  → `nu`) o por `banco`. Un nombre completo con más tokens que el núcleo de otra la descarta ("nu empresa" ≠ "Nu Cuenta");
  una mención ambigua ("mercado pago", "nu") devuelve todas las coincidencias agrupadas por ámbito, sin sumar. `tarjeta`
  sin nombre → todas las tarjetas de crédito. Para tarjetas muestra deuda y crédito disponible (`limiteCredito − deuda`).
- Reglas de cifras: todo sale de `VF.calc`; sin datos → "Sin cuentas…" / "Sin movimientos…" sin ceros. Cuando el periodo
  pedido no tiene movimientos (p. ej. "esta semana" en lunes, "hoy"), la tarjeta lo dice y añade una **referencia
  etiquetada** (últimos 7 días → últimos 30 días; para "este mes", el mes pasado) para no dejar al usuario sin cifra.
  `utilidad` con ámbito personal responde el balance personal y aclara que la utilidad es de empresa; `comisiones`, `por_pagar`
  (CxP) y `por_cobrar` (facturas) son de empresa; con ámbito personal responden deudas personales (tarjetas + préstamos
  recibidos) o préstamos otorgados. `disponible_total` es la única respuesta que muestra el combinado informativo
  (`VF.calc.combinado().combinadoInformativo`) además de los dos ámbitos. `disponible_personal` = `disponiblePersonal(estado,
  N)` (N = días del periodo futuro mencionado o 30) y muestra como contexto `disponibleEmpresa()`. `vencimientos` sin periodo
  = próximos 7 días; si el rango empieza hoy o después añade los atrasados pendientes (por ámbito y tipo) y, si no hay nada
  en el rango, "lo más próximo".
- Vista: `#asistente-chat` (`role="log" aria-live="polite"`), `#asistente-chips` (9 chips `data-accion="asistente-chip"
  data-pregunta`), `#asistente-form` / `#asistente-entrada` (Enter envía; se procesa con un oyente `submit` delegado en
  `document`), acciones `asistente-limpiar` y `asistente-ayuda`. Cada respuesta es `<article class="burbuja
  burbuja-asistente" data-intent data-ambito>` con el `html` del motor, los enlaces ("Ver detalle · …" el primero, con
  `href="#/<ruta>"`) y una línea de meta (Motor local / Servidor de IA, ámbito, periodo, nota de respaldo). Con endpoint
  configurado se muestra una burbuja "Consultando al servidor de IA…" (`aria-busy`) y, si falla, la respuesta local con la
  nota "El servidor de IA no está disponible / no respondió en 15 s / devolvió error N". Al recibir `'cambio'` repinta la vista
  sólo si la ruta activa es `asistente`, conservando historial y el borrador del campo.
- Rutas que el asistente ENVÍA (los módulos destino deberían honrarlas): `cobros`, `proveedores?pestana=cxp|comisiones`,
  `prestamos`, `reportes`, `panel?ambito=…`, `empresa?cuenta=<id>` / `personal?cuenta=<id>` y
  `presupuestos?ambito=<ambito>&periodo=YYYY-MM` (parámetros nuevos; presupuestos.js debería preseleccionar ámbito y mes).
- **Estilos**: las clases `asistente-*` (barra de entrada pegajosa sobre la barra inferior, tabla compacta, lista de
  respuesta, chips en fila desplazable en móvil y envueltos en escritorio) viven en css/app.css desde «Integración total»,
  que fija `--vf-asistente-css: 1` en `:root`. El módulo conserva una copia y sólo la inyecta como `<style
  id="asistente-estilos">` si esa variable no existe (hoja de estilos antigua en caché).
- Pruebas: motor en Node con el seed (≥55 formulaciones con/sin acentos, mayúsculas y coloquiales; cifras de las 5 preguntas
  del brief contra `VF.calc`; separación de ámbitos; escape de nombres; estado vacío) y E2E con Playwright (chips, Enter,
  `?pregunta=`, `'cambio'`, endpoint caído → respaldo local, bloqueo borra historial, `file://`, 390×844 y 1280×800, claro y
  oscuro, sin scroll horizontal). Capturas `tests/capturas/asistente-*.png`. Nota: en lunes "esta semana" no tiene
  movimientos en el seed; la respuesta añade la referencia de los últimos 7 días, que es la cifra que verifica la prueba.

### Módulo Proveedores (js/modules/proveedores.js)

- Registro: `VF.router.registrar('proveedores', { titulo:'Proveedores', icono:'proveedores', nav:'mas', render })`. Pestañas
  Proveedores | Cuentas por pagar | Comisiones; la activa se recuerda en `sessionStorage['vf.proveedores.pestana']`
  (valores `proveedores` | `cxp` | `comisiones`, por defecto `proveedores`). Honra `#/proveedores?pestana=…&id=…` como lo
  envía el Panel: fija la pestaña y abre el detalle del registro (CxP, comisión o proveedor); después limpia el hash a
  `#/proveedores` con `history.replaceState` para que un re-render no vuelva a abrir el modal. En < 720 px la pestaña
  "Cuentas por pagar" muestra la etiqueta corta "Por pagar" (`.oculto-movil` / `.oculto-escritorio`) para caber en 390 px.
- **API pública `VF.proveedores`** (los modales devuelven la api `{ cerrar, elemento }` de `VF.ui.modal`):
  ```js
  render(contenedor, params)
  pestana()                                   // pestaña activa
  fijarPestana('proveedores'|'cxp'|'comisiones')
  nuevoProveedor({ id?, alGuardar? })         // alta; con id edita. alGuardar(proveedor) sólo tras un alta
  verProveedor(id)                            // detalle con sus CxP, Editar / Eliminar / Nueva CxP
  nuevaCxP({ id?, proveedorId? })             // alta (sin proveedores → abre primero el alta de proveedor); con id edita
  verCxP(id)                                  // detalle: pagos, Registrar pago, Editar, Eliminar, eliminar pago
  pagarCxP(id)                                // modal "Registrar pago"
  registrarPagoCxP(id, { monto, fecha, cuentaId }) // sin modal; → bool. Crea el movimiento y guarda el pago
  nuevaComision({ id?, facturaId? })          // alta (base = subtotal de la factura elegida o manual); con id edita (sólo pendientes)
  verComision(id)                             // detalle: Pagar / Editar (pendiente) o Revertir pago (pagada), Eliminar
  pagarComision(id)                           // modal "Pagar comisión"
  ```
- Pagos de CxP: `VF.store.agregar('movimientos', { ambito:'empresa', cuentaId, tipo:'gasto', categoria:'Proveedores',
  descripcion:'Pago a proveedor — <concepto>', contraparte:<proveedor>, cxpId })` y después `actualizar('cuentasPorPagar',
  id, { pagos })` con el pago `{ id: uid('pago'), fecha, monto, cuentaId, movimientoId }`. El monto se valida ≤ pendiente
  (`VF.calc.pendienteCxP`) tanto en el formulario (`max`) como en `registrarPagoCxP`. Eliminar un pago elimina su
  movimiento y lo quita de `pagos`; eliminar la CxP deja que el store borre los movimientos con `cxpId`. Sólo se ofrecen
  cuentas de EMPRESA activas (con su saldo `VF.calc.saldoCuenta` en el texto de la opción).
- Comisiones: `monto = round2(base × porcentaje / 100)` calculado en vivo en el formulario; al elegir factura la base toma
  `factura.subtotal`. "Pagar" crea el movimiento gasto `Comisiones` (`comisionId`, contraparte = beneficiario) y marca
  `{ estado:'pagada', movimientoId }`; "Revertir pago" elimina el movimiento y vuelve a `pendiente`. Una comisión pagada
  no se edita (hay que revertir el pago). Las facturas canceladas no se ofrecen como base.
- Integridad: antes de eliminar un proveedor el módulo cuenta sus CxP y avisa con toast; si aun así el store lanza
  `PROVEEDOR_CON_CXP` (u otro código), `mensajeError()` lo traduce a un texto amable.
- Filtros CxP (todas / pendientes / vencidas / pagadas; por defecto pendientes) y "Agrupar por proveedor" se conservan
  mientras la app esté abierta (variables del módulo, no persistidas). "Vencidas" usa el criterio de
  `VF.calc.porPagar().cuentas[].vencida` (vencimiento < hoy y pendiente > 0), por lo que incluye parciales vencidas.
  Los segmentos de filtro son markup propio (`.segmentos` + `data-accion`), no `VF.ui.segmentos`, para no acumular
  callbacks en el registro de VF.ui en cada re-render.
- Cifras: `VF.calc.porPagar`, `pendienteCxP`, `estadoCxP`, `comisionesPendientes`, `saldoCuenta`. El KPI "Pagadas" de
  comisiones suma `monto` de los registros con `estado:'pagada'` (`VF.util.suma`, dato real, no estimación).
- Eventos: un oyente de `click` en `document` para `[data-accion^="prov-"]`, uno de `input` para `[data-prov-busqueda]`
  (re-pinta sólo la tabla, sin perder el foco) y flechas ←/→ entre pestañas. Las acciones lanzadas desde un modal cierran
  los modales y abren el siguiente tras 60 ms (patrón del panel). `VF.store.on('cambio')` re-pinta `#prov-cuerpo` (30 ms)
  sólo si `VF.router.actual().ruta === 'proveedores'`. "Ver movimiento" delega en `VF.panel.verMovimiento`.
- Layout: las celdas con dos líneas (fecha + relativa, nombre + RFC, concepto + "Registrada…") van envueltas en un solo
  `<span>` porque en < 720 px `td` es `display:flex` y separaría las líneas en columnas. La columna "Acciones" usa
  `style="flex-wrap:nowrap"` en línea (no hay utilidad CSS para ello).
- Pruebas E2E (Playwright + `tests/ayuda.js`, `reducedMotion: 'reduce'`): crear proveedor (con `<` y `&` escapados),
  búsqueda, integridad PROVEEDOR_CON_CXP, KPIs = `VF.calc.porPagar`, filtros y agrupación, crear CxP, pago parcial y
  total (movimiento con cxpId/categoría/ámbito, saldo de cuenta, estado derivado), verificación en #/empresa, eliminar
  pago revierte saldo, eliminar CxP borra movimientos, comisión sobre factura (base = subtotal, monto en vivo), pagar y
  revertir, `?pestana=&id=`, reactividad dentro/fuera de la ruta, estados vacíos, modo oscuro. Capturas
  `tests/capturas/proveedores-*.png` en 390×844 y 1280×800.

### Módulo Facturas y cobros (js/modules/facturas.js)

- Registro: `VF.router.registrar('facturas', { titulo:'Facturas y cobros', icono:'facturas', nav:'mas', render })` y
  `VF.router.registrar('cobros', { titulo:'Cobros', icono:'cobros', nav:false, render })` (misma función `render`; la ruta
  activa decide el modo). Al pintar llama a `VF.ui.ambitoActivo('empresa')`. Parámetros honrados: `#/facturas?id=<facturaId>`
  (abre el detalle en modal), `#/facturas?pestana=clientes`, `#/facturas?filtro=todas|pendientes|vencidas|pagadas|borrador`,
  `#/cobros?cliente=<clienteId>` (filtra el agrupado a ese cliente). `#/cobros` = la misma vista con filtro "pendientes",
  "Agrupar por cliente" activado (grupos y totales de `VF.calc.porCobrar().porCliente`), sin pestaña Clientes y con h1
  "Cuentas por cobrar".
- **API pública `VF.facturas`** (todos los modales devuelven la api `{ cerrar, elemento }` de `VF.ui.modal`):
  ```js
  render(contenedor, params)
  nuevaFactura({ clienteId?, id? })        // modal alta (con `id` edita; una factura cancelada no se edita)
  verFactura(facturaId)                    // modal de detalle (importes, barra de cobro, historial de pagos, acciones)
  nuevoCliente(clienteId?)                 // modal alta/edición de cliente
  verCliente(clienteId)                    // modal de detalle con sus facturas (tabla compacta)
  registrarPago(facturaId)                 // modal "Registrar pago" (monto ≤ pendiente, fecha, cuenta EMPRESA activa)
  agregarPago(facturaId, { monto, fecha, cuentaId })  // SIN modal → pago. Crea el movimiento ingreso 'Ventas' (ambito
                                           //   'empresa', facturaId, contraparte = nombre del cliente, descripcion 'Pago de
                                           //   factura <folio> — <concepto>') y guarda { id:'pago_…', fecha, monto, cuentaId,
                                           //   movimientoId } en factura.pagos. Lanza Error('FACTURA_INEXISTENTE' |
                                           //   'FACTURA_NO_COBRABLE' | 'MONTO_INVALIDO' | 'MONTO_MAYOR_AL_PENDIENTE' |
                                           //   'CUENTA_EMPRESA_REQUERIDA' | 'BLOQUEADO').
  quitarPago(facturaId, pagoId)            // SIN modal → true. Elimina el movimiento vinculado (revierte el saldo) y el pago.
  siguienteFolio()                         // 'F-0009': siguiente al mayor folio con forma F-#### (F-0001 si no hay)
  calcularImportes(subtotal, sinIva)       // { subtotal, iva (round2(subtotal*0.16) o 0), total } con round2
  ```
- Modelo: no se añadió ningún campo; "sin IVA" se guarda como `iva: 0` (al editar se infiere `sinIva = !(iva > 0)`). Estado
  almacenado `borrador | emitida | cancelada`; acciones del detalle: Emitir (borrador→emitida), Cancelar factura (sólo
  emitida SIN pagos; con pagos pide eliminarlos primero), Reactivar (cancelada→emitida), Eliminar (el store borra los
  movimientos vinculados; la confirmación lo avisa). Validaciones: folio único (sin distinguir mayúsculas), vencimiento ≥
  emisión, subtotal > 0, al editar con pagos el nuevo total no puede ser menor a lo pagado ni volver a borrador; RFC opcional
  con forma 12/13 caracteres. Eliminar cliente: se intenta `VF.store.eliminar('clientes', id)` y `CLIENTE_CON_FACTURAS` se
  traduce a un toast amable (6 s); los demás códigos del store también se traducen (`mensajeError`).
- Cifras: KPIs Por cobrar / Vencido (`porCobrar`), Cobrado este mes (suma de `movimientosEn(est,'empresa',mes,{tipo:'ingreso'})`
  con `facturaId`), Clientes; tarjeta "Antigüedad de saldos" = `antiguedadCxC` con barras (`VF.ui.barraProgreso`; 0-30 incluye
  lo vigente, 31-90 tono alerta, 90+ negativo). Sin facturas → "Sin pendientes" / "Sin vencidos" / "Sin cobros" (nunca $0.00);
  sin facturas ni clientes → `VF.ui.vacio(..., 'Nuevo cliente')`. Estados derivados con `VF.calc.estadoFactura`: borrador
  (badge neutro), emitida (info), parcial (alerta, "Pago parcial"), vencida (negativo), pagada (positivo), cancelada (neutro).
- Eventos: un oyente de `click` en `document` para `[data-accion^="fac-"]` (`fac-nueva-factura[data-cliente]`,
  `fac-nuevo-cliente`, `fac-ver-factura`, `fac-editar-factura`, `fac-eliminar-factura`, `fac-emitir-factura`,
  `fac-cancelar-factura`, `fac-reactivar-factura`, `fac-registrar-pago`, `fac-eliminar-pago[data-pago]`,
  `fac-ver-movimiento` (delega en `VF.panel.verMovimiento`), `fac-ver-cliente`, `fac-editar-cliente`, `fac-eliminar-cliente`,
  `fac-pestana[data-valor]`, `fac-agrupar`, `fac-limpiar-filtros`); `change`/`input` en `#fac-cuerpo [data-filtro]`
  (cliente, búsqueda con debounce 180 ms). Los filtros sólo repintan `#fac-lista`; `VF.store.on('cambio')` (30 ms) refresca
  el cuerpo de los modales de detalle abiertos (factura y cliente) y repinta `#fac-cuerpo` sólo si la ruta activa es
  `facturas` o `cobros`. Al tocar una factura desde el modal de un cliente (o viceversa) se cierran los modales y se abre
  el nuevo; "Registrar pago" y "Editar" se apilan sobre el detalle, que se refresca al guardar.
- Layout (sin tocar css/app.css): en móvil `VF.ui.tabla` vuelve cada `<td>` un contenedor flex, y sus hijos directos
  (`strong`, `<br>`, `small`, `span.truncar`) se convierten en flex items separados: el folio se parte en "F-"/"0008", el
  concepto queda como columna y `span.truncar` se vuelve bloque con elipsis. El módulo envuelve toda celda multilínea en un
  `<div>` (auxiliar `celda`) y los botones de icono de acciones en `<span></span><span class="truncar">…</span>` (auxiliar
  `celdaAcciones`: el span vacío los empuja a la derecha con `justify-content: space-between`). Las tablas dentro de un modal
  de 560 px usan la variante `compacta` (sin columna "Fechas"; el vencimiento va bajo el folio) para no desbordar.
  **Resuelto en «Integración total»**: `VF.ui.tabla` envuelve el contenido de cada celda en `<div class="td-contenido">`
  (un solo hijo flex en móvil), por lo que los `render` multilínea ya no se fragmentan, y css/app.css estiliza
  `.btn[aria-pressed="true"]` (el botón sigue alternando `btn-primario`/`btn-secundario`, compatible).
- Pruebas E2E ejecutadas con Playwright + `tests/ayuda.js` (script temporal ya borrado): sin `pageerror` ni `console.error`
  propios; filtros = `porCobrar`; crear cliente; crear factura con folio F-0009, IVA $1,600 / total $11,600 y casilla
  "sin IVA" → $0 / $10,000; folio duplicado rechazado; pago > pendiente rechazado; pago parcial (estado `parcial`,
  movimiento ingreso 'Ventas' empresa con `facturaId`, saldo de la cuenta +5,000 exactos) y total (`pagada`, +11,600); el
  movimiento aparece en `#/empresa`; eliminar pago revierte (saldo, estado `parcial`); `CLIENTE_CON_FACTURAS` amable;
  ciclo borrador → emitir (por cobrar +2,900) → cancelar → reactivar → eliminar; editar con total < pagado rechazado;
  eliminar factura con pagos borra su movimiento y el saldo vuelve al original; `#/cobros` agrupado (= `porCliente`),
  `?cliente=`, desagrupar; estado vacío. Capturas `tests/capturas/facturas-*.png` y `cobros-*.png` en 390×844 y
  1280×800, claro y oscuro. Nota: durante la fase paralela, los `pageerror` "Unexpected end of input" provienen de otros
  módulos a medio escribir (se verificó con `node --check`), no de facturas.js.

### Integración total (núcleo, CSS, pruebas E2E completas)

- **app.js** — `alBloquear()` llama `mostrarBloqueo()` sin modo: "Desbloquear" si existe bóveda, "Crear contraseña" si
  `borrarTodo()` la eliminó. API nueva `VF.app.mostrarBloqueo(modo?)` ('crear' | 'desbloquear' | omitido). `VF.app.version`
  = '1.0.1' y `sw.js` `VF_VERSION = '1.0.1'` (el SHELL del SW ya listaba los 27 archivos; smoke.js lo verifica).
- **js/core/ui.js** — el registro de callbacks (`tabla.onFila`, `segmentos`, `vacio`) se poda al re-registrar (250 ms
  después, sólo entradas sin elemento en el DOM y con más de 1.5 s de vida) y en `hashchange` (todas las huérfanas).
  `VF.ui.podar(todo?)` → número de callbacks vivos. `VF.ui.tabla` envuelve cada celda en `<div class="td-contenido">`
  (en < 720 px es el único hijo flex del `td`; en escritorio es un bloque transparente), así un `render` que devuelve varios
  nodos no se fragmenta. `VF.ui.vacio()` usa un `.btn.btn-primario` normal (44 px).
- **js/core/calc.js** — `vencimientos()` no antepone "Tarjeta " si el nombre de la cuenta ya empieza con "Tarjeta".
- **js/core/router.js** — regla del ámbito en la cabecera (documentada en el archivo): al entrar a cualquier ruta el router
  fija el ámbito implícito (empresa/personal/facturas/cobros/proveedores) o lo limpia; los módulos con selector (panel,
  préstamos, presupuestos, reportes) lo sobrescriben en su `render()`; asistente y ajustes quedan sin badge. Nunca queda
  el ámbito de la vista anterior.
- **css/app.css** — área táctil ≥ 44 px en `.btn-chico`, `.chip` y `.segmento` (se compactan con
  `@media (hover: hover) and (pointer: fine)`); `.rejilla* > * { min-width: 0 }`; `.leyenda-dona .leyenda-etq` con
  `overflow-wrap: break-word`; `.btn[aria-pressed="true"]` (salvo primario/peligro/`.btn-ver`); `.btn-icono.btn-primario`
  conserva el fondo de acento (botón "Enviar" del asistente); `.pestana` compacta en < 480 px; `.segmentos` envuelve líneas
  (`flex-wrap: wrap`, sin scroll interno); utilidades `.celda-acciones` y `.lista-item.envolver`; `.tarjeta-peligro`;
  `.td-contenido`; bloque "Asistente" con todas las clases `asistente-*` y la señal `--vf-asistente-css: 1`. Con
  `prefers-reduced-motion: reduce` ahora `transition: none` (la duración 0.01 ms convertía cualquier cambio de propiedad
  en una transición y el valor calculado tardaba un cuadro en reflejarse).
- **index.html** — `<meta name="robots" content="noindex, nofollow">`.
- **Módulos** — ajustes.js: sin parche de pantalla de bloqueo y "Zona de peligro" con `clase: 'tarjeta-peligro'`;
  asistente.js: inyecta sus estilos sólo si falta `--vf-asistente-css`; presupuestos.js y proveedores.js: usan
  `.celda-acciones` / `.lista-item.envolver` en lugar de estilos en línea.
- **tests/ayuda.js** — sin filtro de módulos ausentes (todo error de consola cuenta); `abrir()` emula
  `reducedMotion: 'reduce'` (opción `reducedMotion: false`); helpers `esperarModal(page, { titulo? })` (espera el modal y
  los ~80 ms del foco automático de `VF.ui.modal`), `esperarSinModal`, `llenarCampo(page, nombre, valor)` (campo
  `[data-campo]` del último modal), `descarga(page, accion)` → `{ nombre, ruta, texto, bytes }`; constantes
  `ESPERA_MODAL_MS` (80) y `ESPERA_REPINTADO_MS` (120). Los tiempos a respetar están documentados en el archivo.
- **tests/smoke.js** — cubre §6 completo con los diez módulos (ver cabecera del archivo): escenario 0 (`node --check` de
  todos los .js, SW/manifest/index completos), A móvil claro, B escritorio oscuro, C `file://` escritorio claro, D móvil
  oscuro + "Olvidé mi contraseña". `VF_SMOKE=B,C` limita escenarios. Expectativas de `data-ambito` según la regla del
  router (los módulos con selector fijan el suyo). Capturas `tests/capturas/smoke-<ruta>-<viewport>-<tema>.png` de panel,
  empresa, facturas y asistente en los cuatro combos, más bloqueo, hoja "Más", ajustes y "olvidé". Guardia de 8 minutos.
