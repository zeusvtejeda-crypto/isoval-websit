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
  clase de css/app.css cuyo único efecto es `min-width:0`. **Pendiente para css/app.css**: `.rejilla-2 > *, .rejilla-3 > *,
  .rejilla-4 > * { min-width: 0 }` (o una utilidad `.columna`); entonces el panel puede volver a `<div>` simples. Los badges
  de ámbito/estado van al INICIO de `.lista-sub` porque la línea se trunca con elipsis en móvil.
- Pruebas E2E del panel (Playwright + `tests/ayuda.js`; capturas `tests/capturas/panel-*.png` en 390×844 y 1280×800, claro
  y oscuro): KPIs = VF.calc en los tres ámbitos, próximos 7 días (tonos), gráfica (tabla gemela = serieMensual), por cobrar
  top 5 sólo en empresa, recientes (orden y badges), alta con validación → saldo/KPI/lista, detalle, edición, eliminación
  con confirmación, transferencia cruzada (categoría, saldos, utilidad intacta), vinculados sólo lectura, "Ver todo" y
  navegación al origen, reactividad a 'cambio' dentro y fuera de la ruta, sessionStorage y `?ambito=`, estados vacíos,
  `file://`. Nota para quien escriba E2E: con `html { scroll-behavior: smooth }` los clics de Playwright sobre elementos
  bajo el pliegue fallan por intercepción (el scroll anima); usar `page.emulateMedia({ reducedMotion: 'reduce' })`.

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
- Borrar todo: `VF.store.borrarTodo()` emite 'bloqueado' y app.js muestra la pantalla de bloqueo en modo "Desbloquear"
  aunque ya no exista bóveda (`alBloquear` → `mostrarBloqueo('desbloquear')`). ajustes.js lo corrige con un auxiliar privado
  que muestra `#form-crear`, oculta `#form-desbloquear` y enfoca `#crear-contrasena`. **Pendiente app.js**: en `alBloquear`
  llamar `mostrarBloqueo()` sin modo (elige "crear" si `!existeBoveda()`), o exponer `VF.app.mostrarBloqueo(modo)`.
- Pendientes menores: `docs/IA-SERVIDOR.md` (listado en §1) no existe todavía; la "Zona de peligro" usa `.aviso.aviso-error`
  dentro de una tarjeta normal (opcional en css/app.css: `.tarjeta-peligro` con borde `--negativo`).
- Pruebas E2E (Playwright + `tests/ayuda.js`, 76 comprobaciones; capturas `tests/capturas/ajustes-*.png` en 390×844 y
  1280×800, claro y oscuro): guardar ajustes y persistencia tras recarga, tema inmediato sin repintado, escape de HTML en
  nombres, cambio de contraseña (errores en línea; la vieja deja de abrir), exportar cifrado y plano (descargas leídas y
  validadas), importar plano, cifrado con la clave actual y cifrado con una contraseña anterior (estado idéntico; errores de
  contraseña en el modal), borrar datos de ejemplo (0 ids `_demo`, banner oculto), servidor de IA (ok, no JSON, sin `texto`,
  URL inválida, inalcanzable, tiempo agotado, cuerpo del POST), borrar todo (pantalla "Crear contraseña", sin
  `vf.boveda.v1`). Notas para E2E: tras importar, el repintado por 'cambio' sustituye el `<input type=file>` → esperar
  ~150 ms antes de otro `setInputFiles`; un `fetch` a un servidor inalcanzable produce un `console.error` del navegador
  ("Failed to load resource: net::ERR_CONNECTION_REFUSED") que no es defecto del código: filtrarlo en las pruebas.
