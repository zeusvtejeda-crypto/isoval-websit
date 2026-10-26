'use strict';
/*
 * tests/smoke.js — prueba E2E de VILLEDA Finanzas completa (docs/ARQUITECTURA.md §6) con los diez módulos.
 *
 *   node tests/smoke.js            → "OK n comprobaciones" y código 0, o lista de fallos y código 1.
 *
 * Servidor http local (tests/servidor.js) + Playwright chromium (tests/ayuda.js). Escenarios:
 *   0. node --check de todos los .js del proyecto (núcleo, módulos, app, sw, pruebas).
 *   A. Móvil 390×844 claro, http: bloqueo y validaciones; crear con datos de ejemplo → panel con KPIs = VF.calc;
 *      las 11 rutas sin pageerror/console.error, con título, ámbito en la cabecera y sin scroll horizontal; hoja "Más"
 *      con todas las rutas nav:'mas'; alta de gasto empresa por la interfaz y saldo en pantalla; transferencia
 *      empresa→personal (Retiro de socio) que no altera la utilidad del panel; el asistente responde las 5 preguntas
 *      del brief (chips) con el intent correcto y cifras MXN iguales a VF.calc; bloquear, contraseña incorrecta,
 *      desbloquear; bóveda cifrada; recarga → bloqueo → desbloquear → datos (incluidos los nuevos) persisten.
 *   B. Escritorio 1280×800 oscuro, http: nav lateral; las 11 rutas (enlace activo, ámbito, sin scroll horizontal);
 *      enlaces entre módulos (#/facturas?id=, #/proveedores?pestana=&id=, #/presupuestos?ambito=&periodo=,
 *      #/asistente?pregunta=, #/empresa?cuenta=, #/prestamos?id=, #/panel?ambito=); registrar pago de factura →
 *      estado 'pagada'; pago de CxP y de préstamo crean movimiento vinculado; alta de presupuesto; CSV de movimientos
 *      (descarga real: BOM, encabezado, filas del ámbito y periodo); exportar respaldo cifrado y plano; importar el
 *      cifrado restaura el estado exacto; borrar datos de ejemplo → 0 ids _demo; botón de tema; borrar todo desde
 *      Ajustes → pantalla "Crear contraseña".
 *   C. file:// (escritorio claro): carga sin errores, 9 espacios de nombres del núcleo + 10 de módulos, crear, 11 rutas, recargar, desbloquear.
 *   D. Móvil oscuro: capturas de panel/empresa/facturas/asistente; "Olvidé mi contraseña" con cancelaciones y doble confirmación
 *      → bóveda borrada → crear de nuevo (bóveda vacía sin ceros falsos).
 * VF_SMOKE=B,C limita los escenarios de navegador (el 0 siempre corre). Capturas (claro/oscuro, móvil/escritorio) en tests/capturas/smoke-*.png.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ayuda = require('./ayuda');

const CONTRASENA = 'Prueba-Segura-2026';
const RUTAS = ['panel', 'empresa', 'personal', 'facturas', 'cobros', 'proveedores', 'prestamos', 'presupuestos', 'reportes', 'asistente', 'ajustes'];
const RUTAS_PRINCIPALES = ['panel', 'empresa', 'personal', 'asistente'];
const RUTAS_MAS = ['facturas', 'proveedores', 'prestamos', 'presupuestos', 'reportes', 'ajustes'];
const RE_MXN = /\$\s?\d{1,3}(,\d{3})*\.\d{2}/;
const PREGUNTAS_BRIEF = [
  { pregunta: '¿Cuánto dinero tengo disponible entre todas mis cuentas?', intent: 'disponible_total' },
  { pregunta: '¿Cuánto gastó VILLEDA esta semana?', intent: 'gastos_periodo' },
  { pregunta: '¿Qué clientes todavía me deben?', intent: 'por_cobrar' },
  { pregunta: '¿Cuánto puedo gastar personalmente sin afectar los pagos del negocio?', intent: 'disponible_personal' },
  { pregunta: '¿Qué pagos y cobros tengo pendientes mañana?', intent: 'vencimientos' }
];

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
function cerca(a, b, mensaje) {
  return comprobar(Math.abs(Number(a) - Number(b)) < 0.006, mensaje + ' (esperado ' + b + ', obtenido ' + a + ')');
}
function sinErrores(page, momento) {
  const errs = ayuda.recogerErrores(page);
  const fin = errs.length;
  comprobar(fin === 0, 'sin errores de consola ' + momento + (fin ? ': ' + errs.map(function (e) { return e.tipo + ' ' + e.texto; }).join(' | ') : ''));
  errs.length = 0; // no volver a reportar los mismos
}
async function visible(page, selector) { return page.isVisible(selector); }
async function textoDe(page, selector) { return (await page.textContent(selector) || '').trim(); }
async function irA(page, hash) {
  await page.evaluate(function (h) { location.hash = h; }, hash);
  const ruta = hash.replace(/^#\//, '').split('?')[0];
  await page.waitForFunction(function (r) {
    var v = document.querySelector('#vista');
    return v && v.getAttribute('data-ruta') === r && v.querySelector('h1');
  }, ruta);
  await page.waitForTimeout(ayuda.ESPERA_REPINTADO_MS);
}
/** Devuelve el campo n (base 0) de una línea CSV con comillas escapadas "" (VF.util.csv). */
function campoCSV(linea, n) {
  var campos = []; var actual = ''; var enComillas = false;
  for (var i = 0; i < linea.length; i++) {
    var ch = linea[i];
    if (enComillas) {
      if (ch === '"') { if (linea[i + 1] === '"') { actual += '"'; i += 1; } else enComillas = false; }
      else actual += ch;
    } else if (ch === '"') enComillas = true;
    else if (ch === ',') { campos.push(actual); actual = ''; }
    else actual += ch;
  }
  campos.push(actual);
  return campos[n] == null ? '' : campos[n];
}
function ultimoModal(page) { return page.locator('.modal-fondo .modal').last(); }
async function pulsarEnModal(page, selector) { await ultimoModal(page).locator(selector).first().click(); }
async function cerrarModales(page) {
  await page.evaluate(function () { VF.ui.cerrarModales(); });
  await ayuda.esperarSinModal(page);
}
/** Ámbito que debe mostrar la cabecera en cada ruta (regla documentada en router.js). */
async function ambitoEsperado(page, ruta) {
  return page.evaluate(function (r) {
    var fijo = { empresa: 'empresa', personal: 'personal', facturas: 'empresa', cobros: 'empresa', proveedores: 'empresa' };
    var a = null;
    if (fijo[r]) a = fijo[r];
    else if (r === 'panel' && VF.panel) a = VF.panel.ambito();
    else if (r === 'prestamos' && VF.prestamos) a = VF.prestamos.ambito();
    else if (r === 'presupuestos' && VF.presupuestos) a = VF.presupuestos.ambito();
    else if (r === 'reportes' && VF.reportes) a = VF.reportes.ambito();
    var badge = a === 'empresa' ? 'Empresa' : a === 'personal' ? 'Personal' : a === 'combinado' ? 'Combinado' : '';
    return { atributo: a === 'empresa' || a === 'personal' ? a : null, badge: badge };
  }, ruta);
}

