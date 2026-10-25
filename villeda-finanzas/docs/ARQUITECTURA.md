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
