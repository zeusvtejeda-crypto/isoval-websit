'use strict';
/*
 * tests/ayuda.js — utilidades compartidas para las pruebas E2E con Playwright.
 *
 *   const ayuda = require('./ayuda');
 *   const srv  = await ayuda.iniciarServidor();            // servidor http de tests/servidor.js (puerto libre)
 *   const page = await ayuda.abrir('movil');               // contexto NUEVO (localStorage limpio) + página en la URL del servidor
 *   await ayuda.crearBoveda(page, 'contrasena', true);     // pantalla "Crear contraseña" → #app visible
 *   await ayuda.desbloquear(page, 'contrasena');           // pantalla "Desbloquear" → true si abrió, false si mostró error
 *   ayuda.recogerErrores(page)                             // → arreglo vivo de pageerror / console.error de esa página
 *   await ayuda.cerrar();                                  // cierra navegador y servidor
 *
 * abrir(viewport, opciones):
 *   viewport: 'movil' (390×844, isMobile, táctil) | 'escritorio' (1280×800) | { width, height, isMobile, hasTouch }
 *   opciones: { url (por defecto la del servidor), colorScheme: 'light'|'dark', navegar: true, reducedMotion: true }
 *   La página devuelta lleva page.vf = { errores, viewport, colorScheme, context }.
 * Además: esperarModal(page, { titulo? }) (espera el modal y los ~80 ms del foco automático), esperarSinModal(page),
 *   llenarCampo(page, nombre, valor) (campo [data-campo] del último modal), descarga(page, accion) → { nombre, texto, bytes }.
 */
const path = require('path');
const { chromium } = require('playwright');
const servidorMod = require('./servidor');

const RAIZ = servidorMod.RAIZ;
const URL_FILE = 'file://' + path.join(RAIZ, 'index.html');