/** Visita las 11 rutas: título, contenido, ámbito, navegación activa, sin scroll horizontal; capturas opcionales. */
async function visitarRutas(page, modo, capturas) {
  for (const ruta of RUTAS) {
    await irA(page, '#/' + ruta);
    const titulo = await page.title();
    comprobar(/ · VILLEDA Finanzas$/.test(titulo) && !/^Sección/.test(titulo), modo + ' ruta ' + ruta + ': document.title "' + titulo + '"');
    const texto = await textoDe(page, '#vista');
    comprobar(texto.length > 40 && !/Página no encontrada|Ocurrió un error|Módulo no disponible/.test(texto), modo + ' ruta ' + ruta + ' renderiza contenido real');
    const esperado = await ambitoEsperado(page, ruta);
    igual(await page.getAttribute('html', 'data-ambito'), esperado.atributo, modo + ' ruta ' + ruta + ': data-ambito');
    igual(await textoDe(page, '#badge-ambito'), esperado.badge, modo + ' ruta ' + ruta + ': badge de ámbito en la cabecera');
    if (modo === 'escritorio') {
      const activo = await page.evaluate(function () {
        var a = document.querySelector('#nav-lateral .nav-item[aria-current="page"]');
        return a ? a.getAttribute('href') : null;
      });
      igual(activo, '#/' + (ruta === 'cobros' ? 'facturas' : ruta), modo + ' ruta ' + ruta + ': enlace lateral activo');
    } else {
      const activo = await page.evaluate(function () {
        var a = document.querySelector('#nav-inferior [aria-current="page"]');
        return a ? (a.getAttribute('href') || 'mas') : null;
      });
      igual(activo, RUTAS_PRINCIPALES.indexOf(ruta) >= 0 ? '#/' + ruta : 'mas', modo + ' ruta ' + ruta + ': pestaña inferior activa');
    }
    comprobar(!(await ayuda.hayScrollHorizontal(page)), modo + ' ruta ' + ruta + ': sin scroll horizontal');
    if (capturas && capturas.rutas.indexOf(ruta) >= 0) {
      await ayuda.quitarToasts(page);
      await ayuda.captura(page, 'smoke-' + ruta + '-' + capturas.sufijo);
    }
  }
  sinErrores(page, modo + ': tras visitar las 11 rutas');
}

