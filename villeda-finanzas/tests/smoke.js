'use strict';
/*
 * tests/smoke.js — prueba E2E del shell de VILLEDA Finanzas (docs/ARQUITECTURA.md §6).
 *
 *   node tests/smoke.js            → "OK n comprobaciones" y código 0, o lista de fallos y código 1.
 *
 * Servidor http local (tests/servidor.js) + Playwright chromium (tests/ayuda.js).
 * Escenarios cubiertos en esta fase (sólo núcleo + shell; los módulos llegan después):
 *   A. Móvil 390×844 claro, http: pantalla de bloqueo, validaciones del formulario, crear bóveda con datos
 *      de ejemplo, shell (cabecera, nav inferior, <main>), hoja "Más", ámbito Personal, bloquear, contraseña
 *      incorrecta, desbloquear, recarga → bloqueo → datos persisten, bóveda cifrada en localStorage.
 *   B. Escritorio 1280×800 oscuro, http: bóveda sin ejemplo (sin banner), nav lateral con 10 enlaces,
 *      las 11 rutas sin errores de consola, document.title, botón de tema, capturas.
 *   C. file://: carga sin errores, crear, recargar, desbloquear.
 *   D. "Olvidé mi contraseña" con doble confirmación → bóveda borrada → pantalla "Crear contraseña".
 * Las capturas se guardan en tests/capturas/smoke-*.png.
 *
 * TODO módulos (cuando existan js/modules/*.js): panel con KPIs no vacíos; crear movimiento gasto empresa y
 *   verificar saldo; transferencia empresa→personal no altera utilidad; asistente responde las 5 preguntas del
 *   brief con cifra MXN; registrar pago de factura cambia estado; exportar CSV genera descarga; quitar el filtro
 *   de 404 de módulos ausentes en tests/ayuda.js.
 */
const ayuda = require('./ayuda');

const CONTRASENA = 'Prueba-Segura-2026';
const RUTAS = ['panel', 'empresa', 'personal', 'facturas', 'cobros', 'proveedores', 'prestamos', 'presupuestos', 'reportes', 'asistente', 'ajustes'];

let ok = 0;
const fallos = [];
let escenarioActual = '';

function comprobar(condicion, mensaje) {
  if (condicion) { ok += 1; return true; }
  fallos.push('[' + escenarioActual + '] ' + mensaje);
  console.error('  FALLO: ' + mensaje);
  return false;
}
function igual(a, b, mensaje) {
  return comprobar(a === b, mensaje + ' (esperado ' + JSON.stringify(b) + ', obtenido ' + JSON.stringify(a) + ')');
}
function sinErrores(page, momento) {
  const errs = ayuda.recogerErrores(page);
  const fin = errs.length;
  comprobar(fin === 0, 'sin errores de consola ' + momento + (fin ? ': ' + errs.map(function (e) { return e.tipo + ' ' + e.texto; }).join(' | ') : ''));
  errs.length = 0; // no volver a reportar los mismos
}

