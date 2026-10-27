'use strict';
/*
 * js/modules/reportes.js — Vista Reportes (#/reportes) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  - Selector segmentado Empresa | Personal (llama a VF.ui.ambitoActivo al cambiar) y rango:
 *    mes actual, mes anterior, trimestre actual, año actual o personalizado (dos fechas). La elección se
 *    recuerda en sessionStorage ('vf.reportes', no sensible) y puede fijarse con
 *    #/reportes?ambito=empresa|personal&rango=mes|mes-anterior|trimestre|anio|personalizado&desde=&hasta=.
 *  - Secciones: KPIs del periodo; Estado de resultados (sólo empresa: ingresos y gastos por categoría,
 *    utilidad, margen); Flujo de efectivo mensual (VF.calc.serieMensual + VF.ui.graficaBarras);
 *    Gastos por categoría (VF.calc.gastosPorCategoria + VF.ui.graficaDona + tabla completa);
 *    Antigüedad de saldos CxC (empresa, VF.calc.antiguedadCxC, al día de hoy); Resumen de IVA (empresa,
 *    estimado: trasladado = IVA de facturas con emisión en el rango, sin canceladas ni borradores;
 *    acreditable = 16/116 de los gastos en categorías con IVA).
 *  - Descargas con VF.util.csv / VF.util.descargar: CSV movimientos, CSV facturas, CSV cuentas por pagar,
 *    "Paquete para contador" (los CSV + resumen.txt, con un pequeño retraso entre descargas) e
 *    "Imprimir / PDF" (window.print con la hoja de impresión de css/app.css). Los nombres de archivo llevan
 *    ámbito y rango: villeda-empresa-movimientos-2026-10.csv. Ningún archivo mezcla ámbitos.
 *  - Toda cifra sale de VF.calc; sin datos → "Sin movimientos". Re-pinta con VF.store 'cambio' sólo si la
 *    ruta activa sigue siendo reportes.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="reportes-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.reportes] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;

  var CLAVE_ESTADO = 'vf.reportes';
  var NOMBRES = { empresa: 'Empresa', personal: 'Personal' };
  var RANGOS = [
    { valor: 'mes', texto: 'Mes actual' },
    { valor: 'mes-anterior', texto: 'Mes anterior' },
    { valor: 'trimestre', texto: 'Trimestre actual' },
    { valor: 'anio', texto: 'Año actual' },
    { valor: 'personalizado', texto: 'Personalizado' }
  ];
  /* Categorías de gasto de empresa cuyo importe incluye IVA (contrato §4). 'Servicios' se acepta por si el
     usuario renombró la categoría; en el seed la categoría es 'Servicios (luz, agua, internet)'. */
  var CATEGORIAS_IVA = ['Proveedores', 'Materiales', 'Servicios (luz, agua, internet)', 'Servicios', 'Software', 'Honorarios', 'Publicidad'];
  var TASA_IVA = 0.16;
  var MIN_MESES_FLUJO = 6;
  var MAX_MESES_FLUJO = 36;
  var RETRASO_PAQUETE_MS = 450;
  var TIPO_TEXTO = { ingreso: 'Ingreso', gasto: 'Gasto', transferencia: 'Transferencia' };
  var ESTADO_MOV_TEXTO = { confirmado: 'Confirmado', revisar: 'Por revisar' };
  var ESTADO_DOC_TEXTO = { borrador: 'Borrador', emitida: 'Emitida', pagada: 'Pagada', parcial: 'Parcial', vencida: 'Vencida', cancelada: 'Cancelada', pendiente: 'Pendiente' };
  var TRAMOS_CXC = [
    { clave: '0-30', texto: '0–30 días (incluye por vencer)', tono: undefined },
    { clave: '31-60', texto: '31–60 días', tono: 'alerta' },
    { clave: '61-90', texto: '61–90 días', tono: 'negativo' },
    { clave: '90+', texto: 'Más de 90 días', tono: 'negativo' }
  ];
  var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* Ajustes de la vista (ámbito y rango elegidos). */
  var vista = leerAjustesVista();
  var temporizadorCambio = null;
  var paqueteEnCurso = false;

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estado(); }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }
  function esAmbito(a) { return a === 'empresa' || a === 'personal'; }
  function esFechaISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function esRango(t) { return RANGOS.some(function (r) { return r.valor === t; }); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function capitalizar(s) {
    s = String(s == null ? '' : s);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function plural(n, singular, pluralTexto) {
    return n + ' ' + (n === 1 ? singular : (pluralTexto || singular + 's'));
  }
  function mesLargo(periodo) {
    var p = String(periodo || '').split('-');
    return (MESES_LARGOS[Number(p[1]) - 1] || '') + ' ' + (p[0] || '');
  }
  function mesCorto(periodo, conAnio) {
    var p = String(periodo || '').split('-');
    return (MESES_CORTOS[Number(p[1]) - 1] || '') + (conAnio ? ' ' + String(p[0] || '').slice(2) : '');
  }
  function pct(parte, total, dec) {
    if (!(total > 0)) return '—';
    return U.fmtNumero(parte / total * 100, dec == null ? 1 : dec) + ' %';
  }
  function buscar(arr, id) {
    arr = arr || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }
  function nombreCuenta(est, id) {
    var c = buscar(est.cuentas, id);
    return c ? c.nombre : 'Cuenta eliminada';
  }
  /** Diferencia en meses entre dos periodos 'YYYY-MM' (b − a). */
  function diffMeses(pa, pb) {
    var a = String(pa).split('-').map(Number);
    var b = String(pb).split('-').map(Number);
    return (b[0] - a[0]) * 12 + (b[1] - a[1]);
  }
  /** Columna de tarjetas apiladas dentro de una .rejilla-2 (min-width:0; ver nota en panel.js). */
  function columna(html) { return '<div class="tarjeta-cuerpo">' + html + '</div>'; }

  function leerAjustesVista() {
    var base = { ambito: 'empresa', tipo: 'mes', desde: '', hasta: '' };
    try {
      var guardado = JSON.parse(sessionStorage.getItem(CLAVE_ESTADO) || 'null');
      if (guardado && typeof guardado === 'object') {
        if (esAmbito(guardado.ambito)) base.ambito = guardado.ambito;
        if (esRango(guardado.tipo)) base.tipo = guardado.tipo;
        if (esFechaISO(guardado.desde)) base.desde = guardado.desde;
        if (esFechaISO(guardado.hasta)) base.hasta = guardado.hasta;
      }
    } catch (e) { /* sessionStorage no disponible o JSON inválido */ }
    return base;
  }
  function guardarAjustesVista() {
    try { sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify(vista)); } catch (e) { /* sin almacenamiento de sesión */ }
  }

  /* ---------- rango de fechas ---------------------------------------------- */
  /**
   * Rango de fechas del tipo elegido: { tipo, desde, hasta, etiqueta, sufijo }.
   * `sufijo` se usa en los nombres de archivo (2026-10, 2026-T4, 2026, 2026-09-26_2026-10-26).
   */
  function calcularRango(tipo, desde, hasta) {
    var h = hoy();
    var d = U.parseFecha(h);
    var y = d.getFullYear();
    var m = d.getMonth();
    if (tipo === 'mes-anterior') {
      var ini = U.fechaISO(new Date(y, m - 1, 1));
      return { tipo: tipo, desde: ini, hasta: U.finMes(ini), etiqueta: capitalizar(mesLargo(U.periodo(ini))), sufijo: U.periodo(ini) };
    }
    if (tipo === 'trimestre') {
      var q = Math.floor(m / 3);
      var iniQ = U.fechaISO(new Date(y, q * 3, 1));
      var finQ = U.finMes(U.fechaISO(new Date(y, q * 3 + 2, 1)));
      return {
        tipo: tipo, desde: iniQ, hasta: finQ,
        etiqueta: 'Trimestre ' + MESES_CORTOS[q * 3] + '–' + MESES_CORTOS[q * 3 + 2] + ' ' + y,
        sufijo: y + '-T' + (q + 1)
      };
    }
    if (tipo === 'anio') {
      return { tipo: tipo, desde: y + '-01-01', hasta: y + '-12-31', etiqueta: 'Año ' + y, sufijo: String(y) };
    }
    if (tipo === 'personalizado') {
      var a = esFechaISO(desde) ? desde : U.sumarDias(h, -30);
      var b = esFechaISO(hasta) ? hasta : h;
      if (a > b) { var t = a; a = b; b = t; }
      return { tipo: tipo, desde: a, hasta: b, etiqueta: 'Del ' + U.fmtFecha(a) + ' al ' + U.fmtFecha(b), sufijo: a + '_' + b };
    }
    var iniM = U.inicioMes(h);
    return { tipo: 'mes', desde: iniM, hasta: U.finMes(iniM), etiqueta: capitalizar(mesLargo(U.periodo(iniM))), sufijo: U.periodo(iniM) };
  }
  function rangoActual() { return calcularRango(vista.tipo, vista.desde, vista.hasta); }

  /* ---------- cálculos del módulo (sobre VF.calc) -------------------------- */
  /**
   * Estado de resultados de EMPRESA en [desde, hasta]: { ingresos:[{categoria, monto, porcentaje, cantidad}],
   * gastos:[...], totalIngresos, totalGastos, utilidad, margen (% o null) }.
   */
  function estadoResultados(est, desde, hasta) {
    var ing = VF.calc.ingresosPorCategoria(est, 'empresa', desde, hasta);
    var gas = VF.calc.gastosPorCategoria(est, 'empresa', desde, hasta);
    var totalIngresos = VF.calc.ingresos(est, 'empresa', desde, hasta);
    var totalGastos = VF.calc.gastos(est, 'empresa', desde, hasta);
    var utilidad = U.round2(totalIngresos - totalGastos);
    return {
      ambito: 'empresa', desde: desde, hasta: hasta,
      ingresos: ing, gastos: gas,
      totalIngresos: totalIngresos, totalGastos: totalGastos,
      utilidad: utilidad,
      margen: totalIngresos > 0 ? U.round2(utilidad / totalIngresos * 100) : null
    };
  }

  /**
   * Resumen de IVA de EMPRESA (estimado) en [desde, hasta]:
   *  trasladado  = suma de `iva` de facturas con fechaEmision en el rango, sin canceladas ni borradores.
   *  acreditable = 16/116 de los gastos (movimientos tipo 'gasto' de empresa) en CATEGORIAS_IVA.
   *  neto = trasladado − acreditable (positivo = a cargo; negativo = a favor).
   */
  function resumenIVA(est, desde, hasta) {
    var facturas = (est.facturas || []).filter(function (f) {
      return f && f.estado !== 'cancelada' && f.estado !== 'borrador' && f.fechaEmision && f.fechaEmision >= desde && f.fechaEmision <= hasta;
    });
    var trasladado = U.suma(facturas, function (f) { return Number(f.iva) || 0; });
    var subtotalFacturado = U.suma(facturas, function (f) { return Number(f.subtotal) || 0; });
    var gastosIVA = VF.calc.movimientosEn(est, 'empresa', desde, hasta, { tipo: 'gasto' }).filter(function (m) {
      return CATEGORIAS_IVA.indexOf(m.categoria) >= 0;
    });
    var baseGastos = U.suma(gastosIVA, function (m) { return Number(m.monto) || 0; });
    var acreditable = U.round2(baseGastos * TASA_IVA / (1 + TASA_IVA));
    return {
      desde: desde, hasta: hasta,
      trasladado: trasladado, facturas: facturas.length, subtotalFacturado: subtotalFacturado,
      acreditable: acreditable, gastosConIVA: gastosIVA.length, baseGastos: baseGastos,
      neto: U.round2(trasladado - acreditable),
      categorias: CATEGORIAS_IVA.slice(),
      estimado: true
    };
  }

  /**
   * Serie mensual para el flujo de efectivo: los meses del rango (hasta el mes actual, nunca meses futuros
   * sin datos) y, si son menos de MIN_MESES_FLUJO, se completan hacia atrás como contexto.
   * → { serie:[{periodo, ingresos, gastos, balance}], extendida, desdePeriodo, hastaPeriodo }
   */
  function serieFlujo(est, ambito, desde, hasta) {
    var pHoy = U.periodo(hoy());
    var pFin = U.periodo(hasta) < pHoy ? U.periodo(hasta) : pHoy;
    var pIni = U.periodo(desde);
    var mesesRango = Math.max(1, diffMeses(pIni, pFin) + 1);
    var hastaHoy = Math.max(0, diffMeses(pFin, pHoy));
    var n = Math.min(MAX_MESES_FLUJO, Math.max(MIN_MESES_FLUJO, mesesRango) + hastaHoy);
    var serie = VF.calc.serieMensual(est, ambito, n).filter(function (s) { return s.periodo <= pFin; });
    return {
      serie: serie,
      extendida: serie.length > mesesRango,
      desdePeriodo: serie.length ? serie[0].periodo : pIni,
      hastaPeriodo: pFin
    };
  }

  /* ---------- render de la ruta -------------------------------------------- */
  function render(contenedor, params) {
    var p = params || {};
    var cambio = false;
    if (esAmbito(p.ambito)) { vista.ambito = p.ambito; cambio = true; }
    if (esRango(p.rango)) { vista.tipo = p.rango; cambio = true; }
    if (esFechaISO(p.desde)) { vista.desde = p.desde; cambio = true; }
    if (esFechaISO(p.hasta)) { vista.hasta = p.hasta; cambio = true; }
    if (cambio) guardarAjustesVista();
    VF.ui.ambitoActivo(vista.ambito);
    contenedor.innerHTML = cabecera() + controles() + '<div id="reportes-cuerpo"></div>';
    pintarCuerpo();
  }

  function subtituloTexto(r) {
    // En personalizado la etiqueta ya contiene las dos fechas; no repetirlas.
    return NOMBRES[vista.ambito] + ' · ' + r.etiqueta + (r.tipo === 'personalizado' ? '' : ' · ' + U.fmtFecha(r.desde) + ' – ' + U.fmtFecha(r.hasta));
  }

  function cabecera() {
    var r = rangoActual();
    return '<div class="vista-cabecera">' +
      '<div><h1>Reportes</h1><p class="texto-2 mb-0" id="reportes-subtitulo">' + esc(subtituloTexto(r)) + '</p></div>' +
      '<div class="vista-acciones">' +
      VF.ui.segmentos([{ valor: 'empresa', texto: 'Empresa' }, { valor: 'personal', texto: 'Personal' }], vista.ambito, alCambiarAmbito) +
      '</div></div>';
  }

  function controles() {
    var personalizado = vista.tipo === 'personalizado';
    var r = rangoActual();
    var html = '<div class="filtros no-imprimir" id="reportes-filtros">';
    html += '<div class="campo" data-campo-cont="rango"><label class="sr-solo" for="reportes-rango">Periodo</label>' +
      '<select id="reportes-rango" data-accion="reportes-rango" aria-label="Periodo del reporte">' +
      RANGOS.map(function (op) {
        return '<option value="' + esc(op.valor) + '"' + (op.valor === vista.tipo ? ' selected' : '') + '>' + esc(op.texto) + '</option>';
      }).join('') + '</select></div>';
    html += '<div class="fila" id="reportes-fechas"' + (personalizado ? '' : ' hidden') + ' style="flex:1 1 280px">' +
      '<div class="campo" data-campo-cont="desde"><label class="sr-solo" for="reportes-desde">Desde</label>' +
      '<input type="date" id="reportes-desde" data-accion="reportes-fecha" data-campo="desde" value="' + esc(personalizado ? r.desde : vista.desde) + '" aria-label="Desde" max="' + esc(hoy()) + '"></div>' +
      '<div class="campo" data-campo-cont="hasta"><label class="sr-solo" for="reportes-hasta">Hasta</label>' +
      '<input type="date" id="reportes-hasta" data-accion="reportes-fecha" data-campo="hasta" value="' + esc(personalizado ? r.hasta : vista.hasta) + '" aria-label="Hasta"></div>' +
      '</div>';
    html += '</div>';
    return html;
  }

  function alCambiarAmbito(valor) {
    if (!esAmbito(valor) || valor === vista.ambito) return;
    vista.ambito = valor;
    guardarAjustesVista();
    VF.ui.ambitoActivo(valor);
    limpiarHashParams();
    pintarCuerpo();
  }

  /** Cambia el segmento activo (aria-selected) y vuelve a pintar el cuerpo. */
  function fijarAmbito(valor) {
    if (!esAmbito(valor)) return;
    var botones = document.querySelectorAll('#vista .vista-cabecera .segmento');
    Array.prototype.forEach.call(botones, function (b) {
      var activo = b.getAttribute('data-valor') === valor;
      b.setAttribute('aria-selected', activo ? 'true' : 'false');
      if (activo) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
    });
    alCambiarAmbito(valor);
  }

  /** Fija el rango ('mes' | 'mes-anterior' | 'trimestre' | 'anio' | 'personalizado', desde?, hasta?) y repinta. */
  function fijarRango(tipo, desde, hasta) {
    if (!esRango(tipo)) return;
    vista.tipo = tipo;
    if (tipo === 'personalizado') {
      var r0 = calcularRango('personalizado', esFechaISO(desde) ? desde : vista.desde, esFechaISO(hasta) ? hasta : vista.hasta);
      vista.desde = r0.desde;
      vista.hasta = r0.hasta;
    }
    guardarAjustesVista();
    limpiarHashParams();
    var sel = document.getElementById('reportes-rango');
    if (sel && sel.value !== tipo) sel.value = tipo;
    var fechas = document.getElementById('reportes-fechas');
    if (fechas) {
      fechas.hidden = tipo !== 'personalizado';
      var r = rangoActual();
      var iDesde = document.getElementById('reportes-desde');
      var iHasta = document.getElementById('reportes-hasta');
      if (tipo === 'personalizado') {
        if (iDesde && iDesde.value !== r.desde) iDesde.value = r.desde;
        if (iHasta && iHasta.value !== r.hasta) iHasta.value = r.hasta;
      }
    }
    pintarCuerpo();
  }

  function limpiarHashParams() {
    if (/^#\/reportes\?/.test(location.hash)) {
      try { history.replaceState(null, '', '#/reportes'); } catch (e) { /* file:// en algunos navegadores */ }
    }
  }

  function pintarCuerpo() {
    var cuerpo = document.getElementById('reportes-cuerpo');
    if (!cuerpo || !VF.store.estaDesbloqueado()) return;
    var est = estado();
    var r = rangoActual();
    var sub = document.getElementById('reportes-subtitulo');
    if (sub) sub.textContent = subtituloTexto(r);
    cuerpo.setAttribute('data-ambito', vista.ambito);
    cuerpo.setAttribute('data-desde', r.desde);
    cuerpo.setAttribute('data-hasta', r.hasta);
    cuerpo.innerHTML = encabezadoImpresion(est, r) + cuerpoAmbito(est, vista.ambito, r);
  }

  /** Cabecera visible SÓLO al imprimir: empresa, ámbito, periodo y fecha de generación. */
  function encabezadoImpresion(est, r) {
    var aj = est.ajustes || {};
    return '<div class="solo-imprimir mb-2" id="reportes-impresion">' +
      '<p class="mb-0"><strong>' + esc(aj.nombreEmpresa || 'VILLEDA Finanzas') + '</strong> · Reporte ' + esc(NOMBRES[vista.ambito].toLowerCase()) + '</p>' +
      '<p class="mb-0">Periodo: ' + esc(r.etiqueta) + ' (' + esc(U.fmtFecha(r.desde)) + ' – ' + esc(U.fmtFecha(r.hasta)) + ') · Generado el ' + esc(U.fmtFecha(hoy())) + ' · Moneda MXN</p>' +
      '<p class="mb-0 texto-2">Cifras calculadas a partir de los registros capturados en VILLEDA Finanzas. Empresa y personal se calculan por separado. El IVA es una estimación informativa.</p>' +
      '</div>';
  }

  /* ---------- cuerpo de un ámbito ------------------------------------------ */
  function cuerpoAmbito(est, ambito, r) {
    var movs = VF.calc.movimientosEn(est, ambito, r.desde, r.hasta);
    var esEmpresa = ambito === 'empresa';
    var iva = esEmpresa ? resumenIVA(est, r.desde, r.hasta) : null;
    var pc = esEmpresa ? VF.calc.porCobrar(est) : null;
    var hayDatos = movs.length > 0 || (iva && (iva.facturas > 0 || iva.baseGastos > 0));

    var html = kpis(est, ambito, r, movs);
    if (!hayDatos) {
      html += '<div class="tarjeta" id="reportes-vacio">' + VF.ui.vacio('Sin movimientos en ' + NOMBRES[ambito].toLowerCase() + ' durante ' + r.etiqueta.toLowerCase() + '. Elige otro periodo o registra movimientos.') + '</div>';
      if (esEmpresa && pc.total > 0) html += tarjetaAntiguedad(est, pc);
      html += tarjetaExportar(ambito, r, movs.length, iva);
      return html;
    }

    if (esEmpresa) {
      // Gastos por categoría e IVA van a ancho completo: en media columna la leyenda de la dona parte palabras.
      html += '<div class="rejilla-2">' +
        columna(tarjetaResultados(est, r)) +
        columna(tarjetaFlujo(est, ambito, r) + tarjetaAntiguedad(est, pc)) +
        '</div>';
      html += tarjetaGastos(est, ambito, r);
      html += tarjetaIVA(iva, r);
    } else {
      html += '<div class="rejilla-2">' +
        columna(tarjetaResumenPersonal(est, r)) +
        columna(tarjetaFlujo(est, ambito, r)) +
        '</div>';
      html += tarjetaGastos(est, ambito, r);
    }
    html += tarjetaExportar(ambito, r, movs.length, iva);
    return html;
  }

  function kpis(est, ambito, r, movs) {
    var hay = movs.length > 0;
    var ing = VF.calc.ingresos(est, ambito, r.desde, r.hasta);
    var gas = VF.calc.gastos(est, ambito, r.desde, r.hasta);
    var bal = VF.calc.balance(est, ambito, r.desde, r.hasta);
    var nIng = movs.filter(function (m) { return m.tipo === 'ingreso'; }).length;
    var nGas = movs.filter(function (m) { return m.tipo === 'gasto'; }).length;
    var nTra = movs.length - nIng - nGas;
    var sinMovs = 'Sin movimientos en el periodo';
    var html = '<div class="kpis" id="reportes-kpis">';
    html += VF.ui.kpi({ titulo: 'Ingresos', valor: hay ? fmt(ing) : '—', sub: hay ? plural(nIng, 'ingreso') : sinMovs, tono: 'neutro' });
    html += VF.ui.kpi({ titulo: 'Gastos', valor: hay ? fmt(gas) : '—', sub: hay ? plural(nGas, 'gasto') : sinMovs, tono: 'neutro' });
    html += VF.ui.kpi({
      titulo: ambito === 'empresa' ? 'Utilidad' : 'Balance',
      valor: hay ? fmt(bal) : '—',
      sub: hay ? (ambito === 'empresa' ? 'Margen ' + pct(bal, ing) : 'Ingresos − gastos') : sinMovs,
      tono: hay ? (bal >= 0 ? 'positivo' : 'negativo') : 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Movimientos',
      valor: hay ? String(movs.length) : '—',
      sub: hay ? plural(nTra, 'transferencia') + ' (no cuentan en ingresos ni gastos)' : sinMovs,
      tono: 'neutro'
    });
    return html + '</div>';
  }

  /* ---------- estado de resultados (empresa) ------------------------------- */
  function filaCategoria(f, total) {
    return '<tr><td>' + esc(f.categoria) + ' <small class="texto-3">' + esc(plural(f.cantidad, 'mov.', 'mov.')) + '</small></td>' +
      '<td class="num">' + esc(fmt(f.monto)) + '</td><td class="num texto-2">' + esc(pct(f.monto, total)) + '</td></tr>';
  }
  function filaGrupo(texto) {
    return '<tr><th scope="rowgroup" colspan="3">' + esc(texto) + '</th></tr>';
  }
  /** Fila de total; `pctTexto` admite { cifra, nota } para partir la nota en una segunda línea (small). */
  function filaTotal(texto, valor, pctTexto, clase) {
    var pctHtml = pctTexto && typeof pctTexto === 'object'
      ? esc(pctTexto.cifra) + (pctTexto.nota ? '<br><small class="texto-3">' + esc(pctTexto.nota) + '</small>' : '')
      : esc(pctTexto);
    return '<tr><td><strong>' + esc(texto) + '</strong></td><td class="num"><strong class="' + esc(clase || '') + '">' + esc(valor) + '</strong></td>' +
      '<td class="num texto-2" style="white-space:nowrap">' + pctHtml + '</td></tr>';
  }

  function tarjetaResultados(est, r) {
    var er = estadoResultados(est, r.desde, r.hasta);
    var cuerpo;
    if (!er.ingresos.length && !er.gastos.length) {
      cuerpo = VF.ui.vacio('Sin movimientos');
    } else {
      cuerpo = '<div class="tabla-envoltura"><table class="tabla" id="reportes-er">' +
        '<thead><tr><th scope="col">Concepto</th><th scope="col" class="num">Monto</th><th scope="col" class="num">%</th></tr></thead><tbody>';
      cuerpo += filaGrupo('Ingresos');
      if (er.ingresos.length) er.ingresos.forEach(function (f) { cuerpo += filaCategoria(f, er.totalIngresos); });
      else cuerpo += '<tr><td colspan="3" class="texto-2">Sin ingresos en el periodo</td></tr>';
      cuerpo += filaTotal('Total ingresos', fmt(er.totalIngresos), er.totalIngresos > 0 ? '100 %' : '—');
      cuerpo += filaGrupo('Gastos');
      if (er.gastos.length) er.gastos.forEach(function (f) { cuerpo += filaCategoria(f, er.totalGastos); });
      else cuerpo += '<tr><td colspan="3" class="texto-2">Sin gastos en el periodo</td></tr>';
      cuerpo += filaTotal('Total gastos', fmt(er.totalGastos), er.totalIngresos > 0 ? { cifra: pct(er.totalGastos, er.totalIngresos), nota: 'de ingresos' } : '—');
      cuerpo += filaTotal('Utilidad', fmt(er.utilidad), er.margen === null ? 'Sin ingresos' : { cifra: U.fmtNumero(er.margen, 1) + ' %', nota: 'margen' }, er.utilidad >= 0 ? 'positivo' : 'negativo');
      cuerpo += '</tbody></table></div>';
      cuerpo += '<p class="texto-3 mt-1 mb-0">Las transferencias (entre cuentas, retiros de socio y aportaciones) no cuentan como ingreso ni gasto.</p>';
    }
    return VF.ui.tarjeta({ titulo: 'Estado de resultados', acciones: '<span class="texto-3">' + esc(r.etiqueta) + '</span>', cuerpo: cuerpo, clase: 'reportes-resultados' });
  }

  /* ---------- resumen personal (ingresos por categoría) -------------------- */
  function tarjetaResumenPersonal(est, r) {
    var ing = VF.calc.ingresosPorCategoria(est, 'personal', r.desde, r.hasta);
    var totalIng = VF.calc.ingresos(est, 'personal', r.desde, r.hasta);
    var totalGas = VF.calc.gastos(est, 'personal', r.desde, r.hasta);
    var bal = VF.calc.balance(est, 'personal', r.desde, r.hasta);
    var cuerpo;
    if (!ing.length && !totalGas) {
      cuerpo = VF.ui.vacio('Sin movimientos');
    } else {
      cuerpo = '<div class="tabla-envoltura"><table class="tabla" id="reportes-resumen-personal">' +
        '<thead><tr><th scope="col">Concepto</th><th scope="col" class="num">Monto</th><th scope="col" class="num">%</th></tr></thead><tbody>';
      cuerpo += filaGrupo('Ingresos');
      if (ing.length) ing.forEach(function (f) { cuerpo += filaCategoria(f, totalIng); });
      else cuerpo += '<tr><td colspan="3" class="texto-2">Sin ingresos en el periodo</td></tr>';
      cuerpo += filaTotal('Total ingresos', fmt(totalIng), totalIng > 0 ? '100 %' : '—');
      cuerpo += filaTotal('Total gastos', fmt(totalGas), totalIng > 0 ? { cifra: pct(totalGas, totalIng), nota: 'de ingresos' } : '—');
      cuerpo += filaTotal('Balance', fmt(bal), totalIng > 0 ? { cifra: pct(bal, totalIng), nota: 'de ingresos' } : '—', bal >= 0 ? 'positivo' : 'negativo');
      cuerpo += '</tbody></table></div>';
      cuerpo += '<p class="texto-3 mt-1 mb-0">Las transferencias (ahorro programado, pago de tarjeta, aportaciones) no cuentan como ingreso ni gasto.</p>';
    }
    return VF.ui.tarjeta({ titulo: 'Resumen del periodo', acciones: '<span class="texto-3">' + esc(r.etiqueta) + '</span>', cuerpo: cuerpo, clase: 'reportes-resultados' });
  }

  /* ---------- flujo de efectivo mensual ------------------------------------ */
  function tarjetaFlujo(est, ambito, r) {
    var sf = serieFlujo(est, ambito, r.desde, r.hasta);
    var serie = sf.serie;
    var anios = {};
    serie.forEach(function (s) { anios[String(s.periodo).slice(0, 4)] = true; });
    var variosAnios = Object.keys(anios).length > 1;
    var categorias = serie.map(function (s) { return mesCorto(s.periodo, variosAnios); });
    var cuerpo = VF.ui.graficaBarras({
      series: [
        { etiqueta: 'Ingresos', valores: serie.map(function (s) { return s.ingresos; }) },
        { etiqueta: 'Gastos', valores: serie.map(function (s) { return s.gastos; }) }
      ],
      categorias: categorias,
      alto: 220,
      titulo: 'Flujo de efectivo mensual de ' + NOMBRES[ambito] + ': ingresos y gastos por mes'
    });
    var conDatos = serie.some(function (s) { return s.ingresos || s.gastos; });
    if (conDatos) {
      var totIng = U.suma(serie, function (s) { return s.ingresos; });
      var totGas = U.suma(serie, function (s) { return s.gastos; });
      var totBal = U.round2(totIng - totGas);
      cuerpo += '<div class="fila-entre mt-1" id="reportes-flujo-totales">' +
        '<span class="texto-2">Ingresos <strong class="cifra">' + esc(fmt(totIng)) + '</strong></span>' +
        '<span class="texto-2">Gastos <strong class="cifra">' + esc(fmt(totGas)) + '</strong></span>' +
        '<span class="texto-2">Balance <strong class="cifra ' + (totBal >= 0 ? 'positivo' : 'negativo') + '">' + esc(fmt(totBal)) + '</strong></span></div>';
      if (sf.extendida) {
        cuerpo += '<p class="texto-3 mt-1 mb-0">Se muestran ' + serie.length + ' meses como contexto; los totales de esta tarjeta corresponden a los meses graficados, no sólo al periodo elegido.</p>';
      }
    }
    var etiquetaMeses = serie.length
      ? capitalizar(mesLargo(sf.desdePeriodo)) + (serie.length > 1 ? ' – ' + mesLargo(sf.hastaPeriodo) : '')
      : '';
    return VF.ui.tarjeta({ titulo: 'Flujo de efectivo mensual', acciones: '<span class="texto-3">' + esc(etiquetaMeses) + '</span>', cuerpo: cuerpo, clase: 'reportes-flujo' });
  }

  /* ---------- gastos por categoría ----------------------------------------- */
  function tarjetaGastos(est, ambito, r) {
    var cats = VF.calc.gastosPorCategoria(est, ambito, r.desde, r.hasta);
    var cuerpo;
    if (!cats.length) {
      cuerpo = VF.ui.vacio('Sin gastos en este periodo');
    } else {
      var total = VF.calc.gastos(est, ambito, r.desde, r.hasta);
      cuerpo = VF.ui.graficaDona({
        datos: cats.map(function (c) { return { etiqueta: c.categoria, valor: c.monto }; }),
        titulo: 'Gastos por categoría de ' + NOMBRES[ambito] + ' en ' + r.etiqueta
      });
      cuerpo += '<details class="grafica-tabla" id="reportes-gastos-tabla"><summary>Ver todas las categorías (' + cats.length + ')</summary>' +
        '<table><thead><tr><th scope="col">Categoría</th><th scope="col">Mov.</th><th scope="col">Monto</th><th scope="col">%</th></tr></thead><tbody>';
      cats.forEach(function (c) {
        cuerpo += '<tr><th scope="row">' + esc(c.categoria) + '</th><td>' + c.cantidad + '</td><td>' + esc(fmt(c.monto)) + '</td><td>' + esc(pct(c.monto, total)) + '</td></tr>';
      });
      cuerpo += '<tr><th scope="row">Total</th><td>' + U.suma(cats, function (c) { return c.cantidad; }) + '</td><td><strong>' + esc(fmt(total)) + '</strong></td><td>100 %</td></tr>';
      cuerpo += '</tbody></table></details>';
    }
    return VF.ui.tarjeta({ titulo: 'Gastos por categoría', acciones: '<span class="texto-3">' + esc(r.etiqueta) + '</span>', cuerpo: cuerpo, clase: 'reportes-gastos' });
  }

  /* ---------- antigüedad de saldos por cobrar (empresa) -------------------- */
  function tarjetaAntiguedad(est, pc) {
    var cuerpo;
    if (!pc || pc.total <= 0) {
      cuerpo = '<p class="texto-2 mb-0">Sin facturas por cobrar.</p>';
    } else {
      var ant = VF.calc.antiguedadCxC(est);
      cuerpo = '<div class="fila-entre mb-2"><span class="texto-2">Por cobrar <strong class="cifra">' + esc(fmt(pc.total)) + '</strong></span>' +
        (pc.vencido > 0
          ? '<span class="badge badge-negativo">Vencido ' + esc(fmt(pc.vencido)) + '</span>'
          : '<span class="badge badge-positivo">Sin vencidos</span>') + '</div>';
      cuerpo += '<div id="reportes-antiguedad">';
      TRAMOS_CXC.forEach(function (t) {
        var monto = ant[t.clave] || 0;
        var p = pc.total > 0 ? monto / pc.total * 100 : 0;
        cuerpo += '<div class="mb-1" data-tramo="' + esc(t.clave) + '"><div class="fila-entre"><span class="texto-2">' + esc(t.texto) + '</span>' +
          '<strong class="cifra ' + (monto > 0 && t.tono ? esc(t.tono) : '') + '">' + esc(fmt(monto)) + '</strong></div>' +
          VF.ui.barraProgreso(p, monto > 0 ? t.tono : undefined) +
          '<p class="texto-3 mt-0 mb-0 derecha">' + esc(pct(monto, pc.total, 0)) + '</p></div>';
      });
      cuerpo += '</div>';
      cuerpo += '<p class="texto-3 mt-1 mb-0">' + esc(plural(pc.facturas.length, 'factura pendiente', 'facturas pendientes')) + ' · saldos al ' + esc(U.fmtFecha(hoy())) + ' (independientes del periodo elegido).</p>';
    }
    var acciones = '<a class="btn btn-fantasma btn-chico" href="#/cobros">Ver cobros</a>';
    return VF.ui.tarjeta({ titulo: 'Antigüedad de saldos por cobrar', acciones: acciones, cuerpo: cuerpo, clase: 'reportes-antiguedad' });
  }

  /* ---------- resumen de IVA (empresa, estimado) --------------------------- */
  function bloqueIVA(titulo, valor, sub, clase) {
    return '<div><p class="kpi-titulo">' + esc(titulo) + '</p><p class="kpi-valor ' + esc(clase || '') + '">' + esc(valor) + '</p>' +
      (sub ? '<p class="kpi-sub">' + esc(sub) + '</p>' : '') + '</div>';
  }

  function tarjetaIVA(iva, r) {
    var cuerpo;
    if (!iva.facturas && !iva.baseGastos) {
      cuerpo = '<p class="texto-2 mb-0">Sin facturas emitidas ni gastos con IVA en ' + esc(r.etiqueta.toLowerCase()) + '.</p>';
    } else {
      cuerpo = '<div class="rejilla-3" id="reportes-iva">' +
        bloqueIVA('IVA trasladado', fmt(iva.trasladado), plural(iva.facturas, 'factura emitida', 'facturas emitidas') + ' · subtotal ' + fmt(iva.subtotalFacturado)) +
        bloqueIVA('IVA acreditable (estimado)', fmt(iva.acreditable), '16/116 de ' + fmt(iva.baseGastos) + ' en ' + plural(iva.gastosConIVA, 'gasto') + ' con IVA') +
        bloqueIVA(iva.neto >= 0 ? 'IVA a cargo (estimado)' : 'IVA a favor (estimado)', fmt(Math.abs(iva.neto)), 'Trasladado − acreditable', iva.neto >= 0 ? 'negativo' : 'positivo') +
        '</div>';
      cuerpo += '<p class="texto-3 mt-1 mb-0">Estimación informativa: el trasladado suma el IVA de las facturas con emisión en el periodo (sin canceladas ni borradores); el acreditable supone IVA incluido en los gastos de ' +
        esc(CATEGORIAS_IVA.filter(function (c) { return c !== 'Servicios'; }).join(', ')) + '. No sustituye la declaración ni la contabilidad.</p>';
    }
    return VF.ui.tarjeta({ titulo: 'Resumen de IVA', acciones: '<span class="badge badge-alerta">Estimado</span>', cuerpo: cuerpo, clase: 'reportes-iva' });
  }

  /* ---------- exportar / imprimir ------------------------------------------ */
  function tarjetaExportar(ambito, r, nMovs, iva) {
    var esEmpresa = ambito === 'empresa';
    var botones = '<div class="fila" id="reportes-descargas">' +
      '<button type="button" class="btn btn-secundario" data-accion="reportes-csv-movimientos">' + VF.ui.icono('descargar') + '<span>CSV movimientos</span></button>';
    if (esEmpresa) {
      botones += '<button type="button" class="btn btn-secundario" data-accion="reportes-csv-facturas">' + VF.ui.icono('descargar') + '<span>CSV facturas</span></button>' +
        '<button type="button" class="btn btn-secundario" data-accion="reportes-csv-cxp">' + VF.ui.icono('descargar') + '<span>CSV cuentas por pagar</span></button>';
    }
    botones += '<button type="button" class="btn btn-primario" data-accion="reportes-paquete">' + VF.ui.icono('archivo') + '<span>Paquete para contador</span></button>' +
      '<button type="button" class="btn btn-secundario" data-accion="reportes-imprimir">' + VF.ui.icono('imprimir') + '<span>Imprimir / PDF</span></button>' +
      '</div>';
    var detalle = '<p class="texto-3 mt-1 mb-0">Archivos CSV (UTF-8, separados por coma) de <strong>' + esc(NOMBRES[ambito]) + '</strong> en ' + esc(r.etiqueta.toLowerCase()) +
      ': ' + esc(nombreArchivo('movimientos', r)) +
      (esEmpresa ? ', ' + esc(nombreArchivo('facturas', r)) + ', ' + esc(nombreArchivo('cxp', r)) : '') +
      '. El paquete añade ' + esc(nombreArchivo('resumen', r, '.txt')) + ' con los totales del periodo. Nunca se mezclan ámbitos.</p>';
    return VF.ui.tarjeta({ titulo: 'Exportar y compartir', acciones: VF.ui.badgeAmbito(ambito), cuerpo: botones + detalle, clase: 'reportes-exportar no-imprimir' });
  }

  function nombreArchivo(tipo, r, ext) {
    return 'villeda-' + vista.ambito + '-' + tipo + '-' + (r || rangoActual()).sufijo + (ext || '.csv');
  }
  function montoCSV(n) { return U.round2(Number(n) || 0).toFixed(2); }

  /** Filas del CSV de movimientos del ámbito y rango actuales (orden cronológico ascendente). */
  function filasMovimientos(est, ambito, r) {
    return VF.calc.movimientosEn(est, ambito, r.desde, r.hasta).slice().reverse().map(function (m) {
      var cuenta = nombreCuenta(est, m.cuentaId);
      if (m.tipo === 'transferencia' && m.cuentaDestinoId) cuenta += ' → ' + nombreCuenta(est, m.cuentaDestinoId);
      return {
        fecha: m.fecha,
        tipo: TIPO_TEXTO[m.tipo] || m.tipo || '',
        cuenta: cuenta,
        categoria: m.categoria || '',
        descripcion: m.descripcion || '',
        contraparte: m.contraparte || '',
        monto: montoCSV(m.monto),
        estado: ESTADO_MOV_TEXTO[m.estado] || m.estado || ''
      };
    });
  }
  var COLUMNAS_MOVIMIENTOS = [
    { clave: 'fecha', titulo: 'fecha' }, { clave: 'tipo', titulo: 'tipo' }, { clave: 'cuenta', titulo: 'cuenta' },
    { clave: 'categoria', titulo: 'categoría' }, { clave: 'descripcion', titulo: 'descripción' }, { clave: 'contraparte', titulo: 'contraparte' },
    { clave: 'monto', titulo: 'monto' }, { clave: 'estado', titulo: 'estado' }
  ];

  /** Filas del CSV de facturas (empresa) con fechaEmision en el rango. */
  function filasFacturas(est, r) {
    var h = hoy();
    var lista = (est.facturas || []).filter(function (f) { return f && f.fechaEmision && f.fechaEmision >= r.desde && f.fechaEmision <= r.hasta; });
    lista.sort(function (a, b) { return (a.fechaEmision < b.fechaEmision ? -1 : a.fechaEmision > b.fechaEmision ? 1 : 0) || String(a.folio || '').localeCompare(String(b.folio || ''), 'es-MX', { numeric: true }); });
    return lista.map(function (f) {
      var cliente = buscar(est.clientes, f.clienteId);
      var estadoDer = VF.calc.estadoFactura(f, h);
      return {
        folio: f.folio || '',
        cliente: cliente ? cliente.nombre : 'Cliente eliminado',
        emision: f.fechaEmision || '',
        vencimiento: f.fechaVencimiento || '',
        concepto: f.concepto || '',
        subtotal: montoCSV(f.subtotal),
        iva: montoCSV(f.iva),
        total: montoCSV(f.total),
        pagado: montoCSV(VF.calc.pagadoFactura(f)),
        pendiente: montoCSV(VF.calc.pendienteFactura(f)),
        estado: ESTADO_DOC_TEXTO[estadoDer] || estadoDer
      };
    });
  }
  var COLUMNAS_FACTURAS = [
    { clave: 'folio', titulo: 'folio' }, { clave: 'cliente', titulo: 'cliente' }, { clave: 'emision', titulo: 'emisión' },
    { clave: 'vencimiento', titulo: 'vencimiento' }, { clave: 'concepto', titulo: 'concepto' }, { clave: 'subtotal', titulo: 'subtotal' },
    { clave: 'iva', titulo: 'iva' }, { clave: 'total', titulo: 'total' }, { clave: 'pagado', titulo: 'pagado' },
    { clave: 'pendiente', titulo: 'pendiente' }, { clave: 'estado', titulo: 'estado' }
  ];

  /** Filas del CSV de cuentas por pagar (empresa) con `fecha` en el rango. */
  function filasCxP(est, r) {
    var h = hoy();
    var lista = (est.cuentasPorPagar || []).filter(function (c) { return c && c.fecha && c.fecha >= r.desde && c.fecha <= r.hasta; });
    lista.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
    return lista.map(function (c) {
      var prov = buscar(est.proveedores, c.proveedorId);
      var estadoDer = VF.calc.estadoCxP(c, h);
      var pagado = U.round2((Number(c.monto) || 0) - VF.calc.pendienteCxP(c));
      return {
        proveedor: prov ? prov.nombre : 'Proveedor eliminado',
        concepto: c.concepto || '',
        fecha: c.fecha || '',
        vencimiento: c.fechaVencimiento || '',
        monto: montoCSV(c.monto),
        pagado: montoCSV(pagado),
        pendiente: montoCSV(VF.calc.pendienteCxP(c)),
        estado: ESTADO_DOC_TEXTO[estadoDer] || estadoDer
      };
    });
  }
  var COLUMNAS_CXP = [
    { clave: 'proveedor', titulo: 'proveedor' }, { clave: 'concepto', titulo: 'concepto' }, { clave: 'fecha', titulo: 'fecha' },
    { clave: 'vencimiento', titulo: 'vencimiento' }, { clave: 'monto', titulo: 'monto' }, { clave: 'pagado', titulo: 'pagado' },
    { clave: 'pendiente', titulo: 'pendiente' }, { clave: 'estado', titulo: 'estado' }
  ];

  /**
   * Genera y descarga un CSV ('movimientos' | 'facturas' | 'cxp') del ámbito y rango actuales.
   * Devuelve { nombre, filas } (filas = número de registros; 0 = no se descargó nada).
   */
  function exportarCSV(tipo, silencioso) {
    if (!VF.store.estaDesbloqueado()) return { nombre: '', filas: 0 };
    var est = estado();
    var r = rangoActual();
    var filas, columnas, que;
    if (tipo === 'facturas') {
      if (vista.ambito !== 'empresa') { if (!silencioso) toast('Las facturas pertenecen al ámbito Empresa.', 'alerta'); return { nombre: '', filas: 0 }; }
      filas = filasFacturas(est, r); columnas = COLUMNAS_FACTURAS; que = 'facturas emitidas';
    } else if (tipo === 'cxp') {
      if (vista.ambito !== 'empresa') { if (!silencioso) toast('Las cuentas por pagar pertenecen al ámbito Empresa.', 'alerta'); return { nombre: '', filas: 0 }; }
      filas = filasCxP(est, r); columnas = COLUMNAS_CXP; que = 'cuentas por pagar';
    } else {
      tipo = 'movimientos';
      filas = filasMovimientos(est, vista.ambito, r); columnas = COLUMNAS_MOVIMIENTOS; que = 'movimientos';
    }
    var nombre = nombreArchivo(tipo, r);
    if (!filas.length) {
      if (!silencioso) toast('Sin ' + que + ' de ' + NOMBRES[vista.ambito].toLowerCase() + ' en ' + r.etiqueta.toLowerCase() + '; nada que exportar.', 'alerta');
      return { nombre: nombre, filas: 0 };
    }
    U.descargar(nombre, U.csv(filas, columnas), 'text/csv;charset=utf-8');
    if (!silencioso) toast('Descargando ' + nombre + ' (' + plural(filas.length, 'registro') + ')', 'exito');
    return { nombre: nombre, filas: filas.length };
  }

  /** Texto plano con los totales del periodo (resumen.txt del paquete para el contador). */
  function resumenTexto(est, ambito, r, archivos) {
    var L = [];
    var aj = est.ajustes || {};
    function linea(etq, val) { L.push('  ' + String(etq).padEnd(44, ' ') + String(val)); }
    L.push('VILLEDA Finanzas — Resumen para el contador');
    L.push('='.repeat(60));
    L.push('Empresa:   ' + (aj.nombreEmpresa || '—'));
    L.push('Ámbito:    ' + NOMBRES[ambito] + ' (empresa y personal se calculan por separado; este resumen NO mezcla ámbitos)');
    L.push('Periodo:   ' + r.etiqueta + ' (' + r.desde + ' a ' + r.hasta + ')');
    L.push('Generado:  ' + hoy() + ' · Moneda: ' + (aj.moneda || 'MXN'));
    L.push('');

    var movs = VF.calc.movimientosEn(est, ambito, r.desde, r.hasta);
    var ing = VF.calc.ingresos(est, ambito, r.desde, r.hasta);
    var gas = VF.calc.gastos(est, ambito, r.desde, r.hasta);
    var bal = VF.calc.balance(est, ambito, r.desde, r.hasta);
    L.push('RESULTADOS DEL PERIODO');
    if (!movs.length) {
      L.push('  Sin movimientos en el periodo.');
    } else {
      linea('Ingresos', fmt(ing));
      linea('Gastos', fmt(gas));
      linea(ambito === 'empresa' ? 'Utilidad' : 'Balance', fmt(bal));
      if (ambito === 'empresa') linea('Margen', ing > 0 ? U.fmtNumero(bal / ing * 100, 1) + ' %' : 'sin ingresos');
      linea('Movimientos', movs.length + ' (las transferencias no cuentan como ingreso ni gasto)');
      L.push('');
      L.push('INGRESOS POR CATEGORÍA');
      var ipc = VF.calc.ingresosPorCategoria(est, ambito, r.desde, r.hasta);
      if (!ipc.length) L.push('  Sin ingresos.');
      ipc.forEach(function (f) { linea(f.categoria + ' (' + f.cantidad + ')', fmt(f.monto) + '  ' + pct(f.monto, ing)); });
      L.push('');
      L.push('GASTOS POR CATEGORÍA');
      var gpc = VF.calc.gastosPorCategoria(est, ambito, r.desde, r.hasta);
      if (!gpc.length) L.push('  Sin gastos.');
      gpc.forEach(function (f) { linea(f.categoria + ' (' + f.cantidad + ')', fmt(f.monto) + '  ' + pct(f.monto, gas)); });
    }
    L.push('');

    if (ambito === 'empresa') {
      var iva = resumenIVA(est, r.desde, r.hasta);
      L.push('IVA (ESTIMADO — informativo, no sustituye la contabilidad)');
      linea('IVA trasladado (' + plural(iva.facturas, 'factura') + ', subtotal ' + fmt(iva.subtotalFacturado) + ')', fmt(iva.trasladado));
      linea('IVA acreditable estimado (16/116 de ' + fmt(iva.baseGastos) + ')', fmt(iva.acreditable));
      linea(iva.neto >= 0 ? 'IVA a cargo estimado' : 'IVA a favor estimado', fmt(Math.abs(iva.neto)));
      L.push('  Categorías con IVA consideradas: ' + CATEGORIAS_IVA.filter(function (c) { return c !== 'Servicios'; }).join(', '));
      L.push('');
      var pc = VF.calc.porCobrar(est);
      var ant = VF.calc.antiguedadCxC(est);
      L.push('CUENTAS POR COBRAR (saldos al ' + hoy() + ')');
      linea('Total por cobrar', fmt(pc.total));
      linea('Vencido', fmt(pc.vencido));
      TRAMOS_CXC.forEach(function (t) { linea('Antigüedad ' + t.clave + ' días', fmt(ant[t.clave] || 0)); });
      L.push('');
      var pp = VF.calc.porPagar(est);
      L.push('CUENTAS POR PAGAR (saldos al ' + hoy() + ')');
      linea('Total por pagar', fmt(pp.total));
      linea('Vencido', fmt(pp.vencido));
      L.push('');
    }

    L.push('ARCHIVOS DEL PAQUETE');
    (archivos || []).forEach(function (a) { linea(a.nombre, a.filas ? plural(a.filas, 'registro') : 'sin registros (no se generó)'); });
    L.push('');
    L.push('Nota: cifras generadas por VILLEDA Finanzas a partir de los registros capturados por el usuario. Fechas en formato AAAA-MM-DD; montos en MXN con dos decimales.');
    return L.join('\r\n') + '\r\n';
  }

  /** Descarga los CSV disponibles del ámbito + resumen.txt, con un retraso entre archivos. */
  function paquete() {
    if (!VF.store.estaDesbloqueado()) return false;
    if (paqueteEnCurso) { toast('Ya se está preparando el paquete…', 'info'); return false; }
    paqueteEnCurso = true;
    var est = estado();
    var ambito = vista.ambito;
    var r = rangoActual();
    var tipos = ambito === 'empresa' ? ['movimientos', 'facturas', 'cxp'] : ['movimientos'];
    var archivos = [];
    var paso = 0;
    toast('Preparando paquete para el contador (' + NOMBRES[ambito].toLowerCase() + ' · ' + r.etiqueta.toLowerCase() + ')…', 'info');
    function siguiente() {
      if (paso < tipos.length) {
        archivos.push(exportarCSV(tipos[paso], true));
        paso += 1;
        setTimeout(siguiente, RETRASO_PAQUETE_MS);
        return;
      }
      var nombre = nombreArchivo('resumen', r, '.txt');
      U.descargar(nombre, resumenTexto(est, ambito, r, archivos), 'text/plain;charset=utf-8');
      archivos.push({ nombre: nombre, filas: 1 });
      paqueteEnCurso = false;
      var generados = archivos.filter(function (a) { return a.filas > 0; }).length;
      toast('Paquete listo: ' + plural(generados, 'archivo') + ' descargado' + (generados === 1 ? '' : 's') + '.', 'exito');
    }
    siguiente();
    return true;
  }

  function imprimir() {
    abrirDetallesParaImprimir();
    try { window.print(); } catch (e) { toast('No se pudo abrir el diálogo de impresión.', 'error'); }
  }

  /* Un <details> cerrado no se imprime aunque el CSS marque su tabla como display:table: se abren antes
     de imprimir y se cierran después (sólo los que este módulo abrió). */
  function abrirDetallesParaImprimir() {
    if (VF.router.actual().ruta !== 'reportes') return;
    Array.prototype.forEach.call(document.querySelectorAll('#vista details:not([open])'), function (d) {
      d.setAttribute('open', '');
      d.setAttribute('data-reportes-abierto', '1');
    });
  }
  function cerrarDetallesTrasImprimir() {
    Array.prototype.forEach.call(document.querySelectorAll('#vista details[data-reportes-abierto]'), function (d) {
      d.removeAttribute('open');
      d.removeAttribute('data-reportes-abierto');
    });
  }
  window.addEventListener('beforeprint', abrirDetallesParaImprimir);
  window.addEventListener('afterprint', cerrarDetallesTrasImprimir);

  /* ---------- delegación de eventos (data-accion="reportes-…") ------------- */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('button[data-accion^="reportes-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    switch (t.getAttribute('data-accion')) {
      case 'reportes-csv-movimientos': exportarCSV('movimientos'); break;
      case 'reportes-csv-facturas': exportarCSV('facturas'); break;
      case 'reportes-csv-cxp': exportarCSV('cxp'); break;
      case 'reportes-paquete': paquete(); break;
      case 'reportes-imprimir': imprimir(); break;
      default: break;
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="reportes-"]') : null;
    if (!t || !VF.store.estaDesbloqueado()) return;
    var accion = t.getAttribute('data-accion');
    if (accion === 'reportes-rango') {
      fijarRango(esRango(t.value) ? t.value : 'mes');
    } else if (accion === 'reportes-fecha') {
      var iDesde = document.getElementById('reportes-desde');
      var iHasta = document.getElementById('reportes-hasta');
      var desde = iDesde && esFechaISO(iDesde.value) ? iDesde.value : vista.desde;
      var hasta = iHasta && esFechaISO(iHasta.value) ? iHasta.value : vista.hasta;
      fijarRango('personalizado', desde, hasta);
    }
  });

  /* ---------- reacción a cambios del store --------------------------------- */
  VF.store.on('cambio', function () {
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(function () {
      if (!VF.store.estaDesbloqueado()) return;
      if (VF.router.actual().ruta !== 'reportes') return;
      pintarCuerpo();
    }, 30);
  });

  /* ---------- registro ----------------------------------------------------- */
  VF.router.registrar('reportes', { titulo: 'Reportes', icono: 'reportes', nav: 'mas', render: render });

  VF.reportes = {
    render: render,
    ambito: function () { return vista.ambito; },
    fijarAmbito: fijarAmbito,
    rango: rangoActual,
    fijarRango: fijarRango,
    calcularRango: calcularRango,
    estadoResultados: estadoResultados,
    resumenIVA: resumenIVA,
    serieFlujo: serieFlujo,
    csvMovimientos: function () { return exportarCSV('movimientos'); },
    csvFacturas: function () { return exportarCSV('facturas'); },
    csvCxP: function () { return exportarCSV('cxp'); },
    paquete: paquete,
    imprimir: imprimir,
    CATEGORIAS_IVA: CATEGORIAS_IVA.slice()
  };
})(window.VF);