/* ---------------------------------------------------------------- 0 ---- */
function escenarioSintaxis() {
  escenarioActual = '0 node --check';
  console.log('Escenario ' + escenarioActual);
  const raiz = ayuda.RAIZ;
  const archivos = [];
  ['js/core', 'js/modules', 'js', 'tests', '.'].forEach(function (dir) {
    fs.readdirSync(path.join(raiz, dir)).forEach(function (f) {
      if (/\.js$/.test(f)) archivos.push(path.join(dir, f).replace(/^\.\//, ''));
    });
  });
  archivos.sort();
  comprobar(archivos.length >= 23, 'archivos .js encontrados: ' + archivos.length + ' (≥ 23)');
  archivos.forEach(function (f) {
    const r = spawnSync(process.execPath, ['--check', path.join(raiz, f)], { encoding: 'utf8' });
    comprobar(r.status === 0, 'node --check ' + f + (r.status === 0 ? '' : ': ' + (r.stderr || '').split('\n').slice(0, 2).join(' ')));
  });
  const modulos = ['panel', 'empresa', 'personal', 'facturas', 'proveedores', 'prestamos', 'presupuestos', 'reportes', 'asistente', 'ajustes'];
  modulos.forEach(function (m) { comprobar(archivos.indexOf('js/modules/' + m + '.js') >= 0, 'existe js/modules/' + m + '.js'); });
  // Service worker y manifest cubren todos los archivos de la app
  const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
  const esperadosSW = ['./index.html', './manifest.webmanifest', './css/app.css', './js/app.js']
    .concat(['util', 'crypto', 'store', 'seed', 'calc', 'ui', 'router'].map(function (n) { return './js/core/' + n + '.js'; }))
    .concat(modulos.map(function (m) { return './js/modules/' + m + '.js'; }))
    .concat(fs.readdirSync(path.join(raiz, 'icons')).map(function (i) { return './icons/' + i; }));
  esperadosSW.forEach(function (ruta) { comprobar(sw.indexOf("'" + ruta + "'") >= 0, 'sw.js precachea ' + ruta); });
  const manifest = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.webmanifest'), 'utf8'));
  comprobar(manifest.icons.every(function (i) { return fs.existsSync(path.join(raiz, i.src)); }), 'manifest: todos los iconos existen');
  comprobar(manifest.start_url === './index.html' && manifest.display === 'standalone', 'manifest: start_url e display');
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  comprobar(/<meta name="robots" content="noindex, nofollow">/.test(html), 'index.html lleva <meta name="robots" content="noindex, nofollow">');
  modulos.forEach(function (m) { comprobar(html.indexOf('./js/modules/' + m + '.js') >= 0, 'index.html carga js/modules/' + m + '.js'); });
}

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

  // Crear con datos de ejemplo → shell
  await ayuda.crearBoveda(page, CONTRASENA, true);
  comprobar(await visible(page, '#app'), '#app visible tras crear la bóveda');
  comprobar(!(await visible(page, '#pantalla-bloqueo')), 'pantalla de bloqueo oculta tras crear');
  comprobar(await visible(page, '#nav-inferior'), 'nav inferior visible en móvil');
  comprobar(!(await visible(page, '#nav-lateral')), 'nav lateral oculto en móvil');
  igual(await page.locator('#nav-inferior .nav-item').count(), 5, 'nav inferior con 5 pestañas');
  igual(await textoDe(page, '#nav-inferior'), 'PanelEmpresaPersonalAsistenteMás', 'pestañas inferiores: Panel, Empresa, Personal, Asistente, Más');
  comprobar(await visible(page, '#banner-ejemplo'), 'banner de datos de ejemplo visible');
  comprobar(/^#\/panel/.test(await page.evaluate(function () { return location.hash; })), 'ruta vacía → #/panel');
  igual(await page.title(), 'Panel · VILLEDA Finanzas', 'document.title de la ruta');
  comprobar(await page.evaluate(function () { return document.activeElement === document.querySelector('#vista h1'); }), 'foco en el h1 de la vista');
  igual(await page.evaluate(function () { return VF.store.estado().cuentas.length; }), 7, 'seed cargado: 7 cuentas');

  // Panel con KPIs no vacíos e iguales a VF.calc
  const kpis = await page.evaluate(function () {
    var est = VF.store.estado();
    var h = VF.calc.hoy();
    var u = VF.calc.utilidadMes(est);
    var ing = VF.calc.ingresos(est, 'empresa', VF.util.inicioMes(h), VF.util.finMes(h));
    var d = VF.calc.disponibleEmpresa(est);
    var leer = function (titulo) {
      var nodos = document.querySelectorAll('#panel-cuerpo .kpi');
      for (var i = 0; i < nodos.length; i++) {
        if (nodos[i].querySelector('.kpi-titulo').textContent.trim() === titulo) return nodos[i].querySelector('.kpi-valor').textContent.trim();
      }
      return null;
    };
    return {
      n: document.querySelectorAll('#panel-cuerpo .kpi').length,
      utilidad: leer('Utilidad del mes'), utilidadEsperada: VF.util.fmtMXN(u.utilidad),
      ingresos: leer('Ingresos del mes'), ingresosEsperados: VF.util.fmtMXN(ing),
      disponible: leer('Disponible'), disponibleEsperado: VF.util.fmtMXN(d.disponible),
      ambito: VF.panel.ambito()
    };
  });
  comprobar(kpis.n >= 4, 'panel con al menos 4 KPIs (' + kpis.n + ')');
  igual(kpis.ambito, 'empresa', 'panel abre en Empresa');
  igual(kpis.utilidad, kpis.utilidadEsperada, 'KPI "Utilidad del mes" = VF.calc.utilidadMes');
  igual(kpis.ingresos, kpis.ingresosEsperados, 'KPI "Ingresos del mes" = VF.calc.ingresos');
  igual(kpis.disponible, kpis.disponibleEsperado, 'KPI "Disponible" = VF.calc.disponibleEmpresa');
  comprobar(RE_MXN.test(kpis.utilidad || ''), 'los KPIs muestran cifras MXN, no vacíos');
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'panel móvil: sin scroll horizontal');
  await ayuda.quitarToasts(page);
  await ayuda.captura(page, 'smoke-panel-movil-claro');
  sinErrores(page, 'tras crear la bóveda (móvil)');

  // Las 11 rutas en móvil (sin scroll horizontal) + capturas claras
  await visitarRutas(page, 'movil', { rutas: ['empresa', 'facturas'], sufijo: 'movil-claro' });

  // Hoja "Más": todas las rutas nav:'mas' y ninguna otra
  await irA(page, '#/panel');
  await ayuda.quitarToasts(page);
  await page.click('#nav-inferior [data-nav-mas]');
  await page.waitForSelector('.modal-hoja', { state: 'visible' });
  const enlacesMas = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.modal-hoja .hoja-mas .nav-item'), function (a) { return a.getAttribute('href').replace('#/', ''); });
  });
  igual(enlacesMas.join(','), RUTAS_MAS.join(','), 'hoja "Más" lista exactamente las rutas nav:"mas" (' + enlacesMas.join(',') + ')');
  const rutasMasRegistradas = await page.evaluate(function () {
    return VF.router.rutas().filter(function (r) { return r.nav === 'mas'; }).map(function (r) { return r.ruta; }).sort().join(',');
  });
  igual(rutasMasRegistradas, RUTAS_MAS.slice().sort().join(','), 'VF.router.rutas() nav:"mas" coincide con la hoja');
  await ayuda.captura(page, 'smoke-hoja-mas-movil-claro');
  await page.click('.modal-hoja .nav-item[href="#/ajustes"]');
  await page.waitForFunction(function () { return location.hash === '#/ajustes' && !document.querySelector('.modal-fondo'); });
  igual(await page.title(), 'Ajustes · VILLEDA Finanzas', 'navegar desde la hoja "Más" cierra el modal y cambia el título');

  // Alta de gasto empresa por la interfaz → saldo de la cuenta en pantalla
  await irA(page, '#/empresa');
  const CUENTA_GASTO = 'cta_emp_banorte_demo';
  const saldoAntes = await page.evaluate(function (id) { return VF.calc.saldoCuenta(VF.store.estado(), id); }, CUENTA_GASTO);
  await page.locator('[data-accion="ambito-nuevo-movimiento"][data-tipo="gasto"]').first().click();
  await ayuda.esperarModal(page, { titulo: 'Nuevo gasto' });
  await ayuda.llenarCampo(page, 'cuentaId', CUENTA_GASTO);
  await ayuda.llenarCampo(page, 'monto', '1,234.56');
  await ayuda.llenarCampo(page, 'categoria', 'Materiales');
  await ayuda.llenarCampo(page, 'descripcion', 'Prueba smoke gasto');
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'modal de gasto en 390 px: sin scroll horizontal');
  await pulsarEnModal(page, '.modal-pie .btn-primario');
  await ayuda.esperarSinModal(page);
  const gasto = await page.evaluate(function (id) {
    var est = VF.store.estado();
    var m = est.movimientos.filter(function (x) { return x.descripcion === 'Prueba smoke gasto'; })[0];
    var tarjeta = document.querySelector('.kpi[data-accion="ambito-ver-cuenta"][data-id="' + id + '"] .kpi-valor[data-saldo]');
    return { mov: m ? { ambito: m.ambito, tipo: m.tipo, monto: m.monto, cuentaId: m.cuentaId, categoria: m.categoria } : null,
      saldo: VF.calc.saldoCuenta(est, id), enPantalla: tarjeta ? tarjeta.textContent.trim() : null, fmt: VF.util.fmtMXN(VF.calc.saldoCuenta(est, id)),
      enTabla: /Prueba smoke gasto/.test((document.querySelector('.ambito-movimientos') || document.querySelector('#vista')).textContent) };
  }, CUENTA_GASTO);
  comprobar(gasto.mov && gasto.mov.ambito === 'empresa' && gasto.mov.tipo === 'gasto' && gasto.mov.monto === 1234.56 && gasto.mov.cuentaId === CUENTA_GASTO && gasto.mov.categoria === 'Materiales',
    'gasto guardado con ámbito empresa, monto 1234.56, cuenta y categoría (' + JSON.stringify(gasto.mov) + ')');
  cerca(gasto.saldo, saldoAntes - 1234.56, 'saldo de la cuenta = anterior − 1234.56');
  igual(gasto.enPantalla, gasto.fmt, 'la tarjeta de la cuenta muestra el saldo nuevo');
  comprobar(gasto.enTabla, 'el gasto aparece en la tabla de movimientos');

  // Transferencia empresa → personal (Retiro de socio) no altera la utilidad del panel
  const antes = await page.evaluate(function () {
    var est = VF.store.estado(); var h = VF.calc.hoy();
    return { utilidad: VF.calc.utilidadMes(est).utilidad, ingP: VF.calc.ingresos(est, 'personal', VF.util.inicioMes(h), VF.util.finMes(h)),
      gasP: VF.calc.gastos(est, 'personal', VF.util.inicioMes(h), VF.util.finMes(h)), origen: VF.calc.saldoCuenta(est, 'cta_emp_bbva_demo'), destino: VF.calc.saldoCuenta(est, 'cta_per_nu_demo'), n: est.movimientos.length };
  });
  await page.locator('[data-accion="ambito-nuevo-movimiento"][data-tipo="transferencia"]').first().click();
  await ayuda.esperarModal(page, { titulo: 'Nueva transferencia' });
  await ayuda.llenarCampo(page, 'cuentaId', 'cta_emp_bbva_demo');
  await ayuda.llenarCampo(page, 'cuentaDestinoId', 'cta_per_nu_demo');
  await ayuda.llenarCampo(page, 'monto', '5000');
  await ayuda.llenarCampo(page, 'descripcion', 'Prueba smoke transferencia');
  comprobar(/Retiro de socio/.test(await ultimoModal(page).textContent()), 'el formulario avisa "Retiro de socio" al cruzar ámbitos');
  await pulsarEnModal(page, '.modal-pie .btn-primario');
  await ayuda.esperarSinModal(page);
  const despues = await page.evaluate(function () {
    var est = VF.store.estado(); var h = VF.calc.hoy();
    var m = est.movimientos.filter(function (x) { return x.descripcion === 'Prueba smoke transferencia'; })[0];
    return { utilidad: VF.calc.utilidadMes(est).utilidad, ingP: VF.calc.ingresos(est, 'personal', VF.util.inicioMes(h), VF.util.finMes(h)),
      gasP: VF.calc.gastos(est, 'personal', VF.util.inicioMes(h), VF.util.finMes(h)), origen: VF.calc.saldoCuenta(est, 'cta_emp_bbva_demo'), destino: VF.calc.saldoCuenta(est, 'cta_per_nu_demo'), n: est.movimientos.length,
      mov: m ? { ambito: m.ambito, tipo: m.tipo, categoria: m.categoria, monto: m.monto } : null };
  });
  igual(despues.n, antes.n + 1, 'la transferencia creó un solo movimiento');
  comprobar(despues.mov && despues.mov.ambito === 'empresa' && despues.mov.tipo === 'transferencia' && despues.mov.categoria === 'Retiro de socio' && despues.mov.monto === 5000,
    'transferencia cruzada registrada como "Retiro de socio" en ámbito empresa (' + JSON.stringify(despues.mov) + ')');
  cerca(despues.utilidad, antes.utilidad, 'utilidad de empresa intacta tras la transferencia');
  cerca(despues.ingP, antes.ingP, 'ingresos personales intactos');
  cerca(despues.gasP, antes.gasP, 'gastos personales intactos');
  cerca(despues.origen, antes.origen - 5000, 'saldo origen −5,000');
  cerca(despues.destino, antes.destino + 5000, 'saldo destino +5,000');
  await irA(page, '#/panel');
  const kpiUtilidad = await page.evaluate(function () {
    var nodos = document.querySelectorAll('#panel-cuerpo .kpi');
    for (var i = 0; i < nodos.length; i++) if (nodos[i].querySelector('.kpi-titulo').textContent.trim() === 'Utilidad del mes') return nodos[i].querySelector('.kpi-valor').textContent.trim();
    return null;
  });
  igual(kpiUtilidad, await page.evaluate(function (u) { return VF.util.fmtMXN(u); }, antes.utilidad), 'el KPI "Utilidad del mes" del panel no cambió con la transferencia');
  sinErrores(page, 'tras alta de gasto y transferencia');

  // Asistente: las 5 preguntas del brief con intent correcto y cifras MXN = VF.calc
  await irA(page, '#/asistente');
  igual(await page.locator('#asistente-chips .chip').count(), 9, 'asistente: 9 chips sugeridos');
  for (let i = 0; i < PREGUNTAS_BRIEF.length; i++) {
    const q = PREGUNTAS_BRIEF[i];
    const chip = page.locator('#asistente-chips .chip[data-pregunta="' + q.pregunta.replace(/"/g, '\\"') + '"]');
    igual(await chip.count(), 1, 'chip ' + (i + 1) + ' presente: ' + q.pregunta);
    await chip.click();
    await page.waitForFunction(function (n) { return document.querySelectorAll('#asistente-chat article[data-rol="asistente"]').length >= n; }, i + 1);
    await page.waitForTimeout(ayuda.ESPERA_REPINTADO_MS);
    const r = await page.evaluate(function (datos) {
      var arts = document.querySelectorAll('#asistente-chat article[data-rol="asistente"]');
      var a = arts[arts.length - 1];
      var est = VF.store.estado(); var h = VF.calc.hoy(); var fmt = VF.util.fmtMXN;
      var esperadas = [], alternativas = [];
      if (datos.intent === 'disponible_total') {
        esperadas = [fmt(VF.calc.saldosPorAmbito(est, 'empresa').liquido), fmt(VF.calc.saldosPorAmbito(est, 'personal').liquido)];
      } else if (datos.intent === 'gastos_periodo') {
        alternativas = [fmt(VF.calc.gastos(est, 'empresa', VF.util.inicioSemana(h), h)), fmt(VF.calc.gastos(est, 'empresa', VF.util.sumarDias(h, -6), h)), fmt(VF.calc.gastos(est, 'empresa', VF.util.sumarDias(h, -29), h))];
      } else if (datos.intent === 'por_cobrar') {
        esperadas = [fmt(VF.calc.porCobrar(est).total)];
      } else if (datos.intent === 'disponible_personal') {
        esperadas = [fmt(VF.calc.disponiblePersonal(est, 30).disponible)];
      } else if (datos.intent === 'vencimientos') {
        var m = VF.util.sumarDias(h, 1);
        esperadas = VF.calc.vencimientos(est, m, m).map(function (v) { return fmt(v.monto); });
        if (!esperadas.length) {
          var prox = VF.calc.vencimientos(est, m, null)[0];
          alternativas = prox ? [fmt(prox.monto)] : [];
        }
      }
      return { intent: a.getAttribute('data-intent'), texto: a.textContent, esperadas: esperadas, alternativas: alternativas,
        enlace: !!a.querySelector('a[href^="#/"]'), usuario: document.querySelectorAll('#asistente-chat [data-rol="usuario"]').length };
    }, q);
    igual(r.intent, q.intent, 'pregunta ' + (i + 1) + ': intent');
    comprobar(RE_MXN.test(r.texto), 'pregunta ' + (i + 1) + ': la respuesta contiene una cifra en MXN');
    const faltan = r.esperadas.filter(function (c) { return r.texto.indexOf(c) < 0; });
    comprobar(faltan.length === 0, 'pregunta ' + (i + 1) + ': cifras de VF.calc presentes (' + r.esperadas.join(' / ') + ')' + (faltan.length ? ' faltan: ' + faltan.join(' / ') : ''));
    if (r.alternativas.length) {
      comprobar(r.alternativas.some(function (c) { return r.texto.indexOf(c) >= 0; }), 'pregunta ' + (i + 1) + ': alguna cifra de referencia de VF.calc presente (' + r.alternativas.join(' / ') + ')');
    }
    if (q.intent === 'por_cobrar' || q.intent === 'disponible_personal') comprobar(r.enlace, 'pregunta ' + (i + 1) + ': enlace "Ver detalle"');
    igual(r.usuario, i + 1, 'pregunta ' + (i + 1) + ': burbuja del usuario añadida');
  }
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'asistente con respuestas: sin scroll horizontal');
  await ayuda.quitarToasts(page);
  await ayuda.captura(page, 'smoke-asistente-movil-claro');
  sinErrores(page, 'tras las 5 preguntas del brief');

  // Bloquear → contraseña incorrecta → desbloquear
  await ayuda.bloquear(page);
  comprobar(await visible(page, '#pantalla-bloqueo'), 'bloquear muestra la pantalla de bloqueo');
  comprobar(!(await visible(page, '#app')), 'bloquear oculta #app');
  comprobar(await page.evaluate(function () { return !VF.store.estaDesbloqueado() && VF.store.estado() === null; }), 'bloquear borra el estado de memoria');
  igual(await page.evaluate(function () { return document.querySelector('#vista').innerHTML; }), '', 'bloquear vacía <main>');
  igual(await page.evaluate(function () { return VF.asistente.historial().length; }), 0, 'bloquear borra el historial del asistente');
  const malo = await ayuda.desbloquear(page, 'incorrecta-123');
  comprobar(malo === false, 'contraseña incorrecta no desbloquea');
  igual(await textoDe(page, '#desbloquear-error'), 'Contraseña incorrecta.', 'mensaje "Contraseña incorrecta."');
  comprobar(!(await visible(page, '#app')), '#app sigue oculto tras contraseña incorrecta');
  await ayuda.captura(page, 'smoke-bloqueo-incorrecta-movil-claro');
  comprobar(await ayuda.desbloquear(page, CONTRASENA), 'contraseña correcta desbloquea');
  comprobar(!(await visible(page, '#desbloquear-error')), 'error oculto tras desbloquear');

  // Bóveda cifrada en localStorage
  const boveda = await page.evaluate(function () {
    var crudo = localStorage.getItem('vf.boveda.v1') || '';
    var obj = {}; try { obj = JSON.parse(crudo); } catch (e) { /* vacío */ }
    return { longitud: crudo.length, claves: Object.keys(obj).sort().join(','), contieneTexto: /VILLEDA|Nómina|BBVA|cuentas|Prueba smoke/.test(crudo) };
  });
  comprobar(boveda.longitud > 1000, 'bóveda persistida en localStorage (' + boveda.longitud + ' caracteres)');
  igual(boveda.claves, 'datos,iv,salt,verificador,version', 'formato de bóveda {version, salt, iv, datos, verificador}');
  comprobar(!boveda.contieneTexto, 'el texto almacenado está cifrado (no aparecen nombres ni descripciones)');

  // Recarga → bloqueo → desbloquear → datos (incluidos los nuevos) persisten
  await page.reload({ waitUntil: 'load' });
  comprobar(await visible(page, '#form-desbloquear'), 'tras recargar pide contraseña');
  comprobar(!(await visible(page, '#form-crear')), 'tras recargar no ofrece crear');
  comprobar(await ayuda.desbloquear(page, CONTRASENA), 'desbloquea tras recargar');
  const resumen = await page.evaluate(function () {
    var e = VF.store.estado();
    return { cuentas: e.cuentas.length, movimientos: e.movimientos.length, facturas: e.facturas.length, ejemplo: e.ajustes.datosEjemplo,
      nuevos: e.movimientos.filter(function (m) { return /^Prueba smoke/.test(m.descripcion || ''); }).length };
  });
  igual(resumen.cuentas, 7, 'persisten las 7 cuentas');
  comprobar(resumen.movimientos >= 72, 'persisten ≥72 movimientos (' + resumen.movimientos + ')');
  igual(resumen.nuevos, 2, 'persisten el gasto y la transferencia creados por la interfaz');
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

  await ayuda.crearBoveda(page, CONTRASENA, true);
  comprobar(await visible(page, '#nav-lateral'), 'nav lateral visible en escritorio');
  comprobar(!(await visible(page, '#nav-inferior')), 'nav inferior oculto en escritorio');
  igual(await page.locator('#nav-lateral .nav-item').count(), 10, 'nav lateral con 10 enlaces (cobros es alias sin nav)');
  comprobar(!(await ayuda.hayScrollHorizontal(page)), 'escritorio oscuro: sin scroll horizontal');
  sinErrores(page, 'tras crear la bóveda (escritorio)');

  // Las 11 rutas en escritorio oscuro + capturas oscuras
  await visitarRutas(page, 'escritorio', { rutas: ['panel', 'empresa', 'facturas', 'asistente'], sufijo: 'escritorio-oscuro' });

  // Ruta desconocida
  await page.evaluate(function () { location.hash = '#/inexistente'; });
  await page.waitForFunction(function () { return /Página no encontrada/.test(document.querySelector('#vista').textContent); });
  comprobar(true, 'ruta desconocida muestra "Página no encontrada"');
  igual(await page.getAttribute('html', 'data-ambito'), null, 'ruta desconocida sin ámbito en la cabecera');

  // Enlaces entre módulos
  await irA(page, '#/facturas?id=fac_0006_demo');
  await ayuda.esperarModal(page, { titulo: 'Factura F-0006' });
  comprobar(true, '#/facturas?id= abre el detalle de la factura');
  await cerrarModales(page);

  await irA(page, '#/proveedores?pestana=cxp&id=cxp_04_demo');
  await ayuda.esperarModal(page);
  igual(await page.evaluate(function () { return VF.proveedores.pestana(); }), 'cxp', '#/proveedores?pestana=cxp fija la pestaña');
  comprobar(await page.evaluate(function () { return document.querySelector('.pestana[aria-selected="true"]').getAttribute('data-valor') === 'cxp'; }), 'pestaña "Cuentas por pagar" seleccionada');
  comprobar(/Pendiente de pagar|Cuenta por pagar/.test(await ultimoModal(page).textContent()), '#/proveedores?id= abre el detalle de la CxP');
  igual(await page.evaluate(function () { return location.hash; }), '#/proveedores', 'el hash se limpia tras abrir el detalle');
  await cerrarModales(page);

  const periodoAnterior = await page.evaluate(function () { return VF.util.periodo(VF.util.sumarDias(VF.util.inicioMes(VF.calc.hoy()), -1)); });
  await irA(page, '#/presupuestos?ambito=personal&periodo=' + periodoAnterior);
  igual(await page.evaluate(function () { return VF.presupuestos.ambito() + '|' + VF.presupuestos.periodo(); }), 'personal|' + periodoAnterior, '#/presupuestos?ambito=&periodo= preselecciona ámbito y mes');
  igual(await page.getAttribute('html', 'data-ambito'), 'personal', 'presupuestos personal → cabecera en verde');

  await irA(page, '#/asistente?pregunta=' + encodeURIComponent('¿Qué clientes todavía me deben?'));
  await page.waitForSelector('#asistente-chat article[data-intent="por_cobrar"]');
  comprobar(true, '#/asistente?pregunta= responde al entrar');
  igual(await page.evaluate(function () { return location.hash; }), '#/asistente', 'el hash del asistente se limpia tras responder');
  igual(await page.getAttribute('html', 'data-ambito'), null, 'asistente sin ámbito en la cabecera (no hereda el de presupuestos)');

  await irA(page, '#/empresa?cuenta=cta_emp_caja_demo');
  igual(await page.inputValue('#ambito-filtro-cuentaId'), 'cta_emp_caja_demo', '#/empresa?cuenta= filtra los movimientos por esa cuenta');
  igual(await page.evaluate(function () { return location.hash; }), '#/empresa', 'el hash de empresa se limpia tras aplicar el filtro');

  await irA(page, '#/prestamos?id=pre_per_auto_demo');
  await ayuda.esperarModal(page);
  igual(await page.evaluate(function () { return VF.prestamos.ambito(); }), 'personal', '#/prestamos?id= cambia al ámbito del préstamo');
  igual(await page.getAttribute('html', 'data-ambito'), 'personal', 'préstamos personal → cabecera en verde');
  await cerrarModales(page);

  await irA(page, '#/panel?ambito=combinado');
  igual(await page.evaluate(function () { return VF.panel.ambito(); }), 'combinado', '#/panel?ambito=combinado');
  igual(await textoDe(page, '#badge-ambito'), 'Combinado', 'badge "Combinado" en la cabecera');
  igual(await page.getAttribute('html', 'data-ambito'), null, 'combinado sin acento de color');
  comprobar(/solo informativo/i.test(await textoDe(page, '#vista')), 'el combinado se etiqueta "solo informativo"');
  await irA(page, '#/panel?ambito=empresa');
  igual(await page.getAttribute('html', 'data-ambito'), 'empresa', '#/panel?ambito=empresa');
  await irA(page, '#/ajustes');
  igual(await textoDe(page, '#badge-ambito'), '', 'ajustes: la cabecera no conserva el ámbito del panel');
  sinErrores(page, 'tras los enlaces entre módulos');

  // Registrar pago de factura → estado 'pagada'
  await irA(page, '#/facturas?id=fac_0006_demo');
  await ayuda.esperarModal(page, { titulo: 'Factura F-0006' });
  igual(await page.evaluate(function () { var f = VF.store.obtener('facturas', 'fac_0006_demo'); return VF.calc.estadoFactura(f, VF.calc.hoy()); }), 'emitida', 'factura F-0006 empieza "emitida"');
  await pulsarEnModal(page, '[data-accion="fac-registrar-pago"]');
  await ayuda.esperarModal(page, { titulo: 'Registrar pago' });
  const pendienteF = await page.evaluate(function () { return VF.calc.pendienteFactura(VF.store.obtener('facturas', 'fac_0006_demo')); });
  igual(await ultimoModal(page).locator('[data-campo="monto"]').inputValue(), pendienteF.toFixed(2), 'el monto propuesto es el pendiente de la factura');
  await ayuda.llenarCampo(page, 'cuentaId', 'cta_emp_bbva_demo');
  const saldoAntesF = await page.evaluate(function () { return VF.calc.saldoCuenta(VF.store.estado(), 'cta_emp_bbva_demo'); });
  await pulsarEnModal(page, '.modal-pie .btn-primario');
  await page.waitForFunction(function () { return document.querySelectorAll('.modal-fondo .modal').length === 1; });
  await page.waitForTimeout(ayuda.ESPERA_REPINTADO_MS);
  const pagoF = await page.evaluate(function () {
    var est = VF.store.estado();
    var f = VF.store.obtener('facturas', 'fac_0006_demo');
    var m = est.movimientos.filter(function (x) { return x.facturaId === 'fac_0006_demo'; })[0];
    return { estado: VF.calc.estadoFactura(f, VF.calc.hoy()), pagos: f.pagos.length, mov: m ? { ambito: m.ambito, tipo: m.tipo, categoria: m.categoria, monto: m.monto } : null,
      saldo: VF.calc.saldoCuenta(est, 'cta_emp_bbva_demo'), modal: document.querySelector('.modal-fondo .modal').textContent };
  });
  igual(pagoF.estado, 'pagada', 'registrar el pago total cambia el estado a "pagada"');
  igual(pagoF.pagos, 1, 'la factura guarda el pago');
  comprobar(pagoF.mov && pagoF.mov.ambito === 'empresa' && pagoF.mov.tipo === 'ingreso' && pagoF.mov.categoria === 'Ventas' && Math.abs(pagoF.mov.monto - pendienteF) < 0.006,
    'el pago creó un ingreso "Ventas" de empresa vinculado a la factura (' + JSON.stringify(pagoF.mov) + ')');
  cerca(pagoF.saldo, saldoAntesF + pendienteF, 'saldo de la cuenta +pendiente');
  comprobar(/Pagada/.test(pagoF.modal), 'el detalle abierto se refresca y muestra "Pagada"');
  await cerrarModales(page);

  // Registrar pago de cuenta por pagar → movimiento gasto 'Proveedores' con cxpId
  await irA(page, '#/proveedores?pestana=cxp');
  await page.locator('[data-accion="prov-pagar-cxp"][data-id="cxp_05_demo"]').first().click();
  await ayuda.esperarModal(page, { titulo: 'Registrar pago' });
  const pendienteC = await page.evaluate(function () { return VF.calc.pendienteCxP(VF.store.obtener('cuentasPorPagar', 'cxp_05_demo')); });
  await ayuda.llenarCampo(page, 'cuentaId', 'cta_emp_banorte_demo');
  await pulsarEnModal(page, '.modal-pie .btn-primario');
  await page.waitForFunction(function () {
    var c = VF.store.obtener('cuentasPorPagar', 'cxp_05_demo');
    return c && c.pagos && c.pagos.length === 1;
  });
  await page.waitForTimeout(200);
  const pagoC = await page.evaluate(function () {
    var est = VF.store.estado();
    var c = VF.store.obtener('cuentasPorPagar', 'cxp_05_demo');
    var m = est.movimientos.filter(function (x) { return x.cxpId === 'cxp_05_demo'; })[0];
    return { estado: VF.calc.estadoCxP(c, VF.calc.hoy()), mov: m ? { ambito: m.ambito, tipo: m.tipo, categoria: m.categoria, monto: m.monto, cuentaId: m.cuentaId } : null, movimientoId: c.pagos[0].movimientoId === (m && m.id) };
  });
  igual(pagoC.estado, 'pagada', 'la CxP queda "pagada"');
  comprobar(pagoC.mov && pagoC.mov.ambito === 'empresa' && pagoC.mov.tipo === 'gasto' && pagoC.mov.categoria === 'Proveedores' && Math.abs(pagoC.mov.monto - pendienteC) < 0.006 && pagoC.mov.cuentaId === 'cta_emp_banorte_demo',
    'el pago de CxP creó un gasto "Proveedores" vinculado (' + JSON.stringify(pagoC.mov) + ')');
  comprobar(pagoC.movimientoId, 'el pago guarda el movimientoId');
  await cerrarModales(page);

  // Registrar pago de préstamo → movimiento gasto 'Préstamos' con prestamoId
  await irA(page, '#/prestamos?ambito=empresa');
  const prestamoAntes = await page.evaluate(function () {
    var p = VF.store.obtener('prestamos', 'pre_emp_pyme_demo');
    var prox = VF.calc.proximoPagoPrestamo(p, VF.calc.hoy());
    return { saldo: VF.calc.saldoPrestamo(p), pagos: p.pagos.length, monto: prox.monto, capital: prox.capital, interes: prox.interes, n: VF.store.estado().movimientos.length };
  });
  await page.locator('[data-accion="prestamos-pagar"][data-id="pre_emp_pyme_demo"]').first().click();
  await ayuda.esperarModal(page, { titulo: 'Registrar pago' });
  igual(await ultimoModal(page).locator('[data-campo="monto"]').inputValue(), prestamoAntes.monto.toFixed(2), 'el monto propuesto es el próximo pago (VF.calc.proximoPagoPrestamo)');
  await ayuda.llenarCampo(page, 'cuentaId', 'cta_emp_bbva_demo');
  await pulsarEnModal(page, '.modal-pie .btn-primario');
  await ayuda.esperarSinModal(page);
  const prestamoDespues = await page.evaluate(function () {
    var est = VF.store.estado();
    var p = VF.store.obtener('prestamos', 'pre_emp_pyme_demo');
    var m = est.movimientos.filter(function (x) { return x.prestamoId === 'pre_emp_pyme_demo'; }).sort(function (a, b) { return a.creado < b.creado ? 1 : -1; })[0];
    var pago = p.pagos[p.pagos.length - 1];
    return { saldo: VF.calc.saldoPrestamo(p), pagos: p.pagos.length, n: est.movimientos.length, pago: { id: pago.id, monto: pago.monto, capital: pago.capital, interes: pago.interes },
      mov: m ? { ambito: m.ambito, tipo: m.tipo, categoria: m.categoria, monto: m.monto } : null };
  });
  igual(prestamoDespues.pagos, prestamoAntes.pagos + 1, 'el préstamo registra un pago más');
  igual(prestamoDespues.n, prestamoAntes.n + 1, 'el pago de préstamo creó un movimiento');
  comprobar(prestamoDespues.mov && prestamoDespues.mov.ambito === 'empresa' && prestamoDespues.mov.tipo === 'gasto' && prestamoDespues.mov.categoria === 'Préstamos' && Math.abs(prestamoDespues.mov.monto - prestamoAntes.monto) < 0.006,
    'movimiento gasto "Préstamos" de empresa por el pago mensual (' + JSON.stringify(prestamoDespues.mov) + ')');
  cerca(prestamoDespues.pago.capital, prestamoAntes.capital, 'capital del pago = tabla de amortización');
  cerca(prestamoDespues.pago.interes, prestamoAntes.interes, 'interés del pago = tabla de amortización');
  cerca(prestamoDespues.saldo, prestamoAntes.saldo - prestamoAntes.capital, 'saldo insoluto − capital');
  // Eliminar ese pago desde el detalle revierte el movimiento y el saldo
  await irA(page, '#/prestamos?id=pre_emp_pyme_demo');
  await ayuda.esperarModal(page);
  await ultimoModal(page).locator('[data-accion="prestamos-eliminar-pago"][data-pago="' + prestamoDespues.pago.id + '"]').click();
  await page.waitForFunction(function () { return document.querySelectorAll('.modal-fondo .modal').length >= 2; });
  await page.waitForTimeout(ayuda.ESPERA_MODAL_MS);
  await ultimoModal(page).locator('.modal-pie .btn-peligro, .modal-pie .btn-primario').first().click();
  await page.waitForFunction(function (n) { return VF.store.obtener('prestamos', 'pre_emp_pyme_demo').pagos.length === n; }, prestamoAntes.pagos);
  await page.waitForTimeout(ayuda.ESPERA_REPINTADO_MS);
  const prestamoRevertido = await page.evaluate(function () {
    var est = VF.store.estado(); var p = VF.store.obtener('prestamos', 'pre_emp_pyme_demo');
    return { saldo: VF.calc.saldoPrestamo(p), n: est.movimientos.length, quedan: est.movimientos.filter(function (m) { return m.prestamoId === 'pre_emp_pyme_demo'; }).length };
  });
  igual(prestamoRevertido.n, prestamoAntes.n, 'eliminar el pago borra su movimiento');
  cerca(prestamoRevertido.saldo, prestamoAntes.saldo, 'eliminar el pago restaura el saldo insoluto');
  igual(prestamoRevertido.quedan, prestamoAntes.pagos, 'quedan sólo los movimientos de los pagos del seed');
  await cerrarModales(page);

  // Alta de presupuesto por la interfaz
  await irA(page, '#/presupuestos?ambito=empresa');
  const categoriaPpto = await page.evaluate(function () { var s = document.querySelector('#ppto-alta-categoria'); return s && s.options.length > 1 ? s.options[1].value : ''; });
  comprobar(!!categoriaPpto, 'presupuestos: hay categorías de gasto sin presupuesto para dar de alta (' + categoriaPpto + ')');
  await page.selectOption('#ppto-alta-categoria', categoriaPpto);
  await page.fill('#ppto-alta-monto', '7,500');
  await page.click('#ppto-alta-agregar');
  await page.waitForFunction(function (cat) {
    return VF.store.listar('presupuestos').some(function (p) { return p.categoria === cat && p.ambito === 'empresa'; });
  }, categoriaPpto);
  await page.waitForTimeout(ayuda.ESPERA_REPINTADO_MS);
  const ppto = await page.evaluate(function (cat) {
    var p = VF.store.listar('presupuestos').filter(function (x) { return x.categoria === cat && x.ambito === 'empresa'; })[0];
    var fila = VF.calc.presupuestoVsReal(VF.store.estado(), 'empresa', VF.presupuestos.periodo()).filter(function (f) { return f.categoria === cat; })[0];
    return { monto: p.monto, periodo: p.periodo, enTabla: new RegExp(cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(document.querySelector('#ppto-cuerpo').textContent), fila: fila ? fila.presupuesto : null };
  }, categoriaPpto);
  igual(ppto.monto, 7500, 'presupuesto guardado con monto 7,500');
  igual(ppto.periodo, await page.evaluate(function () { return VF.presupuestos.periodo(); }), 'presupuesto del mes visible');
  comprobar(ppto.enTabla && ppto.fila === 7500, 'la categoría aparece en la tabla con su presupuesto (VF.calc.presupuestoVsReal)');
  sinErrores(page, 'tras pagos y presupuesto');

  // CSV de movimientos (descarga real)
  await irA(page, '#/reportes');
  await page.evaluate(function () { VF.reportes.fijarAmbito('empresa'); VF.reportes.fijarRango('mes'); });
  await page.waitForTimeout(ayuda.ESPERA_REPINTADO_MS);
  const csv = await ayuda.descarga(page, '[data-accion="reportes-csv-movimientos"]');
  const esperadoCSV = await page.evaluate(function () {
    var est = VF.store.estado(); var h = VF.calc.hoy();
    var movs = VF.calc.movimientosEn(est, 'empresa', VF.util.inicioMes(h), VF.util.finMes(h));
    return { filas: movs.length, periodo: VF.util.periodo(h), nombre: 'villeda-empresa-movimientos-' + VF.util.periodo(h) + '.csv', empresa: est.cuentas.filter(function (c) { return c.ambito === 'empresa'; }).map(function (c) { return c.nombre; }) };
  });
  igual(csv.nombre, esperadoCSV.nombre, 'nombre del CSV villeda-empresa-movimientos-<periodo>.csv');
  comprobar(csv.bytes[0] === 0xEF && csv.bytes[1] === 0xBB && csv.bytes[2] === 0xBF, 'el CSV empieza con BOM UTF-8');
  const lineas = csv.texto.replace(/^﻿/, '').split('\r\n').filter(function (l) { return l.length; });
  igual(lineas[0], 'fecha,tipo,cuenta,categoría,descripción,contraparte,monto,estado', 'encabezado del CSV de movimientos');
  igual(lineas.length - 1, esperadoCSV.filas, 'filas del CSV = movimientosEn(empresa, mes)');
  comprobar(lineas.slice(1).every(function (l) { return l.indexOf(esperadoCSV.periodo + '-') === 0; }), 'todas las filas son del periodo ' + esperadoCSV.periodo);
  comprobar(lineas.slice(1).every(function (l) { return /^\d{4}-\d{2}-\d{2},(Ingreso|Gasto|Transferencia),/.test(l); }), 'cada fila tiene fecha y tipo válidos');
  comprobar(lineas.slice(1).every(function (l) { return /,-?\d+\.\d{2},(Confirmado|Por revisar)$/.test(l); }), 'cada fila termina con monto a 2 decimales y estado');
  const origenes = lineas.slice(1).map(function (l) { return campoCSV(l, 2).split(' → ')[0]; });
  const ajenas = origenes.filter(function (n) { return esperadoCSV.empresa.indexOf(n) < 0; });
  comprobar(ajenas.length === 0, 'la cuenta origen de cada fila es una cuenta de empresa' + (ajenas.length ? ' (ajenas: ' + ajenas.join(', ') + ')' : ''));

  // Exportar respaldo (cifrado y plano) e importar el cifrado
  await irA(page, '#/ajustes');
  const estadoAntesExportar = await page.evaluate(function () { return JSON.stringify(VF.store.estado()); });
  const respaldo = await ayuda.descarga(page, '[data-accion="ajustes-exportar-cifrado"]');
  comprobar(/^villeda-finanzas-respaldo-\d{4}-\d{2}-\d{2}\.vf\.json$/.test(respaldo.nombre), 'nombre del respaldo cifrado (' + respaldo.nombre + ')');
  let bovedaExportada = null;
  try { bovedaExportada = JSON.parse(respaldo.texto); } catch (e) { bovedaExportada = null; }
  comprobar(bovedaExportada && ['datos', 'iv', 'salt', 'verificador', 'version'].every(function (k) { return k in bovedaExportada; }), 'el respaldo cifrado tiene {version, salt, iv, datos, verificador}');
  comprobar(!/VILLEDA Inc|Nómina|Prueba smoke/.test(respaldo.texto), 'el respaldo cifrado no contiene texto legible');
  await page.click('[data-accion="ajustes-exportar-plano"]');
  await ayuda.esperarModal(page, { titulo: 'Exportar sin cifrar' });
  const plano = await ayuda.descarga(page, function () { return pulsarEnModal(page, '.modal-pie .btn-peligro'); });
  await ayuda.esperarSinModal(page);
  let estadoPlano = null;
  try { estadoPlano = JSON.parse(plano.texto); } catch (e) { estadoPlano = null; }
  comprobar(/^villeda-finanzas-datos-\d{4}-\d{2}-\d{2}\.json$/.test(plano.nombre) && estadoPlano && estadoPlano.cuentas.length === 7, 'el respaldo plano es el estado legible (' + plano.nombre + ')');
  igual(estadoPlano ? JSON.stringify(estadoPlano) : null, estadoAntesExportar, 'el respaldo plano (con sangría) coincide con el estado en memoria');
  // Se altera el estado y se importa el respaldo cifrado: debe restaurarse exactamente
  await page.evaluate(function () {
    VF.store.agregar('movimientos', { ambito: 'personal', cuentaId: 'cta_per_nu_demo', tipo: 'gasto', monto: 99.99, fecha: VF.calc.hoy(), categoria: 'Otros gastos', descripcion: 'Se perderá al importar', contraparte: '', estado: 'confirmado', etiquetas: [] });
  });
  await page.waitForTimeout(ayuda.ESPERA_REPINTADO_MS + 100);
  await page.setInputFiles('[data-ajustes-archivo]', respaldo.ruta);
  await ayuda.esperarModal(page, { titulo: 'Importar respaldo' });
  comprobar(/Cifrado/.test(await ultimoModal(page).textContent()), 'el modal de importación detecta el formato cifrado');
  await pulsarEnModal(page, '.modal-pie .btn-peligro');
  await ayuda.esperarSinModal(page, 30000);
  igual(await page.evaluate(function () { return JSON.stringify(VF.store.estado()); }), estadoAntesExportar, 'importar el respaldo cifrado restaura el estado exacto (sin pérdida)');
  igual(await page.evaluate(function () { return VF.store.estado().movimientos.filter(function (m) { return m.descripcion === 'Se perderá al importar'; }).length; }), 0, 'el movimiento posterior al respaldo desapareció');
  sinErrores(page, 'tras exportar e importar');

  // Botón de tema: auto → claro → oscuro → auto, y persistencia en ajustes
  await page.click('#btn-tema');
  igual(await page.getAttribute('html', 'data-tema'), 'claro', 'tema → claro');
  igual(await page.evaluate(function () { return VF.store.estado().ajustes.tema; }), 'claro', 'ajustes.tema = claro');
  const fondoClaro = await page.evaluate(function () {
    return getComputedStyle(document.body).backgroundColor + ' | --fondo=' + getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim() + ' | data-tema=' + document.documentElement.getAttribute('data-tema') + ' | hojas=' + document.styleSheets.length + ' | dark=' + matchMedia('(prefers-color-scheme: dark)').matches;
  });
  comprobar(/^rgb\(243, 245, 249\)/.test(fondoClaro), 'tema claro forzado sobre preferencia oscura (' + fondoClaro + ')');
  await ayuda.quitarToasts(page);
  await ayuda.captura(page, 'smoke-ajustes-escritorio-claro');
  await page.click('#btn-tema');
  igual(await page.getAttribute('html', 'data-tema'), 'oscuro', 'tema → oscuro');
  await page.click('#btn-tema');
  igual(await page.getAttribute('html', 'data-tema'), null, 'tema → auto (sin data-tema)');

  // Borrar datos de ejemplo → 0 ids _demo
  await page.click('[data-accion="ajustes-borrar-ejemplo"]');
  await ayuda.esperarModal(page, { titulo: 'Borrar datos de ejemplo' });
  await pulsarEnModal(page, '.modal-pie .btn-peligro');
  await ayuda.esperarSinModal(page);
  const demo = await page.evaluate(function () {
    var est = VF.store.estado(); var n = 0; var total = 0;
    ['cuentas', 'movimientos', 'clientes', 'facturas', 'proveedores', 'cuentasPorPagar', 'comisiones', 'prestamos', 'presupuestos', 'metas'].forEach(function (c) {
      (est[c] || []).forEach(function (r) {
        total += 1;
        if (/_demo$/.test(String(r.id))) n += 1;
        (r.pagos || []).forEach(function (p) { if (/_demo$/.test(String(p.id))) n += 1; });
      });
    });
    return { demo: n, total: total, flag: est.ajustes.datosEjemplo, banner: !document.querySelector('#banner-ejemplo').hidden };
  });
  igual(demo.demo, 0, 'borrar datos de ejemplo deja 0 ids _demo');
  comprobar(demo.flag === false && !demo.banner, 'ajustes.datosEjemplo = false y banner oculto');
  comprobar(demo.total >= 1, 'los registros propios (presupuesto, pagos) se conservan (' + demo.total + ')');

  // Borrar todo desde Ajustes → "Crear contraseña"
  await page.click('[data-accion="ajustes-borrar-todo"]');
  await ayuda.esperarModal(page, { titulo: 'Borrar todo' });
  await pulsarEnModal(page, '.modal-pie .btn-peligro');
  await ayuda.esperarModal(page, { titulo: 'Borrar todo' });
  await page.waitForSelector('.modal-fondo .modal [data-campo="confirmacion"]');
  comprobar(await ultimoModal(page).locator('.modal-pie .btn-peligro').isDisabled(), 'sin escribir BORRAR el botón "Borrar definitivamente" está deshabilitado');
  await ultimoModal(page).locator('[data-campo="confirmacion"]').fill('borrar');
  comprobar(await ultimoModal(page).locator('.modal-pie .btn-peligro').isDisabled(), 'escribir "borrar" en minúsculas no habilita el botón');
  comprobar(await page.evaluate(function () { return VF.store.existeBoveda(); }), 'sin escribir BORRAR no se borra nada');
  await ultimoModal(page).locator('[data-campo="confirmacion"]').fill('BORRAR');
  await ultimoModal(page).locator('.modal-pie .btn-peligro:not([disabled])').waitFor({ state: 'visible' });
  await pulsarEnModal(page, '.modal-pie .btn-peligro');
  await page.waitForSelector('#form-crear', { state: 'visible' });
  comprobar(!(await page.evaluate(function () { return VF.store.existeBoveda(); })), 'borrar todo elimina la bóveda');
  comprobar(await page.evaluate(function () { return localStorage.getItem('vf.boveda.v1') === null; }), 'localStorage sin bóveda');
  comprobar(!(await visible(page, '#form-desbloquear')), 'tras borrar todo se muestra "Crear contraseña", no "Desbloquear"');
  comprobar(!(await visible(page, '#app')), '#app oculto tras borrar todo');
  igual(await page.getAttribute('html', 'data-ambito'), null, 'la cabecera pierde el ámbito al bloquear');
  await ayuda.quitarToasts(page);
  await ayuda.captura(page, 'smoke-bloqueo-crear-escritorio-oscuro-tras-borrar');
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
  const modulos = await page.evaluate(function () {
    return ['panel', 'empresa', 'personal', 'facturas', 'proveedores', 'prestamos', 'presupuestos', 'reportes', 'asistente', 'ajustes'].filter(function (m) { return !VF[m]; });
  });
  comprobar(modulos.length === 0, 'file://: los 10 módulos cargados' + (modulos.length ? ' (faltan ' + modulos.join(', ') + ')' : ''));
  comprobar(await page.evaluate(function () { return !navigator.serviceWorker || !navigator.serviceWorker.controller; }), 'file://: sin service worker');
  comprobar(await page.evaluate(function () { return !document.getElementById('asistente-estilos'); }), 'file://: el asistente no inyecta estilos (ya están en app.css)');
  sinErrores(page, 'al cargar por file://');
  await ayuda.crearBoveda(page, CONTRASENA, true);
  comprobar(await visible(page, '#app'), 'file://: bóveda creada y #app visible');
  comprobar(/^#\/panel/.test(await page.evaluate(function () { return location.hash; })), 'file://: ruta inicial #/panel');
  await ayuda.quitarToasts(page);
  await ayuda.captura(page, 'smoke-file-shell-escritorio-claro');
  await visitarRutas(page, 'escritorio', { rutas: ['panel', 'empresa', 'facturas', 'asistente'], sufijo: 'escritorio-claro' });
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
  const page = await ayuda.abrir('movil', { colorScheme: 'dark' });
  await ayuda.crearBoveda(page, CONTRASENA, true);
  for (const ruta of ['panel', 'empresa', 'facturas', 'asistente']) {
    await irA(page, '#/' + ruta);
    comprobar(!(await ayuda.hayScrollHorizontal(page)), 'móvil oscuro ruta ' + ruta + ': sin scroll horizontal');
    await ayuda.quitarToasts(page);
    await ayuda.captura(page, 'smoke-' + ruta + '-movil-oscuro');
  }
  await irA(page, '#/panel');
  await ayuda.bloquear(page);
  await ayuda.quitarToasts(page);
  await page.click('#enlace-olvide');
  await ayuda.esperarModal(page);
  comprobar(/no existe forma de recuperarla/.test(await textoDe(page, '.modal-cuerpo')), 'modal explica que no hay recuperación');
  await ayuda.captura(page, 'smoke-olvide-movil-oscuro');
  await page.click('.modal-pie .btn-secundario');
  await ayuda.esperarSinModal(page);
  comprobar(await page.evaluate(function () { return VF.store.existeBoveda(); }), 'cancelar conserva la bóveda');
  await page.click('#enlace-olvide');
  await ayuda.esperarModal(page);
  await page.click('.modal-pie .btn-peligro');
  await page.waitForFunction(function () { return document.querySelectorAll('.modal').length === 1 && /TODOS los datos/.test(document.querySelector('.modal-cuerpo').textContent); });
  await page.click('.modal-pie .btn-secundario');
  await ayuda.esperarSinModal(page);
  comprobar(await page.evaluate(function () { return VF.store.existeBoveda(); }), 'cancelar la primera confirmación conserva la bóveda');
  await page.click('#enlace-olvide');
  await ayuda.esperarModal(page);
  await page.click('.modal-pie .btn-peligro');
  await page.waitForFunction(function () { return document.querySelectorAll('.modal').length === 1 && /TODOS los datos/.test(document.querySelector('.modal-cuerpo').textContent); });
  await page.click('.modal-pie .btn-peligro');
  await page.waitForFunction(function () { return /Última confirmación/.test((document.querySelector('.modal-cuerpo') || {}).textContent || ''); });
  await page.click('.modal-pie .btn-peligro');
  await page.waitForSelector('#form-crear', { state: 'visible' });
  comprobar(!(await page.evaluate(function () { return VF.store.existeBoveda(); })), 'doble confirmación borra la bóveda');
  comprobar(!(await visible(page, '#form-desbloquear')), 'vuelve a la pantalla "Crear contraseña"');
  await ayuda.crearBoveda(page, 'Otra-Clave-9876', false);
  comprobar(await visible(page, '#app'), 'se crea una bóveda nueva tras borrar');
  igual(await page.evaluate(function () { return VF.store.estado().cuentas.length; }), 0, 'la bóveda nueva está vacía');
  comprobar(/Sin movimientos|Registra tu primer/.test(await textoDe(page, '#vista')), 'bóveda vacía: el panel muestra "Sin movimientos" (no ceros)');
  comprobar(!(await visible(page, '#banner-ejemplo')), 'sin datos de ejemplo no hay banner');
  sinErrores(page, 'al final del escenario olvidé');
}

/* ---------------------------------------------------------------- main -- */
async function main() {
  const inicio = Date.now();
  const guardia = setTimeout(function () {
    console.error('FALLO: la prueba superó el tiempo máximo (8 minutos).');
    process.exit(1);
  }, 8 * 60 * 1000);
  try {
    escenarioSintaxis();
    const srv = await ayuda.iniciarServidor();
    console.log('Servidor: ' + srv.url);
    const todos = { A: escenarioMovil, B: escenarioEscritorio, C: escenarioFile, D: escenarioOlvide };
    const elegidos = String(process.env.VF_SMOKE || 'A,B,C,D').toUpperCase().split(',').filter(function (k) { return todos[k]; });
    for (const clave of elegidos) {
      const esc = todos[clave];
      try {
        await esc();
      } catch (e) {
        fallos.push('[' + escenarioActual + '] excepción: ' + (e && e.message ? e.message.split('\n')[0] : e));
        const pila = e && e.stack ? e.stack.split('\n') : [];
        const linea = pila.filter(function (l) { return /(smoke|ayuda)\.js:\d+/.test(l); }).map(function (l) { return l.trim(); }).join(' ← ');
        console.error('  EXCEPCIÓN en ' + escenarioActual + ': ' + pila.slice(0, 1).join('') + (linea ? '\n    en ' + linea.trim() : ''));
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