async function visible(page, selector) {
  return page.isVisible(selector);
}
async function textoDe(page, selector) {
  return (await page.textContent(selector) || '').trim();
}
async function pausa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------------------------------------------------------------- A ---- */
async function escenarioMovil() {
  escenarioActual = 'A móvil http claro';
  console.log('Escenario ' + escenarioActual);
  const page = await ayuda.abrir('movil', { colorScheme: 'light' });

  // Pantalla de bloqueo inicial
  comprobar(await visible(page, '#pantalla-bloqueo'), 'pantalla de bloqueo visible al abrir');
  comprobar(!(await visible(page, '#app')), '#app oculto antes de crear la bóveda');
  comprobar(await visible(page, '#form-crear'), 'formulario "Crear contraseña" visible (no hay bóveda)');
  comprobar(!(await visible(page, '#form-desbloquear')), 'formulario "Desbloquear" oculto');
  comprobar(await page.isChecked('#crear-ejemplo'), 'casilla "Cargar datos de ejemplo" marcada por defecto');
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'bloqueo: sin scroll horizontal');
  await ayuda.captura(page, 'smoke-bloqueo-crear-movil-claro');

  // Validaciones
  await page.fill('#crear-contrasena', 'corta');
  await page.fill('#crear-confirmar', 'corta');
  await page.click('#btn-crear');
  comprobar(/8 caracteres/.test(await textoDe(page, '#crear-error')), 'contraseña corta → error de longitud mínima');
  comprobar(!(await visible(page, '#app')), 'contraseña corta no crea bóveda');
  await page.fill('#crear-contrasena', CONTRASENA);
  await page.fill('#crear-confirmar', CONTRASENA + 'x');
  await page.click('#btn-crear');
  comprobar(/no coinciden/i.test(await textoDe(page, '#crear-error')), 'contraseñas distintas → error "no coinciden"');
  const nivel = await page.getAttribute('#form-crear .fortaleza', 'data-nivel');
  comprobar(Number(nivel) >= 3, 'medidor de fortaleza reacciona (nivel ' + nivel + ')');

  // Crear con datos de ejemplo
  await ayuda.crearBoveda(page, CONTRASENA, true);
  comprobar(await visible(page, '#app'), '#app visible tras crear la bóveda');
  comprobar(!(await visible(page, '#pantalla-bloqueo')), 'pantalla de bloqueo oculta tras crear');
  comprobar(await visible(page, '#cabecera'), 'cabecera visible');
  comprobar(await visible(page, '#btn-bloquear'), 'botón bloquear visible');
  comprobar(await visible(page, '#nav-inferior'), 'nav inferior visible en móvil');
  comprobar(!(await visible(page, '#nav-lateral')), 'nav lateral oculto en móvil');
  igual(await page.locator('#nav-inferior .nav-item').count(), 5, 'nav inferior con 5 pestañas');
  igual(await textoDe(page, '#nav-inferior'), 'PanelEmpresaPersonalAsistenteMás', 'pestañas inferiores: Panel, Empresa, Personal, Asistente, Más');
  comprobar(await visible(page, '#banner-ejemplo'), 'banner de datos de ejemplo visible');
  comprobar(/^#\/panel/.test(await page.evaluate(function () { return location.hash; })), 'ruta vacía → #/panel');
  igual(await page.title(), 'Panel · VILLEDA Finanzas', 'document.title de la ruta');
  const h1 = await textoDe(page, '#vista h1');
  comprobar(h1.length > 0, '<main> muestra un h1 ("' + h1 + '")');
  const vistaTexto = await textoDe(page, '#vista');
  comprobar(/Módulo no disponible|Sin movimientos|\$\s?[\d,]+/.test(vistaTexto), '<main> muestra "Módulo no disponible" o un panel con cifras'); // TODO módulos: exigir KPIs
  comprobar(await page.evaluate(function () { return document.activeElement === document.querySelector('#vista h1'); }), 'foco en el h1 de la vista');
  const cuentas = await page.evaluate(function () { return VF.store.estado().cuentas.length; });
  igual(cuentas, 7, 'seed cargado: 7 cuentas');
  comprobar(await page.evaluate(function () { return VF.store.estado().ajustes.datosEjemplo === true; }), 'ajustes.datosEjemplo = true con ejemplo');
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'shell móvil: sin scroll horizontal');
  await ayuda.captura(page, 'smoke-shell-panel-movil-claro');
  sinErrores(page, 'tras crear la bóveda (móvil)');

  // Hoja "Más"
  await ayuda.quitarToasts(page);
  await page.click('#nav-inferior [data-nav-mas]');
  await page.waitForSelector('.modal-hoja', { state: 'visible' });
  igual(await page.locator('.modal-hoja .hoja-mas .nav-item').count(), 6, 'hoja "Más" con 6 secciones (Facturas, Proveedores, Préstamos, Presupuestos, Reportes, Ajustes)');
  await ayuda.captura(page, 'smoke-hoja-mas-movil-claro');
  await page.click('.modal-hoja .nav-item[href="#/ajustes"]');
  await page.waitForFunction(function () { return location.hash === '#/ajustes' && !document.querySelector('.modal-fondo'); });
  igual(await page.title(), 'Ajustes · VILLEDA Finanzas', 'navegar desde la hoja "Más" cierra el modal y cambia el título');
  comprobar(await page.evaluate(function () { return document.querySelector('#nav-inferior [data-nav-mas]').getAttribute('aria-current') === 'page'; }), 'pestaña "Más" marcada como actual en una ruta secundaria');

  // Ámbito personal → acento verde + badge
  await page.click('#nav-inferior a[href="#/personal"]');
  await page.waitForFunction(function () { return document.documentElement.getAttribute('data-ambito') === 'personal'; });
  igual(await textoDe(page, '#badge-ambito'), 'Personal', 'badge de ámbito "Personal"');
  const cabecera = await page.evaluate(function () {
    var marca = document.querySelector('.marca').getBoundingClientRect();
    var badge = document.querySelector('#badge-ambito .badge').getBoundingClientRect();
    var acciones = document.querySelector('.cabecera-acciones').getBoundingClientRect();
    return { separacionIzq: badge.left - marca.right, separacionDer: acciones.left - badge.right, anchoBadge: badge.width };
  });
  comprobar(cabecera.separacionIzq >= 6 && cabecera.separacionDer >= 6 && cabecera.anchoBadge > 40,
    'el badge de ámbito cabe en la cabecera móvil sin tocar la marca ni los botones (' + JSON.stringify(cabecera) + ')');
  comprobar(await page.evaluate(function () {
    return document.querySelector('#nav-inferior a[href="#/personal"]').getAttribute('aria-current') === 'page';
  }), 'pestaña Personal con aria-current');
  await ayuda.captura(page, 'smoke-shell-personal-movil-claro');
  await page.click('#nav-inferior a[href="#/panel"]');
  await page.waitForFunction(function () { return !document.documentElement.hasAttribute('data-ambito'); });
  igual(await textoDe(page, '#badge-ambito'), '', 'panel sin badge de ámbito');
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'tras navegar: sin scroll horizontal');

  // Bloquear → contraseña incorrecta → desbloquear
  await ayuda.bloquear(page);
  comprobar(await visible(page, '#pantalla-bloqueo'), 'bloquear muestra la pantalla de bloqueo');
  comprobar(!(await visible(page, '#app')), 'bloquear oculta #app');
  comprobar(await page.evaluate(function () { return !VF.store.estaDesbloqueado() && VF.store.estado() === null; }), 'bloquear borra el estado de memoria');
  igual(await page.evaluate(function () { return document.querySelector('#vista').innerHTML; }), '', 'bloquear vacía <main>');
  const malo = await ayuda.desbloquear(page, 'incorrecta-123');
  comprobar(malo === false, 'contraseña incorrecta no desbloquea');
  igual(await textoDe(page, '#desbloquear-error'), 'Contraseña incorrecta.', 'mensaje "Contraseña incorrecta."');
  comprobar(!(await visible(page, '#app')), '#app sigue oculto tras contraseña incorrecta');
  await ayuda.captura(page, 'smoke-bloqueo-incorrecta-movil-claro');
  const bueno = await ayuda.desbloquear(page, CONTRASENA);
  comprobar(bueno === true, 'contraseña correcta desbloquea');
  comprobar(!(await visible(page, '#desbloquear-error')), 'error oculto tras desbloquear');
  igual(await page.evaluate(function () { return VF.store.estado().cuentas.length; }), 7, 'estado restaurado tras desbloquear');

  // Bóveda cifrada en localStorage
  const boveda = await page.evaluate(function () {
    var crudo = localStorage.getItem('vf.boveda.v1') || '';
    var obj = {}; try { obj = JSON.parse(crudo); } catch (e) { /* vacío */ }
    return { longitud: crudo.length, claves: Object.keys(obj).sort().join(','), contieneTexto: /VILLEDA|Nómina|BBVA|cuentas/.test(crudo), version: obj.version };
  });
  comprobar(boveda.longitud > 1000, 'bóveda persistida en localStorage (' + boveda.longitud + ' caracteres)');
  igual(boveda.claves, 'datos,iv,salt,verificador,version', 'formato de bóveda {version, salt, iv, datos, verificador}');
  comprobar(!boveda.contieneTexto, 'el texto almacenado está cifrado (no aparecen nombres del seed)');

  // Recarga → bloqueo → desbloquear → datos persisten
  await page.reload({ waitUntil: 'load' });
  comprobar(await visible(page, '#form-desbloquear'), 'tras recargar pide contraseña');
  comprobar(!(await visible(page, '#form-crear')), 'tras recargar no ofrece crear');
  comprobar(!(await visible(page, '#app')), 'tras recargar #app oculto');
  comprobar(await ayuda.desbloquear(page, CONTRASENA), 'desbloquea tras recargar');
  const resumen = await page.evaluate(function () {
    var e = VF.store.estado();
    return { cuentas: e.cuentas.length, movimientos: e.movimientos.length, facturas: e.facturas.length, ejemplo: e.ajustes.datosEjemplo };
  });
  igual(resumen.cuentas, 7, 'persisten las 7 cuentas');
  comprobar(resumen.movimientos >= 70, 'persisten ≥70 movimientos (' + resumen.movimientos + ')');
  igual(resumen.facturas, 8, 'persisten las 8 facturas');
  comprobar(resumen.ejemplo === true, 'persiste ajustes.datosEjemplo');
  comprobar(await visible(page, '#banner-ejemplo'), 'banner de ejemplo visible tras recargar');
  sinErrores(page, 'al final del escenario móvil');
}

