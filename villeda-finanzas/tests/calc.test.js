'use strict';
/**
 * Pruebas de VF.calc en Node (node tests/calc.test.js).
 * Carga js/core/util.js y js/core/calc.js simulando el navegador (window = globalThis) y construye
 * un estado pequeño y determinista con la fecha fijada en 2026-10-25 (VF.calc.fijarHoy).
 * Salida: `OK n pruebas` o lista de fallos y process.exit(1).
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

globalThis.window = globalThis;
var RAIZ = path.resolve(__dirname, '..');
['util', 'calc'].forEach(function (nombre) {
  var ruta = path.join(RAIZ, 'js', 'core', nombre + '.js');
  new vm.Script(fs.readFileSync(ruta, 'utf8'), { filename: ruta }).runInThisContext();
});
var VF = globalThis.VF;
var C = VF.calc;
var U = VF.util;
var r2 = U.round2;

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
function igualJSON(a, b, msg) {
  igual(JSON.stringify(a), JSON.stringify(b), msg);
}
function lanza(fn, codigo, msg) {
  try {
    fn();
    ok(false, msg + ': no lanzó');
  } catch (e) {
    igual(e && e.message, codigo, msg);
  }
}
function dosDecimales(n) {
  return r2(n) === n;
}

// ---- Fecha fija ----
var HOY = '2026-10-25';
C.fijarHoy(HOY);

// ---- Estado de prueba ----
var AHORA = '2026-10-25T12:00:00.000Z';
var BBVA = 'cta_emp_bbva';
var BANORTE = 'cta_emp_banorte';
var ARCHIVADA = 'cta_emp_archivada';
var NU = 'cta_per_nu';
var AHORRO = 'cta_per_ahorro';
var TDC = 'cta_per_tdc';

function cuenta(id, ambito, tipo, saldoInicial, extra) {
  return Object.assign({
    id: id, ambito: ambito, nombre: id, banco: 'Banco', tipo: tipo, saldoInicial: saldoInicial, moneda: 'MXN',
    limiteCredito: null, diaCorte: null, diaPago: null, color: '#000', activa: true, creado: AHORA, actualizado: AHORA
  }, extra || {});
}

var contador = 0;
function mov(ambito, cuentaId, tipo, monto, fecha, categoria, extra) {
  contador += 1;
  return Object.assign({
    id: 'mov_' + contador, ambito: ambito, cuentaId: cuentaId, tipo: tipo, monto: monto, fecha: fecha,
    categoria: categoria, descripcion: 'SECRETO_DESC ' + contador, contraparte: 'SECRETO_CONTRA ' + contador,
    cuentaDestinoId: null, facturaId: null, cxpId: null, prestamoId: null, comisionId: null,
    estado: 'confirmado', etiquetas: [], creado: '2026-10-25T00:00:' + String(contador % 60).padStart(2, '0') + '.000Z', actualizado: AHORA
  }, extra || {});
}

function factura(id, clienteId, emision, vencimiento, subtotal, pagos, estado) {
  var iva = r2(subtotal * 0.16);
  return {
    id: id, folio: id.toUpperCase(), clienteId: clienteId, fechaEmision: emision, fechaVencimiento: vencimiento,
    concepto: 'SECRETO_DESC concepto', subtotal: subtotal, iva: iva, total: r2(subtotal + iva),
    estado: estado || 'emitida', pagos: pagos || [], uuidCfdi: '', notas: 'SECRETO_DESC notas', creado: AHORA, actualizado: AHORA
  };
}

function cxp(id, proveedorId, fecha, vencimiento, monto, pagos, estado) {
  return {
    id: id, proveedorId: proveedorId, concepto: 'SECRETO_DESC cxp', fecha: fecha, fechaVencimiento: vencimiento, monto: monto,
    pagos: pagos || [], estado: estado || 'pendiente', notas: '', creado: AHORA, actualizado: AHORA
  };
}

function prestamo(id, ambito, tipo, principal, tasaAnual, plazoMeses, fechaInicio, numPagos) {
  var p = {
    id: id, ambito: ambito, tipo: tipo, contraparte: 'SECRETO_CONTRA prestamo', principal: principal, tasaAnual: tasaAnual,
    plazoMeses: plazoMeses, fechaInicio: fechaInicio, diaPago: U.parseFecha(fechaInicio).getDate(), pagos: [], estado: 'activo',
    notas: 'SECRETO_DESC', creado: AHORA, actualizado: AHORA
  };
  // Pagos ya realizados según la tabla teórica (sin movimientos vinculados: no afectan saldos de cuentas).
  C.tablaAmortizacion(p).slice(0, numPagos).forEach(function (fila) {
    p.pagos.push({ id: id + '_pago_' + fila.n, fecha: fila.fecha, monto: fila.pago, capital: fila.capital, interes: fila.interes, movimientoId: null });
  });
  return p;
}

function construirEstado() {
  contador = 0; // ids y textos deterministas en cada estado construido
  var e = {
    version: 1,
    ajustes: { nombreUsuario: 'Prueba', nombreEmpresa: 'Empresa Prueba', moneda: 'MXN', autobloqueoMin: 5, reservaOperativaDias: 30, asistenteEndpoint: '', tema: 'auto', datosEjemplo: false },
    cuentas: [
      cuenta(BBVA, 'empresa', 'cheques', 100000),
      cuenta(BANORTE, 'empresa', 'cheques', 50000),
      cuenta(ARCHIVADA, 'empresa', 'efectivo', 999, { activa: false }),
      cuenta(NU, 'personal', 'cheques', 20000),
      cuenta(AHORRO, 'personal', 'ahorro', 15000),
      cuenta(TDC, 'personal', 'credito', -5000, { limiteCredito: 40000, diaCorte: 12, diaPago: 2 })
    ],
    movimientos: [],
    clientes: [
      { id: 'cli_1', nombre: 'SECRETO_CLIENTE Uno', rfc: '', email: '', telefono: '', notas: '', creado: AHORA, actualizado: AHORA },
      { id: 'cli_2', nombre: 'SECRETO_CLIENTE Dos', rfc: '', email: '', telefono: '', notas: '', creado: AHORA, actualizado: AHORA }
    ],
    facturas: [],
    proveedores: [
      { id: 'prov_1', nombre: 'SECRETO_PROV Uno', rfc: '', categoria: 'Materiales', contacto: '', telefono: '', email: '', notas: '', creado: AHORA, actualizado: AHORA },
      { id: 'prov_2', nombre: 'SECRETO_PROV Dos', rfc: '', categoria: 'Honorarios', contacto: '', telefono: '', email: '', notas: '', creado: AHORA, actualizado: AHORA }
    ],
    cuentasPorPagar: [],
    comisiones: [],
    prestamos: [],
    presupuestos: [],
    metas: [],
    categorias: {
      empresa: {
        ingreso: ['Ventas', 'Servicios', 'Anticipos', 'Otros ingresos', 'Aportación de capital'],
        gasto: ['Nómina', 'Renta', 'Proveedores', 'Materiales', 'Comisiones', 'Servicios (luz, agua, internet)', 'Impuestos', 'Software', 'Transporte', 'Publicidad', 'Honorarios', 'Préstamos', 'Retiro de socio', 'Otros gastos']
      },
      personal: {
        ingreso: ['Sueldo', 'Retiro de socio', 'Intereses', 'Otros ingresos'],
        gasto: ['Vivienda', 'Supermercado', 'Restaurantes', 'Transporte', 'Gasolina', 'Salud', 'Educación', 'Entretenimiento', 'Suscripciones', 'Ropa', 'Tarjeta de crédito', 'Préstamos', 'Ahorro', 'Aportación de capital', 'Otros gastos']
      }
    }
  };

  // Movimientos empresa (octubre 2026)
  e.movimientos.push(mov('empresa', BBVA, 'ingreso', 50000, '2026-10-05', 'Ventas', { id: 'mov_pago_f1', facturaId: 'fac_1' }));
  e.movimientos.push(mov('empresa', BANORTE, 'gasto', 20000, '2026-10-15', 'Nómina'));
  e.movimientos.push(mov('empresa', BBVA, 'gasto', 5000, '2026-10-03', 'Renta'));
  e.movimientos.push(mov('empresa', BBVA, 'transferencia', 10000, '2026-10-10', 'Transferencia entre cuentas', { cuentaDestinoId: BANORTE }));
  e.movimientos.push(mov('empresa', BBVA, 'transferencia', 8000, '2026-10-12', 'Retiro de socio', { id: 'mov_retiro', cuentaDestinoId: NU }));
  // Septiembre 2026 empresa
  e.movimientos.push(mov('empresa', BBVA, 'ingreso', 40000, '2026-09-10', 'Servicios'));
  e.movimientos.push(mov('empresa', BANORTE, 'gasto', 12000, '2026-09-15', 'Nómina'));
  e.movimientos.push(mov('empresa', BBVA, 'gasto', 2000, '2026-09-20', 'Materiales'));
  // Materiales: duplicado + atípico (5 muestras, mediana 2380)
  e.movimientos.push(mov('empresa', BBVA, 'gasto', 2380, '2026-10-19', 'Materiales', { id: 'mov_dup_a' }));
  e.movimientos.push(mov('empresa', BBVA, 'gasto', 2380, '2026-10-19', 'Materiales', { id: 'mov_dup_b' }));
  e.movimientos.push(mov('empresa', BBVA, 'gasto', 2500, '2026-10-02', 'Materiales'));
  e.movimientos.push(mov('empresa', BBVA, 'gasto', 20000, '2026-10-21', 'Materiales', { id: 'mov_atipico' }));
  // Movimientos personales (octubre 2026)
  e.movimientos.push(mov('personal', NU, 'ingreso', 30000, '2026-10-01', 'Sueldo'));
  e.movimientos.push(mov('personal', NU, 'gasto', 4000, '2026-10-08', 'Supermercado'));
  e.movimientos.push(mov('personal', TDC, 'gasto', 1500, '2026-10-20', 'Restaurantes'));
  e.movimientos.push(mov('personal', NU, 'transferencia', 5000, '2026-10-18', 'Transferencia entre cuentas', { cuentaDestinoId: AHORRO }));
  e.movimientos.push(mov('personal', NU, 'gasto', 300, '2026-10-22', 'Transporte', { id: 'mov_revisar', estado: 'revisar' }));
  e.movimientos.push(mov('personal', NU, 'gasto', 200, '2026-10-23', '', { id: 'mov_sincat' }));
  e.movimientos.push(mov('personal', NU, 'transferencia', 2000, '2026-10-22', 'Transferencia entre cuentas', { cuentaDestinoId: TDC }));

  // Facturas
  e.facturas.push(factura('fac_1', 'cli_1', '2026-09-20', '2026-10-20', 43103.45, [{ id: 'p1', fecha: '2026-10-05', monto: 50000, cuentaId: BBVA, movimientoId: 'mov_pago_f1' }]));
  e.facturas.push(factura('fac_2', 'cli_1', '2026-10-01', '2026-10-31', 10000));
  e.facturas.push(factura('fac_3', 'cli_2', '2026-08-01', '2026-08-31', 20000));
  e.facturas.push(factura('fac_4', 'cli_2', '2026-09-01', '2026-09-30', 10000, [{ id: 'p2', fecha: '2026-09-25', monto: 5000, cuentaId: BBVA, movimientoId: null }]));
  e.facturas.push(factura('fac_5', 'cli_1', '2026-10-20', '2026-11-20', 86206.03, [], 'borrador'));
  e.facturas.push(factura('fac_6', 'cli_2', '2026-10-20', '2026-11-20', 1000, [], 'cancelada'));

  // Cuentas por pagar
  e.cuentasPorPagar.push(cxp('cxp_1', 'prov_1', '2026-10-01', '2026-10-28', 15000));
  e.cuentasPorPagar.push(cxp('cxp_2', 'prov_1', '2026-09-15', '2026-10-15', 8000, [{ id: 'pc1', fecha: '2026-10-10', monto: 3000, cuentaId: BBVA, movimientoId: null }]));
  e.cuentasPorPagar.push(cxp('cxp_3', 'prov_2', '2026-10-20', '2026-11-20', 4000, [{ id: 'pc2', fecha: '2026-10-21', monto: 4000, cuentaId: BBVA, movimientoId: null }]));
  e.cuentasPorPagar.push(cxp('cxp_4', 'prov_2', '2026-10-20', '2026-11-20', 7000, [], 'cancelada'));

  // Comisiones
  e.comisiones.push({ id: 'com_1', beneficiario: 'SECRETO_CONTRA comision', facturaId: 'fac_2', base: 10000, porcentaje: 15, monto: 1500, fecha: '2026-10-27', estado: 'pendiente', movimientoId: null, notas: '', creado: AHORA, actualizado: AHORA });
  e.comisiones.push({ id: 'com_2', beneficiario: 'SECRETO_CONTRA comision', facturaId: 'fac_1', base: 30000, porcentaje: 3, monto: 900, fecha: '2026-10-06', estado: 'pagada', movimientoId: null, notas: '', creado: AHORA, actualizado: AHORA });

  // Préstamos
  e.prestamos.push(prestamo('pre_emp', 'empresa', 'recibido', 120000, 12, 12, '2026-07-10', 3));      // próximo: n=4, 2026-11-10
  e.prestamos.push(prestamo('pre_per', 'personal', 'recibido', 50000, 10, 24, '2026-01-05', 9));      // próximo: n=10, 2026-11-05
  e.prestamos.push(prestamo('pre_otorgado', 'personal', 'otorgado', 10000, 0, 10, '2026-08-15', 2));  // próximo cobro: n=3, 2026-11-15
  e.prestamos.push(Object.assign(prestamo('pre_liquidado', 'empresa', 'recibido', 1000, 0, 2, '2026-01-01', 2), { estado: 'liquidado' }));

  // Presupuestos octubre
  [['empresa', 'Nómina', 25000], ['empresa', 'Renta', 5000], ['empresa', 'Materiales', 10000], ['personal', 'Supermercado', 5000]].forEach(function (p, i) {
    e.presupuestos.push({ id: 'ppto_' + i, ambito: p[0], periodo: '2026-10', categoria: p[1], monto: p[2], creado: AHORA, actualizado: AHORA });
  });
  // Presupuesto de otro mes (no debe aparecer)
  e.presupuestos.push({ id: 'ppto_sep', ambito: 'empresa', periodo: '2026-09', categoria: 'Renta', monto: 4000, creado: AHORA, actualizado: AHORA });

  // Metas
  e.metas.push({ id: 'meta_1', ambito: 'personal', nombre: 'SECRETO_META fondo', objetivo: 50000, cuentaId: AHORRO, fechaMeta: '2027-06-30', notas: '', creado: AHORA, actualizado: AHORA });
  e.metas.push({ id: 'meta_2', ambito: 'personal', nombre: 'SECRETO_META viaje', objetivo: 20000, cuentaId: null, fechaMeta: '2027-03-01', notas: '', creado: AHORA, actualizado: AHORA });

  return e;
}

var estado = construirEstado();
var OCT = { desde: '2026-10-01', hasta: '2026-10-31' };

// ================= hoy / fijarHoy =================
(function () {
  igual(C.hoy(), HOY, 'fijarHoy fija la fecha de calc');
  C.fijarHoy(null);
  igual(C.hoy(), U.hoy(), 'fijarHoy(null) vuelve a la fecha real');
  C.fijarHoy(HOY);
})();

// ================= Saldos =================
(function () {
  igual(C.saldoCuenta(estado, BBVA), 137740, 'saldo BBVA (ingresos − gastos − transferencias salientes, ambos ámbitos)');
  igual(C.saldoCuenta(estado, BANORTE), 28000, 'saldo Banorte (recibe transferencia interna)');
  igual(C.saldoCuenta(estado, NU), 46500, 'saldo Nu (recibe retiro de socio desde empresa)');
  igual(C.saldoCuenta(estado, AHORRO), 20000, 'saldo ahorro (transferencia personal)');
  igual(C.saldoCuenta(estado, TDC), -4500, 'tarjeta de crédito: saldo negativo = deuda; pago por transferencia reduce la deuda');
  igual(C.saldoCuenta(estado, 'no_existe'), 0, 'cuenta inexistente → 0');

  var emp = C.saldosPorAmbito(estado, 'empresa');
  igual(emp.liquido, 165740, 'líquido empresa excluye la cuenta archivada');
  igual(emp.credito, 0, 'empresa sin tarjetas');
  igual(emp.total, 165740, 'total empresa');
  igual(emp.cuentas.length, 2, 'cuentas activas empresa');

  var per = C.saldosPorAmbito(estado, 'personal');
  igual(per.liquido, 66500, 'líquido personal');
  igual(per.credito, -4500, 'crédito personal (deuda negativa)');
  igual(per.total, 62000, 'total personal = líquido + crédito');

  var comb = C.combinado(estado);
  igual(comb.empresa.liquido, 165740, 'combinado.empresa');
  igual(comb.personal.liquido, 66500, 'combinado.personal');
  igual(comb.combinadoInformativo.liquido, 232240, 'combinado informativo líquido');
  igual(comb.combinadoInformativo.total, 227740, 'combinado informativo total');
  ok(/informativo/i.test(comb.combinadoInformativo.etiqueta), 'suma combinada etiquetada como informativa');

  lanza(function () { C.saldosPorAmbito(estado, 'todos'); }, 'AMBITO_REQUERIDO', 'saldosPorAmbito exige ámbito válido');
  lanza(function () { C.ingresos(estado, undefined, OCT.desde, OCT.hasta); }, 'AMBITO_REQUERIDO', 'ingresos exige ámbito');
})();

// ================= Movimientos, ingresos, gastos, utilidad =================
(function () {
  var movs = C.movimientosEn(estado, 'empresa', OCT.desde, OCT.hasta);
  igual(movs.length, 9, 'movimientosEn empresa octubre');
  ok(movs !== estado.movimientos, 'movimientosEn devuelve lista nueva');
  ok(movs[0].fecha >= movs[movs.length - 1].fecha, 'movimientosEn ordenado por fecha descendente');
  igual(C.movimientosEn(estado, 'empresa', OCT.desde, OCT.hasta, { tipo: 'gasto' }).length, 6, 'filtro tipo');
  igual(C.movimientosEn(estado, 'empresa', OCT.desde, OCT.hasta, { categoria: 'Materiales' }).length, 4, 'filtro categoría');
  igual(C.movimientosEn(estado, 'empresa', OCT.desde, OCT.hasta, { cuentaId: BANORTE }).length, 2, 'filtro cuenta incluye transferencias recibidas');
  igual(C.movimientosEn(estado, 'personal', null, null, { estado: 'revisar' }).length, 1, 'filtro estado, sin límite de fechas');
  igual(C.movimientosEn(estado, 'empresa', '2026-10-19', '2026-10-19').length, 2, 'rango inclusivo en ambos extremos');

  igual(C.ingresos(estado, 'empresa', OCT.desde, OCT.hasta), 50000, 'ingresos empresa octubre (excluye transferencias)');
  igual(C.gastos(estado, 'empresa', OCT.desde, OCT.hasta), 52260, 'gastos empresa octubre (excluye transferencias y retiro de socio)');
  igual(C.balance(estado, 'empresa', OCT.desde, OCT.hasta), -2260, 'balance empresa octubre');
  igual(C.ingresos(estado, 'personal', OCT.desde, OCT.hasta), 30000, 'ingresos personal octubre (el retiro recibido NO es ingreso)');
  igual(C.gastos(estado, 'personal', OCT.desde, OCT.hasta), 6000, 'gastos personal octubre');
  igual(C.balance(estado, 'personal', OCT.desde, OCT.hasta), 24000, 'balance personal octubre');

  var u = C.utilidadMes(estado, '2026-10');
  igual(u.ingresos, 50000, 'utilidadMes.ingresos');
  igual(u.gastos, 52260, 'utilidadMes.gastos');
  igual(u.utilidad, -2260, 'utilidadMes.utilidad');
  igual(u.margen, -4.52, 'utilidadMes.margen %');
  igual(u.periodo, '2026-10', 'utilidadMes.periodo');
  igual(C.utilidadMes(estado).periodo, '2026-10', 'utilidadMes sin periodo usa el mes de hoy()');
  igual(C.utilidadMes(estado, '2025-01').margen, null, 'margen null sin ingresos');
  igual(C.utilidadMes(estado, '2026-09').utilidad, 26000, 'utilidad septiembre');

  var gpc = C.gastosPorCategoria(estado, 'empresa', OCT.desde, OCT.hasta);
  igualJSON(gpc.map(function (f) { return f.categoria; }), ['Materiales', 'Nómina', 'Renta'], 'gastosPorCategoria ordenado desc');
  igual(gpc[0].monto, 27260, 'gastosPorCategoria monto Materiales');
  igual(r2(gpc[0].porcentaje + gpc[1].porcentaje + gpc[2].porcentaje), 100, 'porcentajes suman 100');
  var gpcPer = C.gastosPorCategoria(estado, 'personal', OCT.desde, OCT.hasta);
  igual(gpcPer.filter(function (f) { return f.categoria === 'Sin categoría'; })[0].monto, 200, 'gasto sin categoría agrupado como "Sin categoría"');
  var ipc = C.ingresosPorCategoria(estado, 'empresa', '2026-09-01', OCT.hasta);
  igualJSON(ipc.map(function (f) { return [f.categoria, f.monto]; }), [['Ventas', 50000], ['Servicios', 40000]], 'ingresosPorCategoria');

  var serie = C.serieMensual(estado, 'empresa', 3);
  igualJSON(serie.map(function (s) { return s.periodo; }), ['2026-08', '2026-09', '2026-10'], 'serieMensual del más antiguo al actual');
  igualJSON(serie[1], { periodo: '2026-09', ingresos: 40000, gastos: 14000, balance: 26000 }, 'serieMensual septiembre');
  igualJSON(serie[0], { periodo: '2026-08', ingresos: 0, gastos: 0, balance: 0 }, 'serieMensual mes sin movimientos');
  igual(C.serieMensual(estado, 'personal').length, 6, 'serieMensual 6 meses por defecto');
})();

// ================= Facturas y cuentas por cobrar =================
(function () {
  var f1 = estado.facturas[0], f2 = estado.facturas[1], f3 = estado.facturas[2], f4 = estado.facturas[3];
  igual(f1.total, 50000, 'total factura 1 (iva 16 % redondeado)');
  igual(C.pagadoFactura(f1), 50000, 'pagadoFactura');
  igual(C.pendienteFactura(f1), 0, 'pendienteFactura pagada');
  igual(C.estadoFactura(f1), 'pagada', 'estadoFactura pagada');
  igual(C.estadoFactura(f2), 'emitida', 'estadoFactura emitida vigente');
  igual(C.estadoFactura(f2, '2026-11-01'), 'vencida', 'estadoFactura acepta hoy explícito');
  igual(C.estadoFactura(f3), 'vencida', 'estadoFactura vencida');
  igual(C.estadoFactura(f4), 'parcial', 'estadoFactura parcial (aunque vencida)');
  igual(C.pendienteFactura(f4), 6600, 'pendiente parcial');
  igual(C.estadoFactura(estado.facturas[4]), 'borrador', 'borrador se conserva');
  igual(C.estadoFactura(estado.facturas[5]), 'cancelada', 'cancelada se conserva');

  var cxc = C.porCobrar(estado);
  igual(cxc.total, 41400, 'porCobrar.total excluye borrador/cancelada/pagadas');
  igual(cxc.vencido, 29800, 'porCobrar.vencido incluye parcial vencida');
  igual(cxc.facturas.length, 3, 'porCobrar.facturas');
  igualJSON(cxc.facturas.map(function (x) { return x.factura.id; }), ['fac_3', 'fac_4', 'fac_2'], 'porCobrar ordenado por vencimiento');
  igual(cxc.facturas[0].dias, 55, 'días vencidos fac_3');
  igual(cxc.facturas[2].dias, -6, 'días por vencer (negativo) fac_2');
  igual(cxc.porCliente[0].clienteId, 'cli_2', 'porCliente ordenado por total desc');
  igual(cxc.porCliente[0].total, 29800, 'porCliente total');
  igual(cxc.porCliente[0].vencido, 29800, 'porCliente vencido');
  igual(cxc.porCliente[1].total, 11600, 'porCliente cliente 1');

  var ant = C.antiguedadCxC(estado);
  igualJSON(ant, { '0-30': 18200, '31-60': 23200, '61-90': 0, '90+': 0 }, 'antiguedadCxC (lo no vencido en 0-30)');
  igual(r2(ant['0-30'] + ant['31-60'] + ant['61-90'] + ant['90+']), cxc.total, 'antigüedad suma el total por cobrar');
})();

// ================= Cuentas por pagar y comisiones =================
(function () {
  var x1 = estado.cuentasPorPagar[0], x2 = estado.cuentasPorPagar[1], x3 = estado.cuentasPorPagar[2], x4 = estado.cuentasPorPagar[3];
  igual(C.pendienteCxP(x1), 15000, 'pendienteCxP');
  igual(C.estadoCxP(x1), 'pendiente', 'estadoCxP pendiente');
  igual(C.estadoCxP(x1, '2026-10-29'), 'vencida', 'estadoCxP con hoy explícito');
  igual(C.estadoCxP(x2), 'parcial', 'estadoCxP parcial');
  igual(C.estadoCxP(x3), 'pagada', 'estadoCxP pagada');
  igual(C.estadoCxP(x4), 'cancelada', 'estadoCxP cancelada');

  var cxp = C.porPagar(estado);
  igual(cxp.total, 20000, 'porPagar.total');
  igual(cxp.vencido, 5000, 'porPagar.vencido');
  igual(cxp.cuentas.length, 2, 'porPagar.cuentas');
  igual(cxp.porProveedor.length, 1, 'porProveedor sólo con pendientes');
  igual(cxp.porProveedor[0].total, 20000, 'porProveedor total');

  var com = C.comisionesPendientes(estado);
  igual(com.total, 1500, 'comisionesPendientes.total');
  igual(com.lista.length, 1, 'comisionesPendientes.lista');
})();

// ================= Préstamos =================
(function () {
  var p = estado.prestamos[0];
  var pm = C.pagoMensual(p);
  igual(pm, 10661.85, 'pagoMensual francés 120000 @12 % 12 meses');
  var tabla = C.tablaAmortizacion(p);
  igual(tabla.length, 12, 'tabla con n filas');
  igual(tabla[0].fecha, '2026-08-10', 'primer pago un mes después del inicio');
  igual(tabla[0].interes, 1200, 'interés primer mes = saldo × r');
  igual(tabla[0].capital, 9461.85, 'capital primer mes = pago − interés');
  igual(tabla[11].saldo, 0, 'saldo final cierra en 0');
  igual(U.suma(tabla, function (f) { return f.capital; }), 120000, 'suma de capital = principal');
  ok(tabla.slice(0, 11).every(function (f) { return f.pago === pm; }), 'todas las filas salvo la última pagan la mensualidad exacta');
  ok(tabla.every(function (f) { return dosDecimales(f.pago) && dosDecimales(f.capital) && dosDecimales(f.interes) && dosDecimales(f.saldo); }), 'tabla con 2 decimales');
  ok(Math.abs(tabla[11].pago - pm) < 1, 'último pago ajustado por centavos');

  var irregular = { principal: 33333.33, tasaAnual: 7.77, plazoMeses: 7, fechaInicio: '2026-01-31', diaPago: 31, pagos: [], estado: 'activo' };
  var ti = C.tablaAmortizacion(irregular);
  igual(ti[ti.length - 1].saldo, 0, 'cierre en 0 con cifras irregulares');
  igual(U.suma(ti, function (f) { return f.capital; }), 33333.33, 'capital total con cifras irregulares');
  igual(ti[0].fecha, '2026-02-28', 'día de pago ajustado al máximo del mes');
  igual(ti[1].fecha, '2026-03-31', 'día de pago 31 se conserva cuando el mes lo permite');

  var sinInteres = estado.prestamos[2];
  igual(C.pagoMensual(sinInteres), 1000, 'tasa 0 → principal / n');
  ok(C.tablaAmortizacion(sinInteres).every(function (f) { return f.interes === 0 && f.pago === 1000; }), 'tabla sin intereses');

  igual(C.saldoPrestamo(p), tabla[2].saldo, 'saldoPrestamo = principal − capital pagado');
  igual(C.saldoPrestamo(sinInteres), 8000, 'saldoPrestamo otorgado');

  var prox = C.proximoPagoPrestamo(p, HOY);
  igual(prox.n, 4, 'próximo pago n');
  igual(prox.fecha, '2026-11-10', 'próximo pago fecha');
  igual(prox.monto, pm, 'próximo pago monto = mensualidad');
  igual(prox.vencido, false, 'próximo pago no vencido');
  igual(C.proximoPagoPrestamo(sinInteres, HOY).fecha, '2026-11-15', 'próximo cobro préstamo otorgado');
  igual(C.proximoPagoPrestamo(estado.prestamos[3], HOY), null, 'préstamo liquidado → null');
  var casiFin = { principal: 1000, tasaAnual: 0, plazoMeses: 2, fechaInicio: '2026-09-01', diaPago: 1, estado: 'activo', pagos: [{ capital: 500, interes: 0, monto: 500, fecha: '2026-10-01' }] };
  igual(C.proximoPagoPrestamo(casiFin, HOY).monto, 500, 'último pago liquida el saldo');
  igual(C.proximoPagoPrestamo(casiFin, '2026-12-01').vencido, true, 'pago vencido se marca');
})();

// ================= Vencimientos =================
(function () {
  var v = C.vencimientos(estado, HOY, U.sumarDias(HOY, 6));
  igualJSON(v.map(function (x) { return [x.fecha, x.tipo, x.ambito, x.monto, x.origen.coleccion]; }), [
    ['2026-10-27', 'pago', 'empresa', 1500, 'comisiones'],
    ['2026-10-28', 'pago', 'empresa', 15000, 'cuentasPorPagar'],
    ['2026-10-31', 'cobro', 'empresa', 11600, 'facturas']
  ], 'vencimientos próximos 7 días ordenados por fecha');
  ok(v.every(function (x) { return x.origen.id && typeof x.concepto === 'string' && typeof x.dias === 'number'; }), 'vencimientos con origen, concepto y días');

  var v30 = C.vencimientos(estado, HOY, U.sumarDias(HOY, 30));
  var porColeccion = {};
  v30.forEach(function (x) { porColeccion[x.origen.coleccion + ':' + x.origen.id] = x; });
  ok(porColeccion['cuentas:' + TDC] && porColeccion['cuentas:' + TDC].fecha === '2026-11-02' && porColeccion['cuentas:' + TDC].monto === 4500 && porColeccion['cuentas:' + TDC].ambito === 'personal', 'tarjeta de crédito con deuda en su día de pago');
  ok(porColeccion['prestamos:pre_emp'] && porColeccion['prestamos:pre_emp'].tipo === 'pago' && porColeccion['prestamos:pre_emp'].ambito === 'empresa', 'préstamo recibido = pago');
  ok(porColeccion['prestamos:pre_otorgado'] && porColeccion['prestamos:pre_otorgado'].tipo === 'cobro' && porColeccion['prestamos:pre_otorgado'].ambito === 'personal', 'préstamo otorgado = cobro');
  ok(!porColeccion['prestamos:pre_liquidado'], 'préstamo liquidado no genera vencimiento');
  ok(!porColeccion['cuentasPorPagar:cxp_3'] && !porColeccion['cuentasPorPagar:cxp_4'], 'CxP pagada/cancelada no aparecen');
  for (var i = 1; i < v30.length; i++) ok(v30[i - 1].fecha <= v30[i].fecha, 'vencimientos ordenados (' + i + ')');

  var vencidos = C.vencimientos(estado, null, U.sumarDias(HOY, -1));
  igualJSON(vencidos.map(function (x) { return x.origen.id; }).sort(), ['cxp_2', 'fac_3', 'fac_4'], 'vencimientos pasados (sin límite inferior)');
  ok(vencidos.every(function (x) { return x.vencido === true && x.dias < 0; }), 'vencidos marcados');
})();

// ================= Presupuesto vs real =================
(function () {
  var pr = C.presupuestoVsReal(estado, 'empresa', '2026-10');
  igualJSON(pr.map(function (f) { return [f.categoria, f.presupuesto, f.real, f.diferencia, f.porcentaje]; }), [
    ['Nómina', 25000, 20000, 5000, 80],
    ['Materiales', 10000, 27260, -17260, 272.6],
    ['Renta', 5000, 5000, 0, 100]
  ], 'presupuestoVsReal empresa');
  igual(pr.totalPresupuesto, 40000, 'totalPresupuesto');
  igual(pr.totalReal, 52260, 'totalReal');
  igual(pr.totalDiferencia, -12260, 'totalDiferencia');
  igual(pr.periodo, '2026-10', 'periodo en el resultado');

  var pp = C.presupuestoVsReal(estado, 'personal', '2026-10');
  igual(pp[0].categoria, 'Supermercado', 'personal: categoría presupuestada primero');
  igual(pp[0].real, 4000, 'personal real supermercado');
  var sinPpto = pp.filter(function (f) { return f.sinPresupuesto; });
  igualJSON(sinPpto.map(function (f) { return f.categoria; }), ['Restaurantes', 'Transporte', 'Sin categoría'], 'gastos sin presupuesto aparecen con presupuesto 0');
  igual(pp.totalReal, 6000, 'totalReal personal (sin ingresos ni transferencias)');
  igual(C.presupuestoVsReal(estado, 'empresa', '2026-09')[0].presupuesto, 4000, 'presupuesto de otro mes');
  igual(C.presupuestoVsReal(estado, 'empresa', '2025-01').length, 0, 'sin presupuestos ni gastos → vacío');
})();

// ================= Disponible y flujo =================
(function () {
  var dp = C.disponiblePersonal(estado);
  igual(dp.liquido, 66500, 'disponiblePersonal.liquido = sólo cuentas personales');
  var pmPer = C.proximoPagoPrestamo(estado.prestamos[1], HOY).monto;
  igualJSON(dp.compromisos.map(function (c) { return c.origen.id; }), [TDC, 'pre_per'], 'compromisos personales: tarjeta y préstamo recibido (no el otorgado)');
  igual(dp.totalCompromisos, r2(4500 + pmPer), 'totalCompromisos personal');
  igual(dp.disponible, r2(66500 - 4500 - pmPer), 'disponible personal');
  igual(dp.dias, 30, 'dias por defecto 30');
  igual(C.disponiblePersonal(estado, 7).totalCompromisos, 0, 'disponiblePersonal(7): nada vence en 7 días');
  igual(C.disponiblePersonal(estado, 7).disponible, 66500, 'disponiblePersonal(7) = líquido');
  ok(dp.compromisos.every(function (c) { return c.ambito === 'personal'; }), 'compromisos personales sin registros de empresa');

  var de = C.disponibleEmpresa(estado);
  var pmEmp = C.pagoMensual(estado.prestamos[0]);
  igual(de.dias, 30, 'disponibleEmpresa usa reservaOperativaDias');
  igual(de.liquido, 165740, 'disponibleEmpresa.liquido');
  igualJSON(de.compromisos.map(function (c) { return c.origen.id; }), ['cxp_2', 'com_1', 'cxp_1', 'pre_emp'], 'compromisos empresa incluyen lo vencido pendiente');
  igual(de.totalCompromisos, r2(5000 + 1500 + 15000 + pmEmp), 'totalCompromisos empresa');
  igual(de.disponible, r2(165740 - de.totalCompromisos), 'disponible empresa');
  igual(C.disponibleEmpresa(estado, 2).totalCompromisos, 6500, 'disponibleEmpresa(2): vencido + comisión');
  igual(C.disponibleEmpresa(estado, 3).totalCompromisos, 21500, 'disponibleEmpresa(3): el rango es inclusivo (incluye el 28 oct)');
  var sinAjuste = construirEstado();
  sinAjuste.ajustes.reservaOperativaDias = 45;
  igual(C.disponibleEmpresa(sinAjuste).dias, 45, 'disponibleEmpresa respeta reservaOperativaDias');

  var flujo = C.flujoProyectado(estado, 'empresa', 7);
  igual(flujo.length, 8, 'flujo diario hoy..hoy+7');
  igual(flujo[0].fecha, HOY, 'flujo empieza hoy');
  igual(flujo[0].saldo, 190540, 'flujo día 0: líquido + cobros vencidos − pagos vencidos');
  igual(flujo[2].salidas, 1500, 'flujo salidas comisión 27 oct');
  igual(flujo[3].salidas, 15000, 'flujo salidas CxP 28 oct');
  igual(flujo[6].entradas, 11600, 'flujo entradas factura 31 oct');
  igual(flujo[7].saldo, 185640, 'flujo saldo final');
  var flujoPer = C.flujoProyectado(estado, 'personal', 10);
  igual(flujoPer[0].saldo, 66500, 'flujo personal parte del líquido personal');
  igual(flujoPer[8].salidas, 4500, 'flujo personal: pago de tarjeta el 2 nov');
})();

// ================= Movimientos a revisar =================
(function () {
  var rev = C.movimientosARevisar(estado);
  igual(rev.duplicados.length, 1, 'un par duplicado');
  igualJSON(rev.duplicados[0].map(function (m) { return m.id; }), ['mov_dup_a', 'mov_dup_b'], 'duplicado identifica el par');
  igual(rev.atipicos.length, 1, 'un atípico');
  igual(rev.atipicos[0].mov.id, 'mov_atipico', 'atípico identificado');
  igual(rev.atipicos[0].mediana, 2380, 'mediana de la categoría');
  igual(rev.marcados.length, 1, 'un marcado revisar');
  igual(rev.marcados[0].id, 'mov_revisar', 'marcado identificado');
  igual(rev.sinCategoria.length, 1, 'uno sin categoría (las transferencias no cuentan)');
  igual(rev.sinCategoria[0].id, 'mov_sincat', 'sin categoría identificado');
  igual(rev.total, 4, 'total de hallazgos');

  var revEmp = C.movimientosARevisar(estado, 'empresa');
  igual(revEmp.duplicados.length, 1, 'empresa: duplicado');
  igual(revEmp.marcados.length + revEmp.sinCategoria.length, 0, 'empresa: sin hallazgos personales');
  var revPer = C.movimientosARevisar(estado, 'personal');
  igual(revPer.duplicados.length + revPer.atipicos.length, 0, 'personal: sin hallazgos de empresa');
  igual(revPer.marcados.length, 1, 'personal: marcado');

  // Mínimo 4 muestras para atípicos
  var e2 = construirEstado();
  e2.movimientos.push(mov('personal', NU, 'gasto', 100, '2026-10-01', 'Gasolina'));
  e2.movimientos.push(mov('personal', NU, 'gasto', 100, '2026-10-02', 'Gasolina'));
  e2.movimientos.push(mov('personal', NU, 'gasto', 5000, '2026-10-03', 'Gasolina'));
  igual(C.movimientosARevisar(e2, 'personal').atipicos.length, 0, 'con 3 muestras no hay atípico');
  e2.movimientos.push(mov('personal', NU, 'gasto', 100, '2026-10-04', 'Gasolina'));
  igual(C.movimientosARevisar(e2, 'personal').atipicos.length, 1, 'con 4 muestras sí hay atípico');
})();

// ================= Metas =================
(function () {
  var m1 = C.metaProgreso(estado, estado.metas[0]);
  igualJSON(m1, { ahorrado: 20000, objetivo: 50000, porcentaje: 40, faltante: 30000 }, 'metaProgreso con cuenta');
  var m2 = C.metaProgreso(estado, estado.metas[1]);
  igualJSON(m2, { ahorrado: 0, objetivo: 20000, porcentaje: 0, faltante: 20000 }, 'metaProgreso sin cuenta');
  var m3 = C.metaProgreso(estado, { objetivo: 10000, cuentaId: AHORRO });
  igual(m3.porcentaje, 100, 'porcentaje tope 100');
  igual(m3.faltante, 0, 'faltante no negativo');
})();

// ================= Resumen para IA =================
(function () {
  var r = C.resumenParaIA(estado);
  var texto = JSON.stringify(r);
  ok(texto.indexOf('SECRETO') < 0, 'resumenParaIA sin descripciones, contrapartes, clientes, proveedores ni metas por nombre');
  igual(r.empresa.liquido, 165740, 'resumen empresa líquido');
  igual(r.personal.liquido, 66500, 'resumen personal líquido');
  igual(r.empresa.utilidadMes.utilidad, -2260, 'resumen utilidad mes');
  igual(r.empresa.porCobrar.total, 41400, 'resumen por cobrar');
  igual(r.empresa.porPagar.total, 20000, 'resumen por pagar');
  igual(r.personal.disponible.disponible, C.disponiblePersonal(estado).disponible, 'resumen disponible personal');
  igual(r.vencimientos14.length, C.vencimientos(estado, HOY, U.sumarDias(HOY, 14)).length, 'resumen vencimientos 14 días');
  ok(r.vencimientos14.every(function (v) { return !v.concepto && !v.origen; }), 'vencimientos del resumen sin concepto');
  igual(r.revisar.total, 4, 'resumen revisar');
  igual(r.moneda, 'MXN', 'resumen moneda');
})();

// ================= Separación de ámbitos =================
function instantanea(e, ambito) {
  var disp = ambito === 'empresa' ? C.disponibleEmpresa(e) : C.disponiblePersonal(e);
  return JSON.stringify({
    saldos: C.saldosPorAmbito(e, ambito),
    ingresos: C.ingresos(e, ambito, OCT.desde, OCT.hasta),
    gastos: C.gastos(e, ambito, OCT.desde, OCT.hasta),
    balance: C.balance(e, ambito, OCT.desde, OCT.hasta),
    ingresosTodo: C.ingresos(e, ambito, null, null),
    gastosTodo: C.gastos(e, ambito, null, null),
    utilidad: ambito === 'empresa' ? C.utilidadMes(e, '2026-10') : null,
    gpc: C.gastosPorCategoria(e, ambito, null, null),
    ipc: C.ingresosPorCategoria(e, ambito, null, null),
    serie: C.serieMensual(e, ambito, 6),
    ppto: C.presupuestoVsReal(e, ambito, '2026-10').map(function (f) { return [f.categoria, f.presupuesto, f.real]; }),
    pptoTot: [C.presupuestoVsReal(e, ambito, '2026-10').totalPresupuesto, C.presupuestoVsReal(e, ambito, '2026-10').totalReal],
    disponible: [disp.liquido, disp.totalCompromisos, disp.disponible],
    flujo: C.flujoProyectado(e, ambito, 30),
    revisar: (function (r) {
      return {
        duplicados: r.duplicados.map(function (par) { return [par[0].id, par[1].id]; }),
        atipicos: r.atipicos.map(function (a) { return [a.mov.id, a.mediana]; }),
        marcados: r.marcados.map(function (m) { return m.id; }),
        sinCategoria: r.sinCategoria.map(function (m) { return m.id; }),
        total: r.total
      };
    })(C.movimientosARevisar(e, ambito)),
    movs: C.movimientosEn(e, ambito, null, null).map(function (m) { return [m.id, m.monto, m.fecha]; })
  });
}

(function () {
  var base = construirEstado();
  var antesEmp = instantanea(base, 'empresa');
  var antesPer = instantanea(base, 'personal');

  // Agregar movimientos PERSONALES de todo tipo (incluida una transferencia personal→personal y un duplicado)
  var conPersonal = construirEstado();
  conPersonal.movimientos.push(mov('personal', NU, 'ingreso', 9999, '2026-10-02', 'Intereses'));
  conPersonal.movimientos.push(mov('personal', AHORRO, 'gasto', 777, '2026-10-03', 'Salud'));
  conPersonal.movimientos.push(mov('personal', AHORRO, 'gasto', 777, '2026-10-03', 'Salud'));
  conPersonal.movimientos.push(mov('personal', NU, 'gasto', 50, '2026-10-04', '', { estado: 'revisar' }));
  conPersonal.movimientos.push(mov('personal', AHORRO, 'transferencia', 1234, '2026-10-05', 'Transferencia entre cuentas', { cuentaDestinoId: NU }));
  conPersonal.presupuestos.push({ id: 'ppto_x', ambito: 'personal', periodo: '2026-10', categoria: 'Salud', monto: 1000, creado: AHORA, actualizado: AHORA });
  igual(instantanea(conPersonal, 'empresa'), antesEmp, 'SEPARACIÓN: agregar registros personales no cambia ningún total de empresa');
  ok(instantanea(conPersonal, 'personal') !== antesPer, 'control: los totales personales sí cambian');

  // Agregar movimientos de EMPRESA
  var conEmpresa = construirEstado();
  conEmpresa.movimientos.push(mov('empresa', BBVA, 'ingreso', 123456, '2026-10-06', 'Ventas'));
  conEmpresa.movimientos.push(mov('empresa', BANORTE, 'gasto', 4321, '2026-10-07', 'Software'));
  conEmpresa.movimientos.push(mov('empresa', BANORTE, 'gasto', 4321, '2026-10-07', 'Software'));
  conEmpresa.movimientos.push(mov('empresa', BBVA, 'gasto', 10, '2026-10-08', '', { estado: 'revisar' }));
  conEmpresa.movimientos.push(mov('empresa', BANORTE, 'transferencia', 999, '2026-10-09', 'Transferencia entre cuentas', { cuentaDestinoId: BBVA }));
  conEmpresa.presupuestos.push({ id: 'ppto_y', ambito: 'empresa', periodo: '2026-10', categoria: 'Software', monto: 1000, creado: AHORA, actualizado: AHORA });
  conEmpresa.cuentasPorPagar.push(cxp('cxp_x', 'prov_1', '2026-10-20', '2026-10-30', 5555));
  igual(instantanea(conEmpresa, 'personal'), antesPer, 'SEPARACIÓN: agregar registros de empresa no cambia ningún total personal');
  ok(instantanea(conEmpresa, 'empresa') !== antesEmp, 'control: los totales de empresa sí cambian');

  // Transferencia cruzada empresa→personal: afecta saldos de ambos lados, nunca ingresos/gastos/utilidad
  var cruzado = construirEstado();
  cruzado.movimientos.push(mov('empresa', BBVA, 'transferencia', 1000, '2026-10-24', 'Retiro de socio', { cuentaDestinoId: NU }));
  igual(C.saldoCuenta(cruzado, BBVA), C.saldoCuenta(base, BBVA) - 1000, 'transferencia cruzada resta en origen');
  igual(C.saldoCuenta(cruzado, NU), C.saldoCuenta(base, NU) + 1000, 'transferencia cruzada suma en destino (otro ámbito)');
  igual(C.ingresos(cruzado, 'personal', OCT.desde, OCT.hasta), C.ingresos(base, 'personal', OCT.desde, OCT.hasta), 'transferencia cruzada no es ingreso personal');
  igual(C.gastos(cruzado, 'empresa', OCT.desde, OCT.hasta), C.gastos(base, 'empresa', OCT.desde, OCT.hasta), 'transferencia cruzada no es gasto empresa');
  igualJSON(C.utilidadMes(cruzado, '2026-10'), C.utilidadMes(base, '2026-10'), 'transferencia cruzada no altera la utilidad');
  igualJSON(C.presupuestoVsReal(cruzado, 'empresa', '2026-10').map(function (f) { return f.real; }), C.presupuestoVsReal(base, 'empresa', '2026-10').map(function (f) { return f.real; }), 'transferencia cruzada no altera el presupuesto');
  igual(C.saldosPorAmbito(cruzado, 'personal').liquido, C.saldosPorAmbito(base, 'personal').liquido + 1000, 'transferencia cruzada sí mueve el líquido personal');

  // El estado no se muta
  var copia = JSON.stringify(base);
  instantanea(base, 'empresa');
  instantanea(base, 'personal');
  C.resumenParaIA(base);
  C.combinado(base);
  C.porCobrar(base);
  C.porPagar(base);
  C.vencimientos(base, null, null);
  igual(JSON.stringify(base), copia, 'VF.calc no muta el estado');
})();

// ================= Resultado =================
C.fijarHoy(null);
if (fallos.length) {
  console.error('FALLOS (' + fallos.length + ' de ' + total + '):');
  fallos.forEach(function (f) { console.error(' - ' + f); });
  process.exit(1);
} else {
  console.log('OK ' + total + ' pruebas');
}
