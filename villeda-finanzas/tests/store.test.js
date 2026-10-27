'use strict';
/**
 * Pruebas de VF.util, VF.crypto, VF.store y VF.seed en Node (node tests/store.test.js).
 * Simula el navegador: window = globalThis, localStorage mínimo en memoria, WebCrypto nativo.
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

// ---- Entorno mínimo tipo navegador ----
globalThis.window = globalThis;
(function () {
  var mapa = new Map();
  globalThis.localStorage = {
    getItem: function (k) { return mapa.has(k) ? mapa.get(k) : null; },
    setItem: function (k, v) { mapa.set(k, String(v)); },
    removeItem: function (k) { mapa.delete(k); },
    clear: function () { mapa.clear(); },
    key: function (i) { return Array.from(mapa.keys())[i] || null; },
    get length() { return mapa.size; }
  };
})();

var RAIZ = path.resolve(__dirname, '..');
['util', 'crypto', 'store', 'seed'].forEach(function (nombre) {
  var ruta = path.join(RAIZ, 'js', 'core', nombre + '.js');
  new vm.Script(fs.readFileSync(ruta, 'utf8'), { filename: ruta }).runInThisContext();
});
var VF = globalThis.VF;

// ---- Mini framework ----
var fallos = [];
var total = 0;
function ok(cond, msg) {
  total++;
  if (!cond) fallos.push(msg);
}
function igual(a, b, msg) {
  ok(a === b, msg + ' (esperado ' + JSON.stringify(b) + ', obtenido ' + JSON.stringify(a) + ')');
}
function lanzaAsync(promesa, codigo, msg) {
  return promesa.then(function () {
    ok(false, msg + ': no lanzó');
  }, function (e) {
    igual(e && e.message, codigo, msg);
  });
}
function lanza(fn, codigo, msg) {
  try {
    fn();
    ok(false, msg + ': no lanzó');
  } catch (e) {
    igual(e && e.message, codigo, msg);
  }
}

var r2 = VF.util.round2;

/** Saldo de una cuenta calculado aquí (independiente de calc.js, que aún no existe). */
function saldo(estado, cuentaId) {
  var c = estado.cuentas.filter(function (x) { return x.id === cuentaId; })[0];
  var s = c.saldoInicial;
  estado.movimientos.forEach(function (m) {
    if (m.cuentaId === cuentaId) {
      if (m.tipo === 'ingreso') s += m.monto;
      else s -= m.monto;
    }
    if (m.tipo === 'transferencia' && m.cuentaDestinoId === cuentaId) s += m.monto;
  });
  return r2(s);
}