/* ---------------------------------------------------------------- B ---- */
async function escenarioEscritorio() {
  escenarioActual = 'B escritorio http oscuro';
  console.log('Escenario ' + escenarioActual);
  const page = await ayuda.abrir('escritorio', { colorScheme: 'dark' });
  comprobar(await visible(page, '#form-crear'), 'contexto nuevo → pantalla "Crear contraseña"');
  const fondoBloqueo = await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; });
  comprobar(/rgb\(11, 17, 32\)/.test(fondoBloqueo), 'modo oscuro automático aplicado al fondo (' + fondoBloqueo + ')');
  await ayuda.captura(page, 'smoke-bloqueo-crear-escritorio-oscuro');

  await ayuda.crearBoveda(page, CONTRASENA, false);
  comprobar(await visible(page, '#app'), 'bóveda sin ejemplo creada');
  comprobar(!(await visible(page, '#banner-ejemplo')), 'sin datos de ejemplo no hay banner');
  igual(await page.evaluate(function () { return VF.store.estado().cuentas.length; }), 0, 'bóveda vacía: 0 cuentas');
  comprobar(await visible(page, '#nav-lateral'), 'nav lateral visible en escritorio');
  comprobar(!(await visible(page, '#nav-inferior')), 'nav inferior oculto en escritorio');
  igual(await page.locator('#nav-lateral .nav-item').count(), 10, 'nav lateral con 10 enlaces (cobros es alias sin nav)');
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'escritorio oscuro: sin scroll horizontal');
  await ayuda.captura(page, 'smoke-shell-panel-escritorio-oscuro');
  sinErrores(page, 'tras crear la bóveda (escritorio)');

  // Las 11 rutas del contrato
  for (const ruta of RUTAS) {
    await page.evaluate(function (r) { location.hash = '#/' + r; }, ruta);
    await page.waitForFunction(function (r) { return document.querySelector('#vista').getAttribute('data-ruta') === r && document.querySelector('#vista h1'); }, ruta);
    const titulo = await page.title();
    comprobar(/ · VILLEDA Finanzas$/.test(titulo) && !/^Sección/.test(titulo), 'ruta ' + ruta + ': título "' + titulo + '"');
    const texto = await textoDe(page, '#vista');
    comprobar(texto.length > 0 && !/Página no encontrada|Ocurrió un error/.test(texto), 'ruta ' + ruta + ' renderiza sin error'); // TODO módulos: comprobar contenido real
    const ambitoEsperado = { empresa: 'empresa', personal: 'personal', facturas: 'empresa', cobros: 'empresa', proveedores: 'empresa' }[ruta] || null;
    igual(await page.getAttribute('html', 'data-ambito'), ambitoEsperado, 'ruta ' + ruta + ': data-ambito');
    const activo = await page.evaluate(function () {
      var a = document.querySelector('#nav-lateral .nav-item[aria-current="page"]');
      return a ? a.getAttribute('href') : null;
    });
    igual(activo, '#/' + (ruta === 'cobros' ? 'facturas' : ruta), 'ruta ' + ruta + ': enlace lateral activo');
    comprobar(!(await ayuda.hayScrollHorizontal(page)), 'ruta ' + ruta + ': sin scroll horizontal');
  }
  await ayuda.captura(page, 'smoke-ruta-ajustes-escritorio-oscuro');
  sinErrores(page, 'tras visitar las 11 rutas');

  // Ruta desconocida
  await page.evaluate(function () { location.hash = '#/inexistente'; });
  await page.waitForFunction(function () { return /Página no encontrada/.test(document.querySelector('#vista').textContent); });
  comprobar(true, 'ruta desconocida muestra "Página no encontrada"');
  await page.click('#vista a[href="#/panel"]');
  await page.waitForFunction(function () { return location.hash === '#/panel'; });

  // Botón de tema: auto → claro → oscuro → auto, y persistencia en ajustes
  await page.click('#btn-tema');
  igual(await page.getAttribute('html', 'data-tema'), 'claro', 'tema → claro');
  igual(await page.evaluate(function () { return VF.store.estado().ajustes.tema; }), 'claro', 'ajustes.tema = claro');
  const fondoClaro = await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; });
  comprobar(/rgb\(243, 245, 249\)/.test(fondoClaro), 'tema claro forzado sobre preferencia oscura (' + fondoClaro + ')');
  await ayuda.captura(page, 'smoke-shell-panel-escritorio-claro');
  await page.click('#btn-tema');
  igual(await page.getAttribute('html', 'data-tema'), 'oscuro', 'tema → oscuro');
  await page.click('#btn-tema');
  igual(await page.getAttribute('html', 'data-tema'), null, 'tema → auto (sin data-tema)');

  // setAjustes desde "otro módulo" se refleja (evento cambio): banner y tema
  await page.evaluate(function () { VF.store.setAjustes({ tema: 'oscuro', datosEjemplo: true }); });
  await page.waitForFunction(function () { return document.documentElement.getAttribute('data-tema') === 'oscuro'; });
  comprobar(await visible(page, '#banner-ejemplo'), 'evento "cambio" actualiza banner de ejemplo');
  await page.evaluate(function () { VF.store.setAjustes({ tema: 'auto', datosEjemplo: false }); });
  await page.waitForFunction(function () { return !document.documentElement.hasAttribute('data-tema'); });

  // Bloquear con atajo del store (p. ej. autobloqueo) y volver
  await page.evaluate(function () { VF.store.bloquear(); });
  await page.waitForSelector('#form-desbloquear', { state: 'visible' });
  comprobar(!(await visible(page, '#app')), 'VF.store.bloquear() desde código oculta #app (evento bloqueado)');
  await ayuda.captura(page, 'smoke-bloqueo-desbloquear-escritorio-oscuro');
  comprobar(await ayuda.desbloquear(page, CONTRASENA), 'desbloquea en escritorio');
  igual(await page.evaluate(function () { return location.hash; }), '#/panel', 'conserva la ruta al desbloquear');
  sinErrores(page, 'al final del escenario escritorio');
}