const VIEWPORTS = {
  movil: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  escritorio: { width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
};

let servidor = null;
let navegador = null;
const contextos = [];

/** Arranca (una sola vez) el servidor http y devuelve { url, puerto, cerrar }. */
async function iniciarServidor(puerto) {
  if (!servidor) servidor = await servidorMod.iniciar(puerto);
  return servidor;
}

async function obtenerNavegador() {
  if (!navegador) navegador = await chromium.launch();
  return navegador;
}

/**
 * Engancha (una vez) los oyentes de pageerror y console.error y devuelve el arreglo vivo de errores.
 * Cada entrada: { tipo: 'pageerror'|'console', texto, url }. No se filtra nada: los diez módulos existen y
 * cualquier error de consola cuenta (un fetch a un servidor de IA inalcanzable sí produce un console.error del
 * navegador; la prueba que lo provoque debe descartarlo explícitamente).
 */
function recogerErrores(page) {
  if (page.vf && page.vf.errores) return page.vf.errores;
  const errores = [];
  page.vf = Object.assign({}, page.vf, { errores: errores });
  page.on('pageerror', function (err) {
    errores.push({ tipo: 'pageerror', texto: err && err.message ? err.message : String(err), url: page.url() });
  });
  page.on('console', function (msg) {
    if (msg.type() !== 'error') return;
    const loc = msg.location ? msg.location() : null;
    errores.push({ tipo: 'console', texto: msg.text(), url: loc && loc.url ? loc.url : '' });
  });
  return errores;
}

/**
 * Tiempos que conviene respetar en E2E:
 *  - VF.ui.modal() enfoca el primer campo con setTimeout(20 ms): esperar ~80 ms tras abrir un modal antes de
 *    escribir en él (si no, un page.fill puede ganarle al foco automático y el valor se pierde al enfocar).
 *    esperarModal() ya incluye esa espera.
 *  - Los módulos repintan con VF.store.on('cambio') tras 30 ms: tras guardar, esperar ≥ 80 ms antes de leer el DOM.
 *  - Tras importar un respaldo, el repintado sustituye el <input type=file>: esperar ~150 ms antes de otro setInputFiles.
 */
const ESPERA_MODAL_MS = 80;
const ESPERA_REPINTADO_MS = 120;

/** Espera a que haya un modal visible (el último abierto) y a que su foco automático haya ocurrido. → Locator del .modal */
async function esperarModal(page, opciones) {
  const o = opciones || {};
  await page.waitForSelector('.modal-fondo .modal', { state: 'visible', timeout: o.timeout || 15000 });
  if (o.titulo) {
    await page.waitForFunction(function (t) {
      var modales = document.querySelectorAll('.modal-fondo .modal');
      var ultimo = modales[modales.length - 1];
      return ultimo && new RegExp(t, 'i').test((ultimo.querySelector('.modal-cabecera h2') || {}).textContent || '');
    }, o.titulo);
  }
  await page.waitForTimeout(ESPERA_MODAL_MS);
  return page.locator('.modal-fondo .modal').last();
}

/** Espera a que no quede ningún modal abierto. */
async function esperarSinModal(page, timeout) {
  await page.waitForSelector('.modal-fondo', { state: 'detached', timeout: timeout || 15000 });
  await page.waitForTimeout(ESPERA_REPINTADO_MS);
}

/** Rellena un campo de VF.ui.formulario dentro del último modal: [data-campo="nombre"] (input, select o textarea). */
async function llenarCampo(page, nombre, valor) {
  const modal = page.locator('.modal-fondo .modal').last();
  const campo = modal.locator('[data-campo="' + nombre + '"]');
  const etiqueta = await campo.evaluate(function (n) { return n.tagName.toLowerCase(); });
  if (etiqueta === 'select') await campo.selectOption(String(valor));
  else { await campo.fill(''); await campo.fill(String(valor)); }
  await campo.dispatchEvent('change');
}

/** Pulsa `accion` (función o selector) y devuelve la descarga leída: { nombre, ruta, texto, bytes }. */
async function descarga(page, accion, timeout) {
  const esperando = page.waitForEvent('download', { timeout: timeout || 20000 });
  if (typeof accion === 'function') await accion(); else await page.click(accion);
  const d = await esperando;
  const ruta = await d.path();
  const bytes = require('fs').readFileSync(ruta);
  return { nombre: d.suggestedFilename(), ruta: ruta, bytes: bytes, texto: bytes.toString('utf8') };
}

/** Abre un contexto nuevo (almacenamiento limpio) con el viewport indicado y navega a la app. */
async function abrir(viewport, opciones) {
  const o = opciones || {};
  const vp = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport;
  if (!vp) throw new Error('Viewport desconocido: ' + viewport + ' (usa "movil", "escritorio" o un objeto)');
  const nav = await obtenerNavegador();
  const context = await nav.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    colorScheme: o.colorScheme || 'light',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    acceptDownloads: true
  });
  contextos.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.vf = { viewport: typeof viewport === 'string' ? viewport : 'personalizado', colorScheme: o.colorScheme || 'light', context: context };
  recogerErrores(page);
  // html { scroll-behavior: smooth } hace que los clics de Playwright sobre elementos bajo el pliegue fallen por
  // intercepción mientras anima el scroll; con reducedMotion la app desactiva animaciones y scroll suave.
  if (o.reducedMotion !== false) await page.emulateMedia({ reducedMotion: 'reduce' });
  if (o.navegar !== false) {
    let url = o.url;
    if (!url) {
      if (!servidor) await iniciarServidor();
      url = servidor.url;
    }
    await page.goto(url, { waitUntil: 'load' });
  }
  return page;
}

/** Marca una casilla sin depender del estado previo. */
async function fijarCasilla(page, selector, valor) {
  const marcada = await page.isChecked(selector);
  if (marcada !== !!valor) await page.click(selector);
}

