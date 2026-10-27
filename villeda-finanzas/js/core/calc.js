'use strict';
window.VF = window.VF || {};
/**
 * VF.calc — funciones PURAS de cálculo financiero.
 *
 * Reglas del contrato (docs/ARQUITECTURA.md §0 y §3):
 *  - Reciben `estado` como primer argumento; no tocan el DOM ni el store.
 *  - Toda función que agrega importes exige `ambito` ('empresa' | 'personal') y NUNCA mezcla ámbitos.
 *    La única excepción es `combinado()`, que devuelve los dos totales por separado y una suma
 *    etiquetada como "combinadoInformativo".
 *  - Las transferencias NUNCA cuentan como ingreso ni gasto (utilidad, presupuesto, categorías,
 *    series) pero SÍ afectan saldos: restan en la cuenta origen y suman en la destino, incluso
 *    cuando origen y destino son de ámbitos distintos.
 *  - Todo importe devuelto pasa por VF.util.round2. Todas las listas devueltas son nuevas.
 *  - La fecha "hoy" se obtiene SIEMPRE con VF.calc.hoy(); las pruebas la fijan con fijarHoy(iso).
 */
(function (VF) {
  var U = VF.util;
  var r2 = U.round2;

  var hoyFijado = null;

  /** 'YYYY-MM-DD' de hoy. Si se fijó con fijarHoy(), devuelve esa fecha (para pruebas). */
  function hoy() {
    return hoyFijado || U.hoy();
  }

  /** Fija la fecha que devolverá hoy(). fijarHoy(null) vuelve a la fecha real. */
  function fijarHoy(iso) {
    hoyFijado = iso ? String(iso).slice(0, 10) : null;
    return hoy();
  }

  // ---------------------------------------------------------------------------
  // Auxiliares privados
  // ---------------------------------------------------------------------------

  function lista(estado, coleccion) {
    return (estado && Array.isArray(estado[coleccion])) ? estado[coleccion] : [];
  }

  function porId(estado, coleccion, id) {
    var arr = lista(estado, coleccion);
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return undefined;
  }

  function esAmbito(a) {
    return a === 'empresa' || a === 'personal';
  }

  function exigirAmbito(ambito) {
    if (!esAmbito(ambito)) throw new Error('AMBITO_REQUERIDO');
    return ambito;
  }

  function monto(x) {
    var n = Number(x);
    return isFinite(n) ? n : 0;
  }

  function enRango(fecha, desde, hasta) {
    if (!fecha) return false;
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  }

  function compararFecha(a, b) {
    if (a.fecha === b.fecha) return 0;
    return a.fecha < b.fecha ? -1 : 1;
  }

  /** iso + n meses conservando el día `dia` (ajustado al máximo del mes destino). */
  function sumarMeses(iso, n, dia) {
    var f = U.parseFecha(iso);
    if (isNaN(f.getTime())) return '';
    var d = dia || f.getDate();
    var destino = new Date(f.getFullYear(), f.getMonth() + n, 1);
    var ultimo = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate();
    destino.setDate(Math.min(d, ultimo));
    return U.fechaISO(destino);
  }

  function mediana(valores) {
    var v = valores.slice().sort(function (a, b) { return a - b; });
    if (!v.length) return 0;
    var mitad = Math.floor(v.length / 2);
    return v.length % 2 ? v[mitad] : (v[mitad - 1] + v[mitad]) / 2;
  }

  function sumaPagos(registro) {
    return U.suma((registro && registro.pagos) || [], function (p) { return monto(p.monto); });
  }

  function cuentasDe(estado, ambito) {
    return lista(estado, 'cuentas').filter(function (c) { return c && c.ambito === ambito; });
  }

  function cuentaActiva(c) {
    return c && c.activa !== false;
  }

  function periodoActual() {
    return U.periodo(hoy());
  }

  function rangoPeriodo(periodo) {
    var iso = (periodo || periodoActual()) + '-01';
    return { desde: U.inicioMes(iso), hasta: U.finMes(iso) };
  }

  // ---------------------------------------------------------------------------
  // Saldos
  // ---------------------------------------------------------------------------

  /**
   * saldoInicial + ingresos − gastos − transferencias salientes + transferencias entrantes.
   * Para tarjetas de crédito el saldo queda negativo mientras exista deuda.
   */
  function saldoCuenta(estado, cuentaId) {
    var cuenta = porId(estado, 'cuentas', cuentaId);
    if (!cuenta) return 0;
    var saldo = monto(cuenta.saldoInicial);
    lista(estado, 'movimientos').forEach(function (m) {
      if (!m) return;
      var importe = monto(m.monto);
      if (m.cuentaId === cuentaId) {
        if (m.tipo === 'ingreso') saldo += importe;
        else if (m.tipo === 'gasto' || m.tipo === 'transferencia') saldo -= importe;
      }
      if (m.tipo === 'transferencia' && m.cuentaDestinoId === cuentaId) saldo += importe;
    });
    return r2(saldo);
  }

  /**
   * { liquido, credito, total, cuentas:[{cuenta, saldo}] } de UN ámbito.
   * liquido = suma de cuentas activas no 'credito'; credito = suma de tarjetas activas (deuda negativa);
   * total = liquido + credito. Las cuentas archivadas (activa:false) no se incluyen.
   */
  function saldosPorAmbito(estado, ambito) {
    exigirAmbito(ambito);
    var liquido = 0;
    var credito = 0;
    var cuentas = [];
    cuentasDe(estado, ambito).filter(cuentaActiva).forEach(function (c) {
      var saldo = saldoCuenta(estado, c.id);
      cuentas.push({ cuenta: c, saldo: saldo });
      if (c.tipo === 'credito') credito += saldo;
      else liquido += saldo;
    });
    return { ambito: ambito, liquido: r2(liquido), credito: r2(credito), total: r2(liquido + credito), cuentas: cuentas };
  }

  /** Dos totales separados + suma etiquetada como informativa. ÚNICA función que suma ámbitos. */
  function combinado(estado) {
    var empresa = saldosPorAmbito(estado, 'empresa');
    var personal = saldosPorAmbito(estado, 'personal');
    return {
      empresa: empresa,
      personal: personal,
      combinadoInformativo: {
        etiqueta: 'Total combinado (solo informativo)',
        liquido: r2(empresa.liquido + personal.liquido),
        credito: r2(empresa.credito + personal.credito),
        total: r2(empresa.total + personal.total)
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Movimientos por periodo
  // ---------------------------------------------------------------------------

  /**
   * Movimientos de UN ámbito con fecha en [desde, hasta] (inclusive; null = sin límite).
   * filtros opcionales: { tipo, categoria, cuentaId, estado }. Lista nueva ordenada por fecha
   * descendente (y, a igual fecha, por `creado` descendente).
   */
  function movimientosEn(estado, ambito, desde, hasta, filtros) {
    exigirAmbito(ambito);
    var f = filtros || {};
    var res = lista(estado, 'movimientos').filter(function (m) {
      if (!m || m.ambito !== ambito) return false;
      if (!enRango(m.fecha, desde, hasta)) return false;
      if (f.tipo && m.tipo !== f.tipo) return false;
      if (f.categoria && m.categoria !== f.categoria) return false;
      if (f.cuentaId && m.cuentaId !== f.cuentaId && m.cuentaDestinoId !== f.cuentaId) return false;
      if (f.estado && m.estado !== f.estado) return false;
      return true;
    });
    res.sort(function (a, b) {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
      var ca = a.creado || '';
      var cb = b.creado || '';
      if (ca === cb) return 0;
      return ca < cb ? 1 : -1;
    });
    return res;
  }

  function sumaTipo(estado, ambito, desde, hasta, tipo) {
    return U.suma(movimientosEn(estado, ambito, desde, hasta, { tipo: tipo }), function (m) { return monto(m.monto); });
  }

  /** Suma de movimientos tipo 'ingreso' (las transferencias quedan excluidas por tipo). */
  function ingresos(estado, ambito, desde, hasta) {
    return sumaTipo(estado, ambito, desde, hasta, 'ingreso');
  }

  /** Suma de movimientos tipo 'gasto'. */
  function gastos(estado, ambito, desde, hasta) {
    return sumaTipo(estado, ambito, desde, hasta, 'gasto');
  }

  /** ingresos − gastos. */
  function balance(estado, ambito, desde, hasta) {
    return r2(ingresos(estado, ambito, desde, hasta) - gastos(estado, ambito, desde, hasta));
  }

  /** SOLO empresa. { periodo, ingresos, gastos, utilidad, margen } — margen en % o null si no hubo ingresos. */
  function utilidadMes(estado, periodo) {
    var p = periodo || periodoActual();
    var rango = rangoPeriodo(p);
    var ing = ingresos(estado, 'empresa', rango.desde, rango.hasta);
    var gas = gastos(estado, 'empresa', rango.desde, rango.hasta);
    var utilidad = r2(ing - gas);
    return {
      ambito: 'empresa',
      periodo: p,
      ingresos: ing,
      gastos: gas,
      utilidad: utilidad,
      margen: ing > 0 ? r2(utilidad / ing * 100) : null
    };
  }

  function porCategoria(estado, ambito, desde, hasta, tipo) {
    var movs = movimientosEn(estado, ambito, desde, hasta, { tipo: tipo });
    var grupos = U.agrupar(movs, function (m) { return m.categoria || 'Sin categoría'; });
    var total = U.suma(movs, function (m) { return monto(m.monto); });
    var filas = Object.keys(grupos).map(function (categoria) {
      var importe = U.suma(grupos[categoria], function (m) { return monto(m.monto); });
      return {
        categoria: categoria,
        monto: importe,
        porcentaje: total > 0 ? r2(importe / total * 100) : 0,
        cantidad: grupos[categoria].length
      };
    });
    filas.sort(function (a, b) { return b.monto - a.monto || a.categoria.localeCompare(b.categoria, 'es-MX'); });
    return filas;
  }

  /** [{categoria, monto, porcentaje, cantidad}] de gastos, ordenado desc por monto. */
  function gastosPorCategoria(estado, ambito, desde, hasta) {
    return porCategoria(estado, ambito, desde, hasta, 'gasto');
  }

  /** [{categoria, monto, porcentaje, cantidad}] de ingresos, ordenado desc por monto. */
  function ingresosPorCategoria(estado, ambito, desde, hasta) {
    return porCategoria(estado, ambito, desde, hasta, 'ingreso');
  }

  /** [{periodo, ingresos, gastos, balance}] de los últimos `meses` meses, del más antiguo al actual. */
  function serieMensual(estado, ambito, meses) {
    exigirAmbito(ambito);
    var n = Math.max(1, Math.floor(Number(meses) || 6));
    var base = U.parseFecha(U.inicioMes(hoy()));
    var serie = [];
    for (var k = n - 1; k >= 0; k--) {
      var inicio = new Date(base.getFullYear(), base.getMonth() - k, 1);
      var desde = U.fechaISO(inicio);
      var hasta = U.finMes(desde);
      var ing = ingresos(estado, ambito, desde, hasta);
      var gas = gastos(estado, ambito, desde, hasta);
      serie.push({ periodo: U.periodo(desde), ingresos: ing, gastos: gas, balance: r2(ing - gas) });
    }
    return serie;
  }

  // ---------------------------------------------------------------------------
  // Facturas y cuentas por cobrar (ámbito implícito: empresa)
  // ---------------------------------------------------------------------------

  function pagadoFactura(f) {
    return sumaPagos(f);
  }

  function pendienteFactura(f) {
    if (!f) return 0;
    return r2(monto(f.total) - pagadoFactura(f));
  }

  /**
   * Estado derivado: 'borrador' y 'cancelada' se conservan; 'pagada' (pendiente ≤ 0),
   * 'parcial' (0 < pagado < total), 'vencida' (pendiente > 0 y fechaVencimiento < hoy), 'emitida'.
   * Nota: una factura parcial ya vencida se reporta 'parcial' (orden del contrato); su importe sí
   * cuenta en `porCobrar().vencido`.
   */
  function estadoFactura(f, fechaHoy) {
    if (!f) return 'emitida';
    if (f.estado === 'cancelada' || f.estado === 'borrador') return f.estado;
    var h = fechaHoy || hoy();
    var pagado = pagadoFactura(f);
    var pendiente = pendienteFactura(f);
    if (pendiente <= 0) return 'pagada';
    if (pagado > 0) return 'parcial';
    if (f.fechaVencimiento && f.fechaVencimiento < h) return 'vencida';
    return 'emitida';
  }

  function facturaCobrable(f) {
    return f && f.estado !== 'cancelada' && f.estado !== 'borrador' && pendienteFactura(f) > 0;
  }

  /**
   * { total, vencido, facturas:[{factura, cliente, pendiente, pagado, dias, vencida, estado}], porCliente:[...] }
   * dias = días transcurridos desde el vencimiento (negativo si aún no vence). Ordenado por vencimiento.
   */
  function porCobrar(estado) {
    var h = hoy();
    var items = lista(estado, 'facturas').filter(facturaCobrable).map(function (f) {
      var pendiente = pendienteFactura(f);
      var dias = f.fechaVencimiento ? U.diasEntre(f.fechaVencimiento, h) : 0;
      var vencida = !!f.fechaVencimiento && f.fechaVencimiento < h;
      return {
        factura: f,
        cliente: porId(estado, 'clientes', f.clienteId) || null,
        pendiente: pendiente,
        pagado: pagadoFactura(f),
        dias: dias,
        vencida: vencida,
        estado: estadoFactura(f, h),
        fecha: f.fechaVencimiento || f.fechaEmision || ''
      };
    });
    items.sort(compararFecha);
    var grupos = U.agrupar(items, function (x) { return x.factura.clienteId; });
    var porCliente = Object.keys(grupos).map(function (clienteId) {
      var g = grupos[clienteId];
      return {
        cliente: porId(estado, 'clientes', clienteId) || null,
        clienteId: clienteId,
        total: U.suma(g, function (x) { return x.pendiente; }),
        vencido: U.suma(g.filter(function (x) { return x.vencida; }), function (x) { return x.pendiente; }),
        facturas: g.slice()
      };
    });
    porCliente.sort(function (a, b) { return b.total - a.total; });
    return {
      total: U.suma(items, function (x) { return x.pendiente; }),
      vencido: U.suma(items.filter(function (x) { return x.vencida; }), function (x) { return x.pendiente; }),
      facturas: items,
      porCliente: porCliente
    };
  }

  /**
   * Antigüedad del saldo por cobrar según días desde el vencimiento: { '0-30', '31-60', '61-90', '90+' }.
   * Lo que aún no vence cuenta en '0-30'. Los cuatro tramos suman porCobrar().total.
   */
  function antiguedadCxC(estado) {
    var tramos = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    porCobrar(estado).facturas.forEach(function (x) {
      var d = Math.max(0, x.dias);
      var clave = d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
      tramos[clave] += x.pendiente;
    });
    Object.keys(tramos).forEach(function (k) { tramos[k] = r2(tramos[k]); });
    return tramos;
  }

  // ---------------------------------------------------------------------------
  // Cuentas por pagar y comisiones (ámbito implícito: empresa)
  // ---------------------------------------------------------------------------

  function pendienteCxP(c) {
    if (!c) return 0;
    return r2(monto(c.monto) - sumaPagos(c));
  }

  /** 'cancelada' se conserva; 'pagada', 'parcial', 'vencida', 'pendiente' (misma prioridad que facturas). */
  function estadoCxP(c, fechaHoy) {
    if (!c) return 'pendiente';
    if (c.estado === 'cancelada') return 'cancelada';
    var h = fechaHoy || hoy();
    var pagado = sumaPagos(c);
    var pendiente = pendienteCxP(c);
    if (pendiente <= 0) return 'pagada';
    if (pagado > 0) return 'parcial';
    if (c.fechaVencimiento && c.fechaVencimiento < h) return 'vencida';
    return 'pendiente';
  }

  function cxpPagable(c) {
    return c && c.estado !== 'cancelada' && pendienteCxP(c) > 0;
  }

  /** { total, vencido, cuentas:[{cxp, proveedor, pendiente, pagado, dias, vencida, estado}], porProveedor:[...] } */
  function porPagar(estado) {
    var h = hoy();
    var items = lista(estado, 'cuentasPorPagar').filter(cxpPagable).map(function (c) {
      var vencimiento = c.fechaVencimiento || c.fecha || '';
      return {
        cxp: c,
        proveedor: porId(estado, 'proveedores', c.proveedorId) || null,
        pendiente: pendienteCxP(c),
        pagado: sumaPagos(c),
        dias: vencimiento ? U.diasEntre(vencimiento, h) : 0,
        vencida: !!vencimiento && vencimiento < h,
        estado: estadoCxP(c, h),
        fecha: vencimiento
      };
    });
    items.sort(compararFecha);
    var grupos = U.agrupar(items, function (x) { return x.cxp.proveedorId; });
    var porProveedor = Object.keys(grupos).map(function (proveedorId) {
      var g = grupos[proveedorId];
      return {
        proveedor: porId(estado, 'proveedores', proveedorId) || null,
        proveedorId: proveedorId,
        total: U.suma(g, function (x) { return x.pendiente; }),
        vencido: U.suma(g.filter(function (x) { return x.vencida; }), function (x) { return x.pendiente; }),
        cuentas: g.slice()
      };
    });
    porProveedor.sort(function (a, b) { return b.total - a.total; });
    return {
      total: U.suma(items, function (x) { return x.pendiente; }),
      vencido: U.suma(items.filter(function (x) { return x.vencida; }), function (x) { return x.pendiente; }),
      cuentas: items,
      porProveedor: porProveedor
    };
  }

  /** { total, lista } de comisiones con estado 'pendiente', ordenadas por fecha. */
  function comisionesPendientes(estado) {
    var pendientes = lista(estado, 'comisiones').filter(function (c) { return c && c.estado === 'pendiente'; });
    pendientes = U.ordenar(pendientes, 'fecha');
    return { total: U.suma(pendientes, function (c) { return monto(c.monto); }), lista: pendientes };
  }

  // ---------------------------------------------------------------------------
  // Préstamos (amortización francesa)
  // ---------------------------------------------------------------------------

  function tasaMensual(prestamo) {
    return monto(prestamo && prestamo.tasaAnual) / 100 / 12;
  }

  /** Pago mensual fijo: P·r / (1 − (1+r)^−n). Con tasa 0 → P / n. Redondeado a 2 decimales. */
  function pagoMensual(prestamo) {
    if (!prestamo) return 0;
    var P = monto(prestamo.principal);
    var n = Math.max(1, Math.floor(monto(prestamo.plazoMeses)) || 1);
    var r = tasaMensual(prestamo);
    if (r <= 0) return r2(P / n);
    return r2(P * r / (1 - Math.pow(1 + r, -n)));
  }

  /** Fecha del pago número n: fechaInicio + n meses, el día `diaPago` (o el de fechaInicio), ajustado al mes. */
  function fechaPago(prestamo, n) {
    var dia = Number(prestamo.diaPago);
    if (!(dia >= 1 && dia <= 31)) dia = U.parseFecha(prestamo.fechaInicio).getDate();
    return sumarMeses(prestamo.fechaInicio, n, dia);
  }

  /**
   * [{n, fecha, pago, capital, interes, saldo}] teórica desde el principal.
   * interés = round2(saldo × r); capital = pago − interés; la última fila ajusta el capital para
   * que el saldo cierre exactamente en 0 (por eso su pago puede diferir unos centavos).
   */
  function tablaAmortizacion(prestamo) {
    if (!prestamo) return [];
    var n = Math.max(1, Math.floor(monto(prestamo.plazoMeses)) || 1);
    var r = tasaMensual(prestamo);
    var pago = pagoMensual(prestamo);
    var saldo = r2(monto(prestamo.principal));
    var filas = [];
    for (var k = 1; k <= n && saldo > 0; k++) {
      var interes = r2(saldo * r);
      var capital = r2(pago - interes);
      if (k === n || capital >= saldo) capital = saldo;
      if (capital < 0) capital = 0;
      saldo = r2(saldo - capital);
      filas.push({ n: k, fecha: fechaPago(prestamo, k), pago: r2(capital + interes), capital: capital, interes: interes, saldo: saldo });
    }
    return filas;
  }

  /** principal − suma(pagos.capital). */
  function saldoPrestamo(prestamo) {
    if (!prestamo) return 0;
    return r2(monto(prestamo.principal) - U.suma(prestamo.pagos || [], function (p) { return monto(p.capital); }));
  }

  /**
   * Próximo pago según los pagos ya registrados: { fecha, monto, n, capital, interes, vencido } o null
   * si el préstamo no está activo o ya no tiene saldo. El importe se calcula sobre el saldo REAL
   * (interés = saldo × r) y, si es el último pago, liquida el saldo completo.
   */
  function proximoPagoPrestamo(prestamo, fechaHoy) {
    if (!prestamo || prestamo.estado !== 'activo') return null;
    var saldo = saldoPrestamo(prestamo);
    if (saldo <= 0) return null;
    var h = fechaHoy || hoy();
    var plazo = Math.max(1, Math.floor(monto(prestamo.plazoMeses)) || 1);
    var n = ((prestamo.pagos || []).length) + 1;
    var interes = r2(saldo * tasaMensual(prestamo));
    var capital = r2(pagoMensual(prestamo) - interes);
    if (n >= plazo || capital >= saldo || capital <= 0) capital = saldo;
    var fecha = fechaPago(prestamo, n);
    return { fecha: fecha, monto: r2(capital + interes), capital: capital, interes: interes, n: n, vencido: fecha < h };
  }

  // ---------------------------------------------------------------------------
  // Vencimientos (cobros y pagos próximos)
  // ---------------------------------------------------------------------------

  /** Próxima fecha con día `dia` a partir de `iso` (inclusive), ajustada al máximo del mes. */
  function proximaFechaDia(iso, dia) {
    var f = U.parseFecha(iso);
    var d = Math.min(Math.max(1, Number(dia) || 1), 31);
    for (var k = 0; k < 2; k++) {
      var mes = new Date(f.getFullYear(), f.getMonth() + k, 1);
      var ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
      mes.setDate(Math.min(d, ultimo));
      var cand = U.fechaISO(mes);
      if (cand >= iso) return cand;
    }
    return iso;
  }

  function nombreDe(obj) {
    return obj && obj.nombre ? obj.nombre : '';
  }

  /** Todos los vencimientos pendientes (sin filtrar por rango). */
  function todosLosVencimientos(estado) {
    var h = hoy();
    var items = [];

    porCobrar(estado).facturas.forEach(function (x) {
      items.push({
        fecha: x.fecha, tipo: 'cobro', ambito: 'empresa',
        concepto: 'Factura ' + (x.factura.folio || '') + (x.cliente ? ' · ' + nombreDe(x.cliente) : ''),
        monto: x.pendiente, origen: { coleccion: 'facturas', id: x.factura.id }
      });
    });

    porPagar(estado).cuentas.forEach(function (x) {
      items.push({
        fecha: x.fecha, tipo: 'pago', ambito: 'empresa',
        concepto: (x.proveedor ? nombreDe(x.proveedor) + ' · ' : '') + (x.cxp.concepto || 'Cuenta por pagar'),
        monto: x.pendiente, origen: { coleccion: 'cuentasPorPagar', id: x.cxp.id }
      });
    });

    comisionesPendientes(estado).lista.forEach(function (c) {
      items.push({
        fecha: c.fecha || h, tipo: 'pago', ambito: 'empresa',
        concepto: 'Comisión · ' + (c.beneficiario || ''),
        monto: r2(monto(c.monto)), origen: { coleccion: 'comisiones', id: c.id }
      });
    });

    lista(estado, 'prestamos').forEach(function (p) {
      if (!p || !esAmbito(p.ambito)) return;
      var prox = proximoPagoPrestamo(p, h);
      if (!prox) return;
      items.push({
        fecha: prox.fecha, tipo: p.tipo === 'otorgado' ? 'cobro' : 'pago', ambito: p.ambito,
        concepto: (p.tipo === 'otorgado' ? 'Cobro de préstamo · ' : 'Pago de préstamo · ') + (p.contraparte || ''),
        monto: prox.monto, origen: { coleccion: 'prestamos', id: p.id }
      });
    });

    lista(estado, 'cuentas').forEach(function (c) {
      if (!cuentaActiva(c) || c.tipo !== 'credito' || !esAmbito(c.ambito)) return;
      var saldo = saldoCuenta(estado, c.id);
      if (saldo >= 0) return;
      var dia = Number(c.diaPago);
      var fecha = dia >= 1 && dia <= 31 ? proximaFechaDia(h, dia) : h;
      items.push({
        fecha: fecha, tipo: 'pago', ambito: c.ambito,
        concepto: (/^\s*tarjeta\b/i.test(c.nombre || '') ? '' : 'Tarjeta ') + (c.nombre || '') + ' · pago de saldo',
        monto: r2(-saldo), origen: { coleccion: 'cuentas', id: c.id }
      });
    });

    items.forEach(function (it) {
      it.vencido = it.fecha < h;
      it.dias = U.diasEntre(h, it.fecha);
    });
    items.sort(function (a, b) {
      return compararFecha(a, b) || (a.tipo === b.tipo ? 0 : a.tipo === 'cobro' ? -1 : 1) || (b.monto - a.monto);
    });
    return items;
  }

  /**
   * Lista ordenada por fecha de { fecha, tipo:'cobro'|'pago', ambito, concepto, monto, origen:{coleccion,id}, vencido, dias }
   * con fecha en [desde, hasta] (inclusive; null = sin límite). Incluye facturas por cobrar, CxP,
   * comisiones pendientes, próximo pago de préstamos (recibidos = pago, otorgados = cobro) y el
   * próximo pago de tarjetas de crédito con deuda (una sola ocurrencia, en su diaPago).
   */
  function vencimientos(estado, desde, hasta) {
    return todosLosVencimientos(estado).filter(function (it) { return enRango(it.fecha, desde, hasta); });
  }

  // ---------------------------------------------------------------------------
  // Presupuestos
  // ---------------------------------------------------------------------------

  /**
   * Arreglo [{categoria, tipo, presupuesto, real, diferencia, porcentaje, sinPresupuesto}] con las
   * propiedades adicionales totalPresupuesto, totalReal, totalDiferencia, ambito y periodo.
   * real = gastos de la categoría en el mes (ingresos si la categoría sólo existe como ingreso).
   * Las categorías con gasto real pero sin presupuesto aparecen con presupuesto 0 y sinPresupuesto:true.
   * diferencia = presupuesto − real (positivo = por debajo del presupuesto). Los totales sólo suman filas de gasto.
   */
  function presupuestoVsReal(estado, ambito, periodo) {
    exigirAmbito(ambito);
    var p = periodo || periodoActual();
    var rango = rangoPeriodo(p);
    var cats = (estado && estado.categorias && estado.categorias[ambito]) || { ingreso: [], gasto: [] };
    var realesGasto = {};
    gastosPorCategoria(estado, ambito, rango.desde, rango.hasta).forEach(function (f) { realesGasto[f.categoria] = f.monto; });
    var realesIngreso = {};
    ingresosPorCategoria(estado, ambito, rango.desde, rango.hasta).forEach(function (f) { realesIngreso[f.categoria] = f.monto; });

    function tipoDe(categoria) {
      var esIngreso = (cats.ingreso || []).indexOf(categoria) >= 0;
      var esGasto = (cats.gasto || []).indexOf(categoria) >= 0;
      return esIngreso && !esGasto ? 'ingreso' : 'gasto';
    }

    var filas = [];
    var vistas = {};
    lista(estado, 'presupuestos').forEach(function (b) {
      if (!b || b.ambito !== ambito || b.periodo !== p) return;
      var tipo = tipoDe(b.categoria);
      var real = (tipo === 'ingreso' ? realesIngreso : realesGasto)[b.categoria] || 0;
      var presupuesto = r2(monto(b.monto));
      if (vistas[b.categoria]) {
        vistas[b.categoria].presupuesto = r2(vistas[b.categoria].presupuesto + presupuesto);
        vistas[b.categoria].diferencia = r2(vistas[b.categoria].presupuesto - real);
        vistas[b.categoria].porcentaje = vistas[b.categoria].presupuesto > 0 ? r2(real / vistas[b.categoria].presupuesto * 100) : null;
        return;
      }
      var fila = {
        categoria: b.categoria, tipo: tipo, presupuestoId: b.id,
        presupuesto: presupuesto, real: real,
        diferencia: r2(presupuesto - real),
        porcentaje: presupuesto > 0 ? r2(real / presupuesto * 100) : null,
        sinPresupuesto: false
      };
      vistas[b.categoria] = fila;
      filas.push(fila);
    });
    Object.keys(realesGasto).forEach(function (categoria) {
      if (vistas[categoria]) return;
      filas.push({
        categoria: categoria, tipo: 'gasto', presupuestoId: null,
        presupuesto: 0, real: realesGasto[categoria],
        diferencia: r2(-realesGasto[categoria]), porcentaje: null, sinPresupuesto: true
      });
    });
    filas.sort(function (a, b) { return (b.presupuesto - a.presupuesto) || (b.real - a.real) || a.categoria.localeCompare(b.categoria, 'es-MX'); });

    var gastoFilas = filas.filter(function (f) { return f.tipo === 'gasto'; });
    filas.totalPresupuesto = U.suma(gastoFilas, function (f) { return f.presupuesto; });
    filas.totalReal = U.suma(gastoFilas, function (f) { return f.real; });
    filas.totalDiferencia = r2(filas.totalPresupuesto - filas.totalReal);
    filas.ambito = ambito;
    filas.periodo = p;
    return filas;
  }

  // ---------------------------------------------------------------------------
  // Disponible y flujo proyectado
  // ---------------------------------------------------------------------------

  /**
   * Compromisos (vencimientos tipo 'pago') de UN ámbito: los que caen en [hoy, hoy+dias] más los
   * que ya están vencidos (fecha < hoy) y siguen pendientes, porque siguen debiéndose.
   */
  function compromisosDe(estado, ambito, dias) {
    var h = hoy();
    var hasta = U.sumarDias(h, dias);
    return todosLosVencimientos(estado).filter(function (it) {
      return it.ambito === ambito && it.tipo === 'pago' && it.fecha <= hasta;
    });
  }

  function disponibleDe(estado, ambito, dias) {
    var saldos = saldosPorAmbito(estado, ambito);
    var compromisos = compromisosDe(estado, ambito, dias);
    var totalCompromisos = U.suma(compromisos, function (c) { return c.monto; });
    return {
      ambito: ambito,
      dias: dias,
      hasta: U.sumarDias(hoy(), dias),
      liquido: saldos.liquido,
      credito: saldos.credito,
      compromisos: compromisos,
      totalCompromisos: totalCompromisos,
      disponible: r2(saldos.liquido - totalCompromisos)
    };
  }

  /** SOLO cuentas personales: { liquido, compromisos:[...], totalCompromisos, disponible, dias, hasta }. */
  function disponiblePersonal(estado, dias) {
    var d = dias === undefined || dias === null ? 30 : Math.max(0, Math.floor(Number(dias) || 0));
    return disponibleDe(estado, 'personal', d);
  }

  /** SOLO cuentas empresa; `dias` por defecto = ajustes.reservaOperativaDias (30 si no existe). */
  function disponibleEmpresa(estado, dias) {
    var reserva = estado && estado.ajustes ? Number(estado.ajustes.reservaOperativaDias) : NaN;
    var d = dias === undefined || dias === null ? (isFinite(reserva) && reserva >= 0 ? reserva : 30) : Math.max(0, Math.floor(Number(dias) || 0));
    return disponibleDe(estado, 'empresa', d);
  }

  /**
   * [{fecha, entradas, salidas, saldo}] diario desde hoy hasta hoy+dias, partiendo del líquido del
   * ámbito. Entradas = cobros, salidas = pagos de `vencimientos`; lo ya vencido se carga el día de hoy.
   */
  function flujoProyectado(estado, ambito, dias) {
    exigirAmbito(ambito);
    var d = dias === undefined || dias === null ? 30 : Math.max(0, Math.floor(Number(dias) || 0));
    var h = hoy();
    var hasta = U.sumarDias(h, d);
    var saldo = saldosPorAmbito(estado, ambito).liquido;
    var porDia = {};
    todosLosVencimientos(estado).forEach(function (it) {
      if (it.ambito !== ambito || it.fecha > hasta) return;
      var clave = it.fecha < h ? h : it.fecha;
      if (!porDia[clave]) porDia[clave] = { entradas: 0, salidas: 0 };
      if (it.tipo === 'cobro') porDia[clave].entradas += it.monto;
      else porDia[clave].salidas += it.monto;
    });
    var serie = [];
    for (var k = 0; k <= d; k++) {
      var fecha = U.sumarDias(h, k);
      var dia = porDia[fecha] || { entradas: 0, salidas: 0 };
      saldo = r2(saldo + dia.entradas - dia.salidas);
      serie.push({ fecha: fecha, entradas: r2(dia.entradas), salidas: r2(dia.salidas), saldo: saldo });
    }
    return serie;
  }

  // ---------------------------------------------------------------------------
  // Revisión de movimientos
  // ---------------------------------------------------------------------------

  /**
   * { duplicados:[[a,b]], atipicos:[{mov, mediana}], marcados:[...], sinCategoria:[...], total }
   * duplicado = misma cuenta, fecha, monto y tipo; atípico = gasto > 3× la mediana de su categoría
   * (mínimo 4 muestras en el mismo ámbito); marcados = estado 'revisar'; sinCategoria = sin categoría
   * (las transferencias no requieren categoría). Con `ambito` omitido revisa ambos por separado.
   */
  function movimientosARevisar(estado, ambito) {
    var ambitos = esAmbito(ambito) ? [ambito] : ['empresa', 'personal'];
    var res = { duplicados: [], atipicos: [], marcados: [], sinCategoria: [], total: 0 };

    ambitos.forEach(function (a) {
      var movs = movimientosEn(estado, a, null, null).slice().reverse(); // cronológico ascendente

      var grupos = U.agrupar(movs, function (m) { return [m.cuentaId, m.fecha, r2(monto(m.monto)), m.tipo].join('|'); });
      Object.keys(grupos).forEach(function (k) {
        var g = grupos[k];
        for (var i = 1; i < g.length; i++) res.duplicados.push([g[i - 1], g[i]]);
      });

      var gastosPorCat = U.agrupar(movs.filter(function (m) { return m.tipo === 'gasto'; }), function (m) { return m.categoria || ''; });
      Object.keys(gastosPorCat).forEach(function (cat) {
        var g = gastosPorCat[cat];
        if (g.length < 4) return;
        var med = r2(mediana(g.map(function (m) { return monto(m.monto); })));
        if (med <= 0) return;
        g.forEach(function (m) {
          if (monto(m.monto) > 3 * med) res.atipicos.push({ mov: m, mediana: med, veces: r2(monto(m.monto) / med) });
        });
      });

      movs.forEach(function (m) {
        if (m.estado === 'revisar') res.marcados.push(m);
        if (m.tipo !== 'transferencia' && !(m.categoria && String(m.categoria).trim())) res.sinCategoria.push(m);
      });
    });

    res.total = res.duplicados.length + res.atipicos.length + res.marcados.length + res.sinCategoria.length;
    return res;
  }

  // ---------------------------------------------------------------------------
  // Metas de ahorro
  // ---------------------------------------------------------------------------

  /** { ahorrado (saldo de cuentaId o 0), objetivo, porcentaje (0–100), faltante } */
  function metaProgreso(estado, meta) {
    var objetivo = r2(monto(meta && meta.objetivo));
    var ahorrado = meta && meta.cuentaId && porId(estado, 'cuentas', meta.cuentaId) ? Math.max(0, saldoCuenta(estado, meta.cuentaId)) : 0;
    var porcentaje = objetivo > 0 ? Math.min(100, r2(ahorrado / objetivo * 100)) : 0;
    return { ahorrado: r2(ahorrado), objetivo: objetivo, porcentaje: porcentaje, faltante: r2(Math.max(0, objetivo - ahorrado)) };
  }

  // ---------------------------------------------------------------------------
  // Resumen para el asistente (sin descripciones ni contrapartes)
  // ---------------------------------------------------------------------------

  function resumenAmbito(estado, ambito, rango) {
    var saldos = saldosPorAmbito(estado, ambito);
    var ing = ingresos(estado, ambito, rango.desde, rango.hasta);
    var gas = gastos(estado, ambito, rango.desde, rango.hasta);
    var ppto = presupuestoVsReal(estado, ambito, U.periodo(rango.desde));
    return {
      liquido: saldos.liquido,
      credito: saldos.credito,
      total: saldos.total,
      cuentas: saldos.cuentas.map(function (x) { return { tipo: x.cuenta.tipo, banco: x.cuenta.banco || '', saldo: x.saldo }; }),
      mes: { periodo: U.periodo(rango.desde), ingresos: ing, gastos: gas, balance: r2(ing - gas) },
      gastosPorCategoria: gastosPorCategoria(estado, ambito, rango.desde, rango.hasta).slice(0, 5).map(function (f) {
        return { categoria: f.categoria, monto: f.monto, porcentaje: f.porcentaje };
      }),
      presupuesto: { totalPresupuesto: ppto.totalPresupuesto, totalReal: ppto.totalReal, totalDiferencia: ppto.totalDiferencia }
    };
  }

  /**
   * Objeto compacto para enviar a un servidor de IA: totales por ámbito, por cobrar/pagar,
   * vencimientos a 14 días, utilidad del mes, revisión y metas. NUNCA incluye descripciones,
   * contrapartes, nombres de clientes/proveedores/metas ni datos de acceso.
   */
  function resumenParaIA(estado) {
    var h = hoy();
    var rango = rangoPeriodo(periodoActual());
    var cxc = porCobrar(estado);
    var cxp = porPagar(estado);
    var com = comisionesPendientes(estado);
    var revisar = movimientosARevisar(estado);
    var dispEmp = disponibleEmpresa(estado);
    var dispPer = disponiblePersonal(estado);
    var utilidad = utilidadMes(estado, periodoActual());

    var empresa = resumenAmbito(estado, 'empresa', rango);
    empresa.utilidadMes = utilidad;
    empresa.porCobrar = { total: cxc.total, vencido: cxc.vencido, facturas: cxc.facturas.length, antiguedad: antiguedadCxC(estado) };
    empresa.porPagar = { total: cxp.total, vencido: cxp.vencido, cuentas: cxp.cuentas.length };
    empresa.comisionesPendientes = { total: com.total, cantidad: com.lista.length };
    empresa.disponible = { dias: dispEmp.dias, liquido: dispEmp.liquido, totalCompromisos: dispEmp.totalCompromisos, disponible: dispEmp.disponible };

    var personal = resumenAmbito(estado, 'personal', rango);
    personal.disponible = { dias: dispPer.dias, liquido: dispPer.liquido, totalCompromisos: dispPer.totalCompromisos, disponible: dispPer.disponible };
    personal.metas = lista(estado, 'metas').map(function (m) {
      var pr = metaProgreso(estado, m);
      return { objetivo: pr.objetivo, ahorrado: pr.ahorrado, porcentaje: pr.porcentaje, fechaMeta: m.fechaMeta || null };
    });

    var prestamos = lista(estado, 'prestamos').filter(function (p) { return p && p.estado === 'activo' && esAmbito(p.ambito); }).map(function (p) {
      var prox = proximoPagoPrestamo(p, h);
      return { ambito: p.ambito, tipo: p.tipo, saldo: saldoPrestamo(p), pagoMensual: pagoMensual(p), proximoPago: prox ? { fecha: prox.fecha, monto: prox.monto } : null };
    });

    return {
      generado: h,
      moneda: (estado && estado.ajustes && estado.ajustes.moneda) || 'MXN',
      periodo: periodoActual(),
      empresa: empresa,
      personal: personal,
      prestamos: prestamos,
      vencimientos14: vencimientos(estado, h, U.sumarDias(h, 14)).map(function (v) {
        return { fecha: v.fecha, tipo: v.tipo, ambito: v.ambito, monto: v.monto, coleccion: v.origen.coleccion };
      }),
      revisar: {
        duplicados: revisar.duplicados.length,
        atipicos: revisar.atipicos.length,
        marcados: revisar.marcados.length,
        sinCategoria: revisar.sinCategoria.length,
        total: revisar.total
      },
      nota: 'Empresa y personal se calculan por separado; no sumar entre ámbitos.'
    };
  }

  VF.calc = {
    hoy: hoy,
    fijarHoy: fijarHoy,
    saldoCuenta: saldoCuenta,
    saldosPorAmbito: saldosPorAmbito,
    combinado: combinado,
    movimientosEn: movimientosEn,
    ingresos: ingresos,
    gastos: gastos,
    balance: balance,
    utilidadMes: utilidadMes,
    gastosPorCategoria: gastosPorCategoria,
    ingresosPorCategoria: ingresosPorCategoria,
    serieMensual: serieMensual,
    pagadoFactura: pagadoFactura,
    pendienteFactura: pendienteFactura,
    estadoFactura: estadoFactura,
    porCobrar: porCobrar,
    antiguedadCxC: antiguedadCxC,
    pendienteCxP: pendienteCxP,
    estadoCxP: estadoCxP,
    porPagar: porPagar,
    comisionesPendientes: comisionesPendientes,
    tablaAmortizacion: tablaAmortizacion,
    pagoMensual: pagoMensual,
    saldoPrestamo: saldoPrestamo,
    proximoPagoPrestamo: proximoPagoPrestamo,
    vencimientos: vencimientos,
    presupuestoVsReal: presupuestoVsReal,
    disponiblePersonal: disponiblePersonal,
    disponibleEmpresa: disponibleEmpresa,
    flujoProyectado: flujoProyectado,
    movimientosARevisar: movimientosARevisar,
    metaProgreso: metaProgreso,
    resumenParaIA: resumenParaIA
  };
})(window.VF);