// ================= VF.util =================
(function pruebasUtil() {
  var id = VF.util.uid('mov');
  ok(/^mov_[0-9a-z]{10}$/.test(id), 'uid tiene prefijo y 10 caracteres base36: ' + id);
  igual(VF.util.fechaISO(new Date(2026, 9, 25)), '2026-10-25', 'fechaISO local');
  igual(VF.util.sumarDias('2026-10-25', 7), '2026-11-01', 'sumarDias cruza mes');
  igual(VF.util.sumarDias('2026-03-01', -1), '2026-02-28', 'sumarDias retrocede');
  igual(VF.util.inicioMes('2026-10-25'), '2026-10-01', 'inicioMes');
  igual(VF.util.finMes('2026-02-10'), '2026-02-28', 'finMes');
  igual(VF.util.inicioSemana('2026-10-25'), '2026-10-19', 'inicioSemana (domingo → lunes anterior)');
  igual(VF.util.inicioSemana('2026-10-19'), '2026-10-19', 'inicioSemana (lunes se queda)');
  igual(VF.util.periodo('2026-10-25'), '2026-10', 'periodo');
  igual(VF.util.diasEntre('2026-10-01', '2026-10-25'), 24, 'diasEntre');
  igual(VF.util.fmtMXN(12345.67), '$12,345.67', 'fmtMXN');
  igual(VF.util.fmtMXN(NaN), '—', 'fmtMXN NaN');
  igual(VF.util.fmtMXN(null), '—', 'fmtMXN null');
  igual(VF.util.fmtFecha('2026-10-25'), '25 oct 2026', 'fmtFecha');
  igual(VF.util.fmtFechaLarga('2026-10-25'), 'domingo, 25 de octubre de 2026', 'fmtFechaLarga');
  igual(VF.util.round2(1.005), 1.01, 'round2 1.005');
  igual(VF.util.round2(-2.345), -2.35, 'round2 negativo');
  igual(VF.util.parseMonto('$1,234.50'), 1234.5, 'parseMonto con símbolo');
  igual(VF.util.parseMonto(' 1234 '), 1234, 'parseMonto con espacios');
  ok(isNaN(VF.util.parseMonto('abc')), 'parseMonto inválido → NaN');
  ok(isNaN(VF.util.parseMonto('')), 'parseMonto vacío → NaN');
  igual(VF.util.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;', 'esc');
  igual(VF.util.normalizar('  ¿Cuánto   GASTÓ Villeda? '), '¿cuanto gasto villeda?', 'normalizar');
  igual(VF.util.suma([{ m: 0.1 }, { m: 0.2 }], function (x) { return x.m; }), 0.3, 'suma con round2');
  igual(VF.util.suma([1, 2, 3.5]), 6.5, 'suma sin fn');
  var grupos = VF.util.agrupar([{ c: 'a' }, { c: 'b' }, { c: 'a' }], 'c');
  igual(grupos.a.length, 2, 'agrupar por campo');
  var ordenado = VF.util.ordenar([{ n: 3 }, { n: 1 }, { n: 2 }], 'n', 'desc');
  igual(ordenado.map(function (x) { return x.n; }).join(','), '3,2,1', 'ordenar desc');
  var csv = VF.util.csv([{ a: 'x,y', b: 12.5 }, { a: 'con "comillas"', b: null }], [{ clave: 'a', titulo: 'A' }, { clave: 'b', titulo: 'B' }]);
  igual(csv, '﻿A,B\r\n"x,y",12.5\r\n"con ""comillas""",\r\n', 'csv con BOM y escapes');
})();

// ================= VF.seed =================
var seedEstado = VF.seed.datos();
(function pruebasSeed() {
  var e = seedEstado;
  var hoy = VF.util.hoy();
  var minimo = VF.util.sumarDias(hoy, -120);
  var maximo = VF.util.sumarDias(hoy, 45);
  var colecciones = ['cuentas', 'movimientos', 'clientes', 'facturas', 'proveedores', 'cuentasPorPagar', 'comisiones', 'prestamos', 'presupuestos', 'metas'];

  var ids = {};
  colecciones.forEach(function (nombre) {
    e[nombre].forEach(function (x) {
      ok(/_demo$/.test(x.id), nombre + ': id termina en _demo: ' + x.id);
      ok(!ids[x.id], 'id único: ' + x.id);
      ids[x.id] = true;
      ok(x.creado && x.actualizado, nombre + ' ' + x.id + ' tiene creado/actualizado');
    });
  });

  igual(e.cuentas.filter(function (c) { return c.ambito === 'empresa'; }).length, 3, '3 cuentas empresa');
  igual(e.cuentas.filter(function (c) { return c.ambito === 'personal'; }).length, 4, '4 cuentas personales');
  var tdc = e.cuentas.filter(function (c) { return c.tipo === 'credito'; });
  igual(tdc.length, 1, 'una tarjeta de crédito');
  ok(saldo(e, tdc[0].id) < 0, 'la tarjeta tiene deuda (saldo negativo): ' + saldo(e, tdc[0].id));
  ok(saldo(e, tdc[0].id) > -tdc[0].limiteCredito, 'la deuda de la tarjeta no excede el límite');
  ok(tdc[0].diaCorte >= 1 && tdc[0].diaCorte <= 31 && tdc[0].diaPago >= 1 && tdc[0].diaPago <= 31, 'tarjeta con diaCorte y diaPago');
  ok(e.movimientos.length >= 70, '≥70 movimientos: ' + e.movimientos.length);
  igual(e.clientes.length, 5, '5 clientes');
  igual(e.facturas.length, 8, '8 facturas');
  igual(e.proveedores.length, 4, '4 proveedores');
  igual(e.cuentasPorPagar.length, 6, '6 CxP');
  igual(e.comisiones.length, 3, '3 comisiones');
  igual(e.prestamos.length, 3, '3 préstamos');
  igual(e.prestamos.filter(function (p) { return p.ambito === 'empresa' && p.tipo === 'recibido'; }).length, 1, 'préstamo empresa recibido');
  igual(e.prestamos.filter(function (p) { return p.ambito === 'personal' && p.tipo === 'recibido'; }).length, 1, 'préstamo personal recibido');
  igual(e.prestamos.filter(function (p) { return p.tipo === 'otorgado'; }).length, 1, 'préstamo otorgado');
  igual(e.metas.length, 2, '2 metas');
  var periodoActual = VF.util.periodo(hoy);
  ok(e.presupuestos.some(function (p) { return p.ambito === 'empresa' && p.periodo === periodoActual; }), 'presupuesto empresa del mes actual');
  ok(e.presupuestos.some(function (p) { return p.ambito === 'personal' && p.periodo === periodoActual; }), 'presupuesto personal del mes actual');
  ok(e.ajustes.datosEjemplo === true, 'ajustes.datosEjemplo true en seed');
  igual(e.ajustes.nombreEmpresa, 'VILLEDA Inc', 'nombreEmpresa');

  // Cuentas de todos los saldos (no negativas salvo la tarjeta)
  e.cuentas.forEach(function (c) {
    if (c.tipo !== 'credito') ok(saldo(e, c.id) > 0, 'saldo positivo en ' + c.nombre + ': ' + saldo(e, c.id));
  });

  // Movimientos: ámbito = ámbito de la cuenta origen; cuentas existen; fechas en rango; monto positivo
  var cuentaPorId = {};
  e.cuentas.forEach(function (c) { cuentaPorId[c.id] = c; });
  var categoriasValidas = function (ambito, tipo) { return e.categorias[ambito][tipo] || []; };
  e.movimientos.forEach(function (m) {
    var c = cuentaPorId[m.cuentaId];
    ok(!!c, 'cuenta existe para ' + m.id);
    if (c) igual(m.ambito, c.ambito, 'ámbito del movimiento = cuenta origen (' + m.id + ')');
    ok(m.monto > 0, 'monto positivo ' + m.id);
    igual(m.monto, r2(m.monto), 'monto con 2 decimales ' + m.id);
    ok(m.fecha >= minimo && m.fecha <= hoy, 'fecha en últimos 120 días ' + m.id + ' ' + m.fecha);
    ok(['ingreso', 'gasto', 'transferencia'].indexOf(m.tipo) !== -1, 'tipo válido ' + m.id);
    ok(['confirmado', 'revisar'].indexOf(m.estado) !== -1, 'estado válido ' + m.id);
    ok(Array.isArray(m.etiquetas), 'etiquetas arreglo ' + m.id);
    if (m.tipo === 'transferencia') {
      var dest = cuentaPorId[m.cuentaDestinoId];
      ok(!!dest, 'destino existe en transferencia ' + m.id);
      if (dest && dest.ambito !== c.ambito) {
        igual(m.categoria, c.ambito === 'empresa' ? 'Retiro de socio' : 'Aportación de capital', 'categoría de transferencia entre ámbitos ' + m.id);
      }
    } else {
      ok(categoriasValidas(m.ambito, m.tipo).indexOf(m.categoria) !== -1, 'categoría "' + m.categoria + '" existe en ' + m.ambito + '.' + m.tipo + ' (' + m.id + ')');
    }
  });

  // Duplicado y revisar
  var llaves = {};
  var hayDuplicado = false;
  e.movimientos.forEach(function (m) {
    var k = [m.cuentaId, m.fecha, m.monto, m.tipo].join('|');
    if (llaves[k]) hayDuplicado = true;
    llaves[k] = true;
  });
  ok(hayDuplicado, 'existe un movimiento duplicado');
  ok(e.movimientos.some(function (m) { return m.estado === 'revisar'; }), 'existe un movimiento en estado revisar');

  // Facturas: iva/total, pagos vinculados en ambos sentidos, estados derivados variados
  var derivados = {};
  e.facturas.forEach(function (f) {
    igual(f.iva, r2(f.subtotal * 0.16), 'IVA 16 % ' + f.folio);
    igual(f.total, r2(f.subtotal + f.iva), 'total ' + f.folio);
    ok(e.clientes.some(function (c) { return c.id === f.clienteId; }), 'cliente existe ' + f.folio);
    ok(f.fechaEmision >= minimo && f.fechaVencimiento <= maximo, 'fechas de factura en rango ' + f.folio);
    var pagado = 0;
    f.pagos.forEach(function (p) {
      pagado += p.monto;
      ok(p.fecha >= f.fechaEmision, 'pago posterior a emisión ' + f.folio);
      var m = e.movimientos.filter(function (x) { return x.id === p.movimientoId; })[0];
      ok(!!m, 'movimiento del pago existe ' + f.folio);
      if (m) {
        igual(m.facturaId, f.id, 'movimiento vinculado a la factura ' + f.folio);
        igual(m.tipo, 'ingreso', 'pago de factura es ingreso ' + f.folio);
        igual(m.ambito, 'empresa', 'pago de factura en ámbito empresa ' + f.folio);
        igual(m.monto, p.monto, 'monto pago = monto movimiento ' + f.folio);
        igual(m.cuentaId, p.cuentaId, 'cuenta pago = cuenta movimiento ' + f.folio);
      }
    });
    var pendiente = r2(f.total - pagado);
    var estadoDerivado = pendiente <= 0 ? 'pagada' : (pagado > 0 ? 'parcial' : (f.fechaVencimiento < hoy ? 'vencida' : 'emitida'));
    derivados[estadoDerivado] = (derivados[estadoDerivado] || 0) + 1;
  });
  ['pagada', 'parcial', 'vencida', 'emitida'].forEach(function (s) {
    ok(derivados[s] > 0, 'hay al menos una factura ' + s);
  });
  e.movimientos.filter(function (m) { return m.facturaId; }).forEach(function (m) {
    var f = e.facturas.filter(function (x) { return x.id === m.facturaId; })[0];
    ok(f && f.pagos.some(function (p) { return p.movimientoId === m.id; }), 'factura referencia de vuelta al movimiento ' + m.id);
  });

  // CxP
  e.cuentasPorPagar.forEach(function (c) {
    ok(e.proveedores.some(function (p) { return p.id === c.proveedorId; }), 'proveedor existe ' + c.id);
    c.pagos.forEach(function (p) {
      var m = e.movimientos.filter(function (x) { return x.id === p.movimientoId; })[0];
      ok(!!m, 'movimiento del pago CxP existe ' + c.id);
      if (m) {
        igual(m.cxpId, c.id, 'movimiento vinculado a CxP ' + c.id);
        igual(m.tipo, 'gasto', 'pago CxP es gasto');
        igual(m.categoria, 'Proveedores', 'pago CxP categoría Proveedores');
        igual(m.monto, p.monto, 'monto pago CxP');
      }
    });
  });
  ok(e.cuentasPorPagar.some(function (c) { return VF.util.suma(c.pagos, function (p) { return p.monto; }) >= c.monto; }), 'hay CxP pagada');
  ok(e.cuentasPorPagar.some(function (c) { return c.pagos.length === 0 && c.fechaVencimiento < hoy; }), 'hay CxP vencida');
  ok(e.cuentasPorPagar.some(function (c) { return c.pagos.length === 0 && c.fechaVencimiento >= hoy; }), 'hay CxP pendiente vigente');

  // Comisiones
  e.comisiones.forEach(function (c) {
    igual(c.monto, r2(c.base * c.porcentaje / 100), 'monto comisión ' + c.id);
    ok(e.facturas.some(function (f) { return f.id === c.facturaId; }), 'factura de comisión existe ' + c.id);
    if (c.estado === 'pagada') {
      var m = e.movimientos.filter(function (x) { return x.id === c.movimientoId; })[0];
      ok(m && m.comisionId === c.id && m.categoria === 'Comisiones' && m.monto === c.monto, 'comisión pagada con movimiento vinculado ' + c.id);
    } else {
      ok(c.movimientoId === null, 'comisión pendiente sin movimiento ' + c.id);
    }
  });

  // Préstamos: amortización coherente
  e.prestamos.forEach(function (p) {
    var r = p.tasaAnual / 100 / 12;
    var pagoMensual = p.tasaAnual ? r2(p.principal * r / (1 - Math.pow(1 + r, -p.plazoMeses))) : r2(p.principal / p.plazoMeses);
    var saldoP = p.principal;
    ok(p.pagos.length >= 2, 'préstamo con pagos registrados ' + p.id);
    ok(p.diaPago >= 1 && p.diaPago <= 28, 'diaPago del préstamo ' + p.id);
    p.pagos.forEach(function (pg, i) {
      igual(pg.interes, r2(saldoP * r), 'interés pago ' + (i + 1) + ' ' + p.id);
      igual(pg.capital, r2(pagoMensual - pg.interes), 'capital pago ' + (i + 1) + ' ' + p.id);
      igual(pg.monto, r2(pg.capital + pg.interes), 'monto = capital + interés ' + p.id);
      igual(pg.monto, pagoMensual, 'monto = pago mensual ' + p.id);
      ok(pg.fecha > p.fechaInicio && pg.fecha <= hoy, 'fecha de pago en rango ' + p.id);
      saldoP = r2(saldoP - pg.capital);
      var m = e.movimientos.filter(function (x) { return x.id === pg.movimientoId; })[0];
      ok(!!m, 'movimiento de pago de préstamo existe ' + p.id);
      if (m) {
        igual(m.prestamoId, p.id, 'movimiento vinculado al préstamo ' + p.id);
        igual(m.ambito, p.ambito, 'movimiento del préstamo en el mismo ámbito ' + p.id);
        igual(m.tipo, p.tipo === 'recibido' ? 'gasto' : 'ingreso', 'tipo de movimiento según préstamo ' + p.id);
        igual(m.categoria, p.tipo === 'recibido' ? 'Préstamos' : 'Otros ingresos', 'categoría de movimiento de préstamo ' + p.id);
        igual(m.monto, pg.monto, 'monto movimiento = pago ' + p.id);
      }
    });
    ok(saldoP > 0 && saldoP < p.principal, 'saldo insoluto entre 0 y principal ' + p.id);
  });

  // Metas
  e.metas.forEach(function (m) {
    igual(m.ambito, 'personal', 'meta personal ' + m.id);
    ok(!m.cuentaId || cuentaPorId[m.cuentaId].ambito === 'personal', 'cuenta de meta personal ' + m.id);
  });

  // Serializable y determinista en estructura
  var json = JSON.stringify(e);
  ok(json.length > 10000, 'seed serializable');

  // vacío
  var v = VF.seed.vacio();
  igual(v.cuentas.length, 0, 'vacio sin cuentas');
  igual(v.ajustes.datosEjemplo, false, 'vacio datosEjemplo false');
  igual(v.categorias.empresa.gasto.length, 14, 'categorías empresa.gasto por defecto');
  igual(v.categorias.personal.gasto.length, 15, 'categorías personal.gasto por defecto');
  ok(VF.seed.vacio().categorias.empresa.ingreso !== v.categorias.empresa.ingreso, 'vacio devuelve copias nuevas');
})();

// ================= VF.crypto + VF.store =================
async function pruebasStore() {
  var S = VF.store;
  var eventos = [];
  var registrar = function (nombre) { return function () { eventos.push(nombre); }; };
  var onDesbloq = registrar('desbloqueado');
  var onBloq = registrar('bloqueado');
  var onCambio = registrar('cambio');
  S.on('desbloqueado', onDesbloq);
  S.on('bloqueado', onBloq);
  S.on('cambio', onCambio);

  // crypto directo
  var salt = VF.crypto.generarSalt();
  ok(/^[A-Za-z0-9+/]+=*$/.test(salt) && Buffer.from(salt, 'base64').length === 16, 'salt de 16 bytes en base64');
  var k1 = await VF.crypto.derivarClave('abc12345', salt);
  var grande = { texto: 'x'.repeat(200000), lista: [1, 2, 3] };
  var paquete = await VF.crypto.cifrar(grande, k1);
  ok(typeof paquete.iv === 'string' && typeof paquete.datos === 'string', 'cifrar devuelve iv/datos base64');
  var vuelta = await VF.crypto.descifrar(paquete, k1);
  igual(vuelta.texto.length, 200000, 'descifrar objeto grande (base64 por bloques)');
  var k2 = await VF.crypto.derivarClave('otra-clave', salt);
  await lanzaAsync(VF.crypto.descifrar(paquete, k2), 'CONTRASENA_INCORRECTA', 'descifrar con clave incorrecta');

  // crear
  ok(!S.existeBoveda(), 'sin bóveda al inicio');
  ok(!S.estaDesbloqueado(), 'bloqueado al inicio');
  lanza(function () { S.listar('cuentas'); }, 'BLOQUEADO', 'listar bloqueado lanza');
  await lanzaAsync(S.desbloquear('x'), 'SIN_BOVEDA', 'desbloquear sin bóveda');

  var CONTRA = 'clave-prueba-123';
  await S.crear(CONTRA, { conEjemplo: true });
  ok(S.existeBoveda(), 'bóveda creada');
  ok(S.estaDesbloqueado(), 'desbloqueado tras crear');
  igual(eventos[eventos.length - 1], 'desbloqueado', 'emite desbloqueado al crear');
  await lanzaAsync(S.crear(CONTRA, {}), 'BOVEDA_EXISTE', 'no se puede crear sobre una bóveda existente');

  var boveda = JSON.parse(localStorage.getItem('vf.boveda.v1'));
  igual(boveda.version, 1, 'bóveda version 1');
  ok(boveda.salt && boveda.iv && boveda.datos && boveda.verificador && boveda.verificador.iv && boveda.verificador.datos, 'bóveda con salt, iv, datos, verificador');
  ok(!localStorage.getItem('vf.boveda.v1').includes('VILLEDA Inc'), 'el texto almacenado está cifrado');
  ok(!localStorage.getItem('vf.boveda.v1').includes(CONTRA), 'la contraseña no se guarda');

  var est = S.estado();
  ok(est.movimientos.length >= 70 && est.ajustes.datosEjemplo === true, 'estado con datos de ejemplo');

  // listar devuelve copias
  var lista = S.listar('cuentas');
  igual(lista.length, 7, 'listar cuentas');
  lista[0].nombre = 'MODIFICADO';
  ok(S.obtener('cuentas', lista[0].id).nombre !== 'MODIFICADO', 'listar devuelve copias superficiales');
  igual(S.listar('cuentas', { ambito: 'personal' }).length, 4, 'listar con filtro objeto');
  igual(S.listar('cuentas', function (c) { return c.tipo === 'credito'; }).length, 1, 'listar con filtro función');

  // agregar / actualizar
  var antesCambios = eventos.filter(function (x) { return x === 'cambio'; }).length;
  var nuevo = S.agregar('movimientos', {
    ambito: 'empresa', cuentaId: 'cta_emp_bbva_demo', tipo: 'gasto', monto: 1234.5, fecha: VF.util.hoy(),
    categoria: 'Software', descripcion: 'Prueba <script>', contraparte: '', estado: 'confirmado', etiquetas: []
  });
  ok(/^mov_[0-9a-z]{10}$/.test(nuevo.id), 'agregar asigna id');
  ok(nuevo.creado && nuevo.actualizado, 'agregar asigna creado/actualizado');
  ok(eventos.filter(function (x) { return x === 'cambio'; }).length > antesCambios, 'agregar emite cambio');
  lanza(function () { S.agregar('cuentas', { nombre: 'Sin ámbito', tipo: 'cheques', saldoInicial: 0 }); }, 'AMBITO_INVALIDO', 'agregar cuenta sin ámbito lanza');
  lanza(function () { S.agregar('inexistente', {}); }, 'COLECCION_INVALIDA', 'colección inválida lanza');
  var act = S.actualizar('movimientos', nuevo.id, { monto: 1500, id: 'hack', creado: 'hack' });
  igual(act.monto, 1500, 'actualizar aplica cambios');
  igual(act.id, nuevo.id, 'actualizar no cambia id');
  ok(act.creado !== 'hack', 'actualizar no cambia creado');
  igual(S.actualizar('movimientos', 'no_existe', { monto: 1 }), null, 'actualizar inexistente → null');
  await S.guardar();

  // integridad al eliminar
  lanza(function () { S.eliminar('cuentas', 'cta_emp_bbva_demo'); }, 'CUENTA_CON_MOVIMIENTOS', 'cuenta con movimientos');
  lanza(function () { S.eliminar('clientes', 'cli_altavista_demo'); }, 'CLIENTE_CON_FACTURAS', 'cliente con facturas');
  lanza(function () { S.eliminar('proveedores', 'prov_cementos_demo'); }, 'PROVEEDOR_CON_CXP', 'proveedor con CxP');
  igual(S.eliminar('cuentas', 'no_existe'), false, 'eliminar inexistente → false');
  var movsF2 = S.listar('movimientos', { facturaId: 'fac_0002_demo' }).length;
  ok(movsF2 > 0, 'F-0002 tiene movimientos vinculados');
  igual(S.eliminar('facturas', 'fac_0002_demo'), true, 'eliminar factura');
  igual(S.listar('movimientos', { facturaId: 'fac_0002_demo' }).length, 0, 'eliminar factura borra movimientos vinculados');
  igual(S.obtener('comisiones', 'com_02_demo').facturaId, null, 'comisión queda sin factura al eliminarla');
  var movsPre = S.listar('movimientos', { prestamoId: 'pre_emp_pyme_demo' }).length;
  ok(movsPre === 3, 'préstamo con 3 movimientos');
  S.eliminar('prestamos', 'pre_emp_pyme_demo');
  igual(S.listar('movimientos', { prestamoId: 'pre_emp_pyme_demo' }).length, 0, 'eliminar préstamo borra movimientos vinculados');
  S.eliminar('cuentasPorPagar', 'cxp_01_demo');
  igual(S.listar('movimientos', { cxpId: 'cxp_01_demo' }).length, 0, 'eliminar CxP borra movimientos vinculados');
  S.eliminar('comisiones', 'com_01_demo');
  igual(S.listar('movimientos', { comisionId: 'com_01_demo' }).length, 0, 'eliminar comisión borra movimiento vinculado');
  var cuentaNueva = S.agregar('cuentas', { ambito: 'personal', nombre: 'Temporal', banco: 'X', tipo: 'efectivo', saldoInicial: 10 });
  igual(S.eliminar('cuentas', cuentaNueva.id), true, 'eliminar cuenta sin movimientos');

  S.setAjustes({ autobloqueoMin: 10 });
  igual(S.estado().ajustes.autobloqueoMin, 10, 'setAjustes');
  var totalMovs = S.listar('movimientos').length;
  await S.guardar();

  // bloquear → desbloquear
  S.bloquear();
  ok(!S.estaDesbloqueado(), 'bloqueado');
  igual(S.estado(), null, 'estado null al bloquear');
  igual(eventos[eventos.length - 1], 'bloqueado', 'emite bloqueado');
  await lanzaAsync(S.desbloquear('contrasena-mala'), 'CONTRASENA_INCORRECTA', 'contraseña incorrecta');
  ok(!S.estaDesbloqueado(), 'sigue bloqueado tras intento fallido');
  await S.desbloquear(CONTRA);
  ok(S.estaDesbloqueado(), 'desbloqueado con contraseña correcta');
  igual(S.listar('movimientos').length, totalMovs, 'los cambios persistieron');
  igual(S.obtener('movimientos', nuevo.id).monto, 1500, 'el movimiento agregado persiste con su actualización');
  igual(S.estado().ajustes.autobloqueoMin, 10, 'ajustes persisten');
  igual(S.obtener('facturas', 'fac_0002_demo'), undefined, 'factura eliminada no vuelve');

  // Mutaciones rápidas + bloqueo inmediato no pierden datos
  S.agregar('clientes', { id: 'cli_rapido_1', nombre: 'Rápido 1' });
  S.agregar('clientes', { id: 'cli_rapido_2', nombre: 'Rápido 2' });
  var promesaGuardado = S.guardar();
  S.bloquear();
  await promesaGuardado;
  await S.desbloquear(CONTRA);
  ok(S.obtener('clientes', 'cli_rapido_2'), 'escritura encolada antes de bloquear se conserva');

  // cambiar contraseña
  var NUEVA = 'nueva-clave-456';
  await lanzaAsync(S.cambiarContrasena('incorrecta', NUEVA), 'CONTRASENA_INCORRECTA', 'cambiarContrasena con actual incorrecta');
  await S.cambiarContrasena(CONTRA, NUEVA);
  var saltAntes = boveda.salt;
  ok(JSON.parse(localStorage.getItem('vf.boveda.v1')).salt !== saltAntes, 'cambiar contraseña regenera salt');
  S.bloquear();
  await lanzaAsync(S.desbloquear(CONTRA), 'CONTRASENA_INCORRECTA', 'contraseña anterior ya no sirve');
  await S.desbloquear(NUEVA);
  igual(S.listar('movimientos').length, totalMovs, 'datos intactos tras cambiar contraseña');

  // exportar / importar cifrado
  var exportCifrado = S.exportarJSON({ cifrado: true });
  var objCifrado = JSON.parse(exportCifrado);
  ok(objCifrado.salt && objCifrado.datos && objCifrado.verificador, 'exportación cifrada con formato de bóveda');
  ok(!exportCifrado.includes('Rápido 2'), 'exportación cifrada no contiene texto plano');
  var exportPlano = S.exportarJSON({ cifrado: false });
  var objPlano = JSON.parse(exportPlano);
  igual(objPlano.movimientos.length, totalMovs, 'exportación plana contiene el estado');
  ok(exportPlano.includes('Rápido 2'), 'exportación plana es legible');
  var firma = JSON.stringify(S.estado());

  // Nueva bóveda vacía → importar cifrado con contraseña del respaldo
  S.borrarTodo();
  ok(!S.existeBoveda(), 'borrarTodo elimina la bóveda');
  ok(!S.estaDesbloqueado(), 'borrarTodo bloquea');
  var OTRA = 'tercera-clave-789';
  await S.crear(OTRA, { conEjemplo: false });
  igual(S.listar('cuentas').length, 0, 'bóveda nueva vacía');
  igual(S.estado().ajustes.datosEjemplo, false, 'vacía sin datos de ejemplo');
  await lanzaAsync(S.importarJSON(exportCifrado), 'CONTRASENA_REQUERIDA', 'importar cifrado sin contraseña');
  await lanzaAsync(S.importarJSON(exportCifrado, 'mala'), 'CONTRASENA_INCORRECTA', 'importar cifrado con contraseña incorrecta');
  await lanzaAsync(S.importarJSON('{no es json'), 'JSON_INVALIDO', 'importar JSON inválido');
  await lanzaAsync(S.importarJSON('{"hola":1}'), 'FORMATO_DESCONOCIDO', 'importar formato desconocido');
  await S.importarJSON(exportCifrado, NUEVA);
  igual(JSON.stringify(S.estado()), firma, 'importar cifrado restaura el estado exacto');
  // La bóveda sigue protegida por la contraseña ACTUAL, no la del respaldo
  S.bloquear();
  await lanzaAsync(S.desbloquear(NUEVA), 'CONTRASENA_INCORRECTA', 'la contraseña del respaldo no abre la bóveda actual');
  await S.desbloquear(OTRA);
  igual(JSON.stringify(S.estado()), firma, 'estado importado persistió');

  // Importar plano
  S.agregar('clientes', { nombre: 'Basura' });
  await S.guardar();
  await S.importarJSON(exportPlano);
  igual(JSON.stringify(S.estado()), firma, 'importar plano restaura el estado exacto');
  // Mismo salt que la bóveda abierta → se puede importar cifrado sin contraseña
  var exportMismoSalt = S.exportarJSON();
  await S.importarJSON(exportMismoSalt);
  igual(JSON.stringify(S.estado()), firma, 'importar cifrado de la misma bóveda sin contraseña');

  // borrarDatosEjemplo
  var noDemo = S.agregar('movimientos', {
    ambito: 'personal', cuentaId: 'cta_per_nu_demo', tipo: 'gasto', monto: 10, fecha: VF.util.hoy(),
    categoria: 'Otros gastos', descripcion: 'Real', estado: 'confirmado', etiquetas: []
  });
  var eliminados = S.borrarDatosEjemplo();
  ok(eliminados > 100, 'borrarDatosEjemplo eliminó registros: ' + eliminados);
  var quedanDemo = 0;
  ['cuentas', 'movimientos', 'clientes', 'facturas', 'proveedores', 'cuentasPorPagar', 'comisiones', 'prestamos', 'presupuestos', 'metas'].forEach(function (n) {
    S.listar(n).forEach(function (x) { if (/_demo$/.test(x.id)) quedanDemo++; });
  });
  igual(quedanDemo, 0, 'no quedan ids _demo');
  igual(S.estado().ajustes.datosEjemplo, false, 'datosEjemplo false tras borrar');
  ok(S.obtener('movimientos', noDemo.id), 'registros reales sobreviven');
  ok(S.obtener('movimientos', nuevo.id), 'movimiento agregado en pruebas (no demo) sobrevive');
  ok(S.obtener('clientes', 'cli_rapido_1'), 'cliente no demo sobrevive');
  await S.guardar();
  S.bloquear();
  await S.desbloquear(OTRA);
  igual(S.estado().ajustes.datosEjemplo, false, 'borrado de ejemplo persistió');

  // off
  S.off('cambio', onCambio);
  var n = eventos.length;
  S.setAjustes({ tema: 'oscuro' });
  igual(eventos.length, n, 'off deja de notificar');
  await S.guardar();

  // Bóveda corrupta
  S.bloquear();
  var corrupta = JSON.parse(localStorage.getItem('vf.boveda.v1'));
  corrupta.datos = corrupta.datos.slice(0, -8) + 'AAAAAAAA';
  localStorage.setItem('vf.boveda.v1', JSON.stringify(corrupta));
  await lanzaAsync(S.desbloquear(OTRA), 'DATOS_CORRUPTOS', 'datos alterados con contraseña correcta → DATOS_CORRUPTOS');
  await lanzaAsync(S.desbloquear('mala'), 'CONTRASENA_INCORRECTA', 'datos alterados con contraseña incorrecta → CONTRASENA_INCORRECTA');
  S.borrarTodo();
}

pruebasStore().then(function () {
  if (fallos.length) {
    console.error('FALLOS (' + fallos.length + ' de ' + total + '):');
    fallos.forEach(function (f) { console.error(' - ' + f); });
    process.exit(1);
  }
  console.log('OK ' + total + ' pruebas');
}, function (e) {
  console.error('Error inesperado:', e);
  if (fallos.length) fallos.forEach(function (f) { console.error(' - ' + f); });
  process.exit(1);
});