/** Pantalla "Crear contraseña" → crea la bóveda y espera a que #app sea visible. */
async function crearBoveda(page, contrasena, conEjemplo) {
  await page.waitForSelector('#form-crear:not([hidden])', { state: 'visible' });
  await page.fill('#crear-contrasena', contrasena);
  await page.fill('#crear-confirmar', contrasena);
  await fijarCasilla(page, '#crear-ejemplo', conEjemplo !== false);
  await page.click('#btn-crear');
  await page.waitForSelector('#app:not([hidden])', { state: 'visible', timeout: 30000 });
  await page.waitForFunction(function () { return window.VF && VF.store && VF.store.estaDesbloqueado(); });
  await page.waitForSelector('#vista h1');
}

/**
 * Pantalla "Desbloquear" → escribe la contraseña y pulsa el botón.
 * Devuelve true si #app quedó visible, false si la pantalla mostró un error (#desbloquear-error).
 */
async function desbloquear(page, contrasena) {
  await page.waitForSelector('#form-desbloquear:not([hidden])', { state: 'visible' });
  await page.fill('#desbloquear-contrasena', contrasena);
  await page.click('#btn-desbloquear');
  const resultado = await Promise.race([
    page.waitForSelector('#app:not([hidden])', { state: 'visible', timeout: 30000 }).then(function () { return 'ok'; }),
    page.waitForSelector('#desbloquear-error:not([hidden])', { state: 'visible', timeout: 30000 }).then(function () { return 'error'; })
  ]);
  if (resultado === 'ok') {
    await page.waitForFunction(function () { return window.VF && VF.store && VF.store.estaDesbloqueado(); });
    await page.waitForSelector('#vista h1');
    return true;
  }
  return false;
}

/** Pulsa el botón de bloquear de la cabecera y espera la pantalla de desbloqueo. */
async function bloquear(page) {
  await page.click('#btn-bloquear');
  await page.waitForSelector('#form-desbloquear:not([hidden])', { state: 'visible' });
}

/** true si la página tiene scroll horizontal (defecto de layout). */
async function hayScrollHorizontal(page) {
  return page.evaluate(function () {
    var de = document.documentElement;
    return de.scrollWidth > de.clientWidth + 1 || document.body.scrollWidth > de.clientWidth + 1;
  });
}

/** Quita los toasts visibles (para que una captura no los superponga a un modal u hoja). */
async function quitarToasts(page) {
  await page.evaluate(function () {
    Array.prototype.forEach.call(document.querySelectorAll('#toasts .toast'), function (t) { t.remove(); });
  });
}

/**
 * Guarda una captura en tests/capturas/<nombre>.png y devuelve la ruta.
 * Espera ~320 ms antes de capturar para que terminen las animaciones de entrada (modal/hoja: 0.2 s).
 */
async function captura(page, nombre, opciones) {
  const dir = path.join(RAIZ, 'tests', 'capturas');
  require('fs').mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, nombre + '.png');
  await page.waitForTimeout(320);
  await page.screenshot(Object.assign({ path: ruta, fullPage: false }, opciones || {}));
  return ruta;
}

/** Cierra todos los contextos, el navegador y el servidor. */
async function cerrar() {
  for (const c of contextos.splice(0)) {
    try { await c.close(); } catch (e) { /* ya cerrado */ }
  }
  if (navegador) { try { await navegador.close(); } catch (e) { /* ignorar */ } navegador = null; }
  if (servidor) { try { await servidor.cerrar(); } catch (e) { /* ignorar */ } servidor = null; }
}

module.exports = {
  iniciarServidor: iniciarServidor,
  abrir: abrir,
  crearBoveda: crearBoveda,
  desbloquear: desbloquear,
  bloquear: bloquear,
  recogerErrores: recogerErrores,
  hayScrollHorizontal: hayScrollHorizontal,
  quitarToasts: quitarToasts,
  captura: captura,
  esperarModal: esperarModal,
  esperarSinModal: esperarSinModal,
  llenarCampo: llenarCampo,
  descarga: descarga,
  ESPERA_MODAL_MS: ESPERA_MODAL_MS,
  ESPERA_REPINTADO_MS: ESPERA_REPINTADO_MS,
  cerrar: cerrar,
  VIEWPORTS: VIEWPORTS,
  URL_FILE: URL_FILE,
  RAIZ: RAIZ
};