/* ---------------------------------------------------------------- C ---- */
async function escenarioFile() {
  escenarioActual = 'C file://';
  console.log('Escenario ' + escenarioActual + ' (' + ayuda.URL_FILE + ')');
  const page = await ayuda.abrir('escritorio', { url: ayuda.URL_FILE, colorScheme: 'light' });
  comprobar(/^file:/.test(page.url()), 'abierto por file://');
  comprobar(await visible(page, '#form-crear'), 'file://: pantalla "Crear contraseña"');
  comprobar(!(await visible(page, '#bloqueo-aviso')), 'file://: sin aviso de almacenamiento/cifrado no disponible');
  comprobar(await page.evaluate(function () { return !!(window.VF && VF.util && VF.crypto && VF.store && VF.seed && VF.calc && VF.ui && VF.router && VF.app); }), 'file://: los 9 espacios de nombres del núcleo cargados');
  comprobar(await page.evaluate(function () { return !navigator.serviceWorker || !navigator.serviceWorker.controller; }), 'file://: sin service worker');
  sinErrores(page, 'al cargar por file://');
  await ayuda.crearBoveda(page, CONTRASENA, true);
  comprobar(await visible(page, '#app'), 'file://: bóveda creada y #app visible');
  igual(await page.evaluate(function () { return VF.store.estado().cuentas.length; }), 7, 'file://: seed cargado');
  comprobar(/^#\/panel/.test(await page.evaluate(function () { return location.hash; })), 'file://: ruta inicial #/panel');
  await ayuda.captura(page, 'smoke-file-shell-escritorio-claro');
  await page.reload({ waitUntil: 'load' });
  comprobar(await visible(page, '#form-desbloquear'), 'file://: tras recargar pide contraseña');
  comprobar(await ayuda.desbloquear(page, CONTRASENA), 'file://: desbloquea tras recargar');
  igual(await page.evaluate(function () { return VF.store.estado().cuentas.length; }), 7, 'file://: datos persisten');
  sinErrores(page, 'al final del escenario file://');
}

/* ---------------------------------------------------------------- D ---- */
async function escenarioOlvide() {
  escenarioActual = 'D olvidé mi contraseña';
  console.log('Escenario ' + escenarioActual);
  const page = await ayuda.abrir('movil', { colorScheme: 'light' });
  await ayuda.crearBoveda(page, CONTRASENA, true);
  await ayuda.bloquear(page);
  await ayuda.quitarToasts(page);
  await page.click('#enlace-olvide');
  await page.waitForSelector('.modal', { state: 'visible' });
  comprobar(/no existe forma de recuperarla/.test(await textoDe(page, '.modal-cuerpo')), 'modal explica que no hay recuperación');
  await ayuda.captura(page, 'smoke-olvide-movil-claro');
  // Cancelar no borra nada
  await page.click('.modal-pie .btn-secundario');
  await page.waitForSelector('.modal-fondo', { state: 'detached' });
  comprobar(await page.evaluate(function () { return VF.store.existeBoveda(); }), 'cancelar conserva la bóveda');
  // Borrar con doble confirmación; la primera cancelada también conserva
  await page.click('#enlace-olvide');
  await page.waitForSelector('.modal-pie .btn-peligro', { state: 'visible' });
  await page.click('.modal-pie .btn-peligro');
  await page.waitForFunction(function () { return document.querySelectorAll('.modal').length === 1 && /TODOS los datos/.test(document.querySelector('.modal-cuerpo').textContent); });
  await page.click('.modal-pie .btn-secundario');
  await page.waitForSelector('.modal-fondo', { state: 'detached' });
  comprobar(await page.evaluate(function () { return VF.store.existeBoveda(); }), 'cancelar la primera confirmación conserva la bóveda');
  await page.click('#enlace-olvide');
  await page.waitForSelector('.modal-pie .btn-peligro', { state: 'visible' });
  await page.click('.modal-pie .btn-peligro');
  await page.waitForFunction(function () { return document.querySelectorAll('.modal').length === 1 && /TODOS los datos/.test(document.querySelector('.modal-cuerpo').textContent); });
  await page.click('.modal-pie .btn-peligro');
  await page.waitForFunction(function () { return /Última confirmación/.test((document.querySelector('.modal-cuerpo') || {}).textContent || ''); });
  await page.click('.modal-pie .btn-peligro');
  await page.waitForSelector('#form-crear', { state: 'visible' });
  comprobar(!(await page.evaluate(function () { return VF.store.existeBoveda(); })), 'doble confirmación borra la bóveda');
  comprobar(await page.evaluate(function () { return localStorage.getItem('vf.boveda.v1') === null; }), 'localStorage sin bóveda');
  comprobar(!(await visible(page, '#form-desbloquear')), 'vuelve a la pantalla "Crear contraseña"');
  // Se puede crear una bóveda nueva después
  await ayuda.crearBoveda(page, 'Otra-Clave-9876', false);
  comprobar(await visible(page, '#app'), 'se crea una bóveda nueva tras borrar');
  igual(await page.evaluate(function () { return VF.store.estado().cuentas.length; }), 0, 'la bóveda nueva está vacía');
  sinErrores(page, 'al final del escenario olvidé');
}

/* ---------------------------------------------------------------- main -- */
async function main() {
  const inicio = Date.now();
  const guardia = setTimeout(function () {
    console.error('FALLO: la prueba superó el tiempo máximo (4 minutos).');
    process.exit(1);
  }, 4 * 60 * 1000);
  try {
    const srv = await ayuda.iniciarServidor();
    console.log('Servidor: ' + srv.url);
    const escenarios = [escenarioMovil, escenarioEscritorio, escenarioFile, escenarioOlvide];
    for (const esc of escenarios) {
      try {
        await esc();
      } catch (e) {
        fallos.push('[' + escenarioActual + '] excepción: ' + (e && e.message ? e.message.split('\n')[0] : e));
        console.error('  EXCEPCIÓN en ' + escenarioActual + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e));
      }
    }
  } finally {
    clearTimeout(guardia);
    await ayuda.cerrar();
  }
  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  if (fallos.length) {
    console.error('\n' + fallos.length + ' fallo(s) en ' + seg + ' s:');
    fallos.forEach(function (f) { console.error(' - ' + f); });
    console.error('(' + ok + ' comprobaciones correctas)');
    process.exit(1);
  }
  console.log('\nOK ' + ok + ' comprobaciones (' + seg + ' s). Capturas en tests/capturas/smoke-*.png');
}

main().catch(function (e) {
  console.error('FALLO inesperado:', e);
  ayuda.cerrar().then(function () { process.exit(1); }, function () { process.exit(1); });
});
