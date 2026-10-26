'use strict';
/*
 * js/modules/panel.js — Vista Panel (#/panel) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  - Selector segmentado Empresa | Personal | Combinado; la elección se recuerda en sessionStorage
 *    ('vf.panel.ambito') y puede fijarse con #/panel?ambito=empresa|personal|combinado.
 *  - Por ámbito: KPIs del mes (Ingresos, Gastos, Utilidad/Balance, Disponible), "Próximos 7 días"
 *    (vencimientos: cobros en verde, pagos en rojo, botón "Ver todo"), gráfica ingresos vs gastos de
 *    6 meses (VF.ui.graficaBarras), "Para revisar" (conteo de movimientosARevisar), movimientos
 *    recientes (10, con badge de ámbito), cuentas con saldo y "Por cobrar" top 5 (sólo empresa).
 *  - Combinado: dos columnas Empresa / Personal con sus líquidos y una fila "Total combinado (solo
 *    informativo)". Nunca se suman ingresos, gastos ni presupuestos entre ámbitos (principio 0.1).
 *  - Toda cifra sale de VF.calc. Sin datos → VF.ui.vacio con la acción "Agregar movimiento".
 *  - Alta rápida, detalle, edición y eliminación de movimientos en modales (auxiliar privado de este
 *    módulo; los movimientos vinculados a facturas/CxP/préstamos/comisiones sólo se consultan).
 *  - Se vuelve a pintar al recibir VF.store 'cambio' únicamente si la ruta activa sigue siendo panel.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="panel-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.panel] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;

  var CLAVE_AMBITO = 'vf.panel.ambito';
  var NOMBRES = { empresa: 'Empresa', personal: 'Personal', combinado: 'Combinado' };
  var DIAS_PROXIMOS = 7;
  var MAX_VENCIMIENTOS = 8;
  var MAX_RECIENTES = 10;
  var MAX_COBRAR = 5;
  var MESES_GRAFICA = 6;
  var CATEGORIA_TRANSFERENCIA = 'Transferencia entre cuentas';
  var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var TIPO_TEXTO = { ingreso: 'Ingreso', gasto: 'Gasto', transferencia: 'Transferencia' };
  var TIPO_CUENTA = { cheques: 'Cheques', ahorro: 'Ahorro', credito: 'Tarjeta de crédito', efectivo: 'Efectivo', inversion: 'Inversión', billetera: 'Billetera digital' };

  var ambitoActual = leerAmbito();
  var temporizadorCambio = null;

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estado(); }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }

  function capitalizar(s) {
    s = String(s == null ? '' : s);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function plural(n, singular, pluralTexto) {
    return n + ' ' + (n === 1 ? singular : (pluralTexto || singular + 's'));
  }
  function mesLargo(periodo) {
    var p = String(periodo || '').split('-');
    var m = Number(p[1]);
    return (MESES_LARGOS[m - 1] || '') + ' ' + (p[0] || '');
  }
  function mesCorto(periodo, conAnio) {
    var p = String(periodo || '').split('-');
    var m = Number(p[1]);
    return (MESES_CORTOS[m - 1] || '') + (conAnio ? ' ' + String(p[0] || '').slice(2) : '');
  }
  function leerAmbito() {
    try {
      var v = sessionStorage.getItem(CLAVE_AMBITO);
      if (NOMBRES[v]) return v;
    } catch (e) { /* sessionStorage no disponible */ }
    return 'empresa';
  }
  function guardarAmbito(a) {
    try { sessionStorage.setItem(CLAVE_AMBITO, a); } catch (e) { /* sin almacenamiento de sesión */ }
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
  function cuentasDe(est, ambito, soloActivas) {
    return (est.cuentas || []).filter(function (c) {
      return c && c.ambito === ambito && (!soloActivas || c.activa !== false);
    });
  }
  function rangoMes() {
    var h = hoy();
    return { desde: U.inicioMes(h), hasta: U.finMes(h), periodo: U.periodo(h) };
  }
  function signo(tipo, monto) {
    if (tipo === 'ingreso') return '+' + fmt(monto);
    if (tipo === 'gasto') return '−' + fmt(monto);
    return fmt(monto);
  }
  function tonoTipo(tipo) {
    return tipo === 'ingreso' ? 'positivo' : tipo === 'gasto' ? 'negativo' : 'texto-2';
  }
  function filaCifra(etiqueta, valor, clase) {
    return '<div class="fila-entre mb-1"><span class="texto-2">' + esc(etiqueta) + '</span>' +
      '<strong class="cifra ' + esc(clase || '') + '">' + esc(valor) + '</strong></div>';
  }
  function enlaceChico(ruta, texto) {
    return '<a class="btn btn-fantasma btn-chico" href="#/' + esc(ruta) + '">' + esc(texto) + '</a>';
  }

  /* ---------- render de la ruta -------------------------------------------- */
  function render(contenedor, params) {
    var p = params || {};
    if (NOMBRES[p.ambito]) {
      ambitoActual = p.ambito;
      guardarAmbito(ambitoActual);
    }
    VF.ui.ambitoActivo(ambitoActual);
    contenedor.innerHTML = cabecera() + '<div id="panel-cuerpo"></div>';
    pintarCuerpo();
  }

  function cabecera() {
    return '<div class="vista-cabecera">' +
      '<div><h1>Panel</h1><p class="texto-2 mb-0" id="panel-fecha">' + esc(capitalizar(U.fmtFechaLarga(hoy()))) + '</p></div>' +
      '<div class="vista-acciones">' +
      VF.ui.segmentos([
        { valor: 'empresa', texto: 'Empresa' },
        { valor: 'personal', texto: 'Personal' },
        { valor: 'combinado', texto: 'Combinado' }
      ], ambitoActual, alCambiarAmbito) +
      '<button type="button" class="btn btn-primario" data-accion="panel-nuevo-movimiento">' +
      VF.ui.icono('agregar') + '<span>Movimiento</span></button>' +
      '</div></div>';
  }

  function alCambiarAmbito(valor) {
    if (!NOMBRES[valor]) return;
    ambitoActual = valor;
    guardarAmbito(valor);
    VF.ui.ambitoActivo(valor);
    if (/^#\/panel\?/.test(location.hash)) {
      try { history.replaceState(null, '', '#/panel'); } catch (e) { /* file:// en algunos navegadores */ }
    }
    pintarCuerpo();
  }

  /** Cambia el segmento activo (actualiza aria-selected) y vuelve a pintar. */
  function seleccionarSegmento(valor) {
    if (!NOMBRES[valor]) return;
    var botones = document.querySelectorAll('#vista .vista-cabecera .segmento');
    Array.prototype.forEach.call(botones, function (b) {
      var activo = b.getAttribute('data-valor') === valor;
      b.setAttribute('aria-selected', activo ? 'true' : 'false');
      if (activo) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
    });
    alCambiarAmbito(valor);
  }

  function pintarCuerpo() {
    var cuerpo = document.getElementById('panel-cuerpo');
    if (!cuerpo || !VF.store.estaDesbloqueado()) return;
    var est = estado();
    cuerpo.setAttribute('data-ambito', ambitoActual);
    cuerpo.innerHTML = ambitoActual === 'combinado' ? cuerpoCombinado(est) : cuerpoAmbito(est, ambitoActual);
  }

  /* ---------- vista de un ámbito ------------------------------------------- */
  function vacioGeneral(ambito) {
    var texto = ambito === 'combinado'
      ? 'Sin movimientos. Registra tu primer movimiento para ver aquí tus cifras reales.'
      : 'Sin movimientos en ' + NOMBRES[ambito].toLowerCase() + '. Registra tu primer movimiento para ver aquí tus cifras reales.';
    var destino = ambito === 'combinado' ? 'empresa' : ambito;
    return '<div class="tarjeta">' + VF.ui.vacio(texto, 'Agregar movimiento', function () {
      abrirFormularioMovimiento({ ambito: destino });
    }) + '</div>';
  }

  function cuerpoAmbito(est, ambito) {
    var cuentas = cuentasDe(est, ambito, false);
    var movs = VF.calc.movimientosEn(est, ambito, null, null);
    if (!cuentas.length && !movs.length) return vacioGeneral(ambito);

    var r = rangoMes();
    var movsMes = VF.calc.movimientosEn(est, ambito, r.desde, r.hasta);
    var html = kpis(est, ambito, r, movsMes, cuentas);
    html += '<div class="rejilla-2">' +
      columna(tarjetaProximos(est, ambito) + tarjetaRevisar(est, ambito)) +
      columna(tarjetaGrafica(est, ambito, false)) +
      '</div>';
    html += '<div class="rejilla-2">' +
      columna(tarjetaRecientes(est, ambito, movs)) +
      columna(tarjetaCuentas(est, ambito) + (ambito === 'empresa' ? tarjetaPorCobrar(est) : '')) +
      '</div>';
    return html;
  }

  /**
   * Columna de tarjetas apiladas dentro de una .rejilla-2. Un elemento de rejilla tiene min-width:auto,
   * así que las listas con títulos `nowrap` (.lista-titulo) ensancharían la pista hasta el texto más largo
   * y provocarían scroll horizontal en 390 px. Se usa .tarjeta-cuerpo porque es la única clase utilitaria
   * de css/app.css cuyo único efecto es `min-width: 0` (pendiente: regla `.rejilla-2 > * { min-width: 0 }`).
   */
  function columna(html) {
    return '<div class="tarjeta-cuerpo">' + html + '</div>';
  }

  function kpis(est, ambito, r, movsMes, cuentas) {
    var hay = movsMes.length > 0;
    var ing = VF.calc.ingresos(est, ambito, r.desde, r.hasta);
    var gas = VF.calc.gastos(est, ambito, r.desde, r.hasta);
    var nIng = movsMes.filter(function (m) { return m.tipo === 'ingreso'; }).length;
    var nGas = movsMes.filter(function (m) { return m.tipo === 'gasto'; }).length;
    var mes = mesLargo(r.periodo);
    var sinMovs = 'Sin movimientos en ' + mes;
    var html = '<div class="kpis">';

    html += VF.ui.kpi({
      titulo: 'Ingresos del mes',
      valor: hay ? fmt(ing) : '—',
      sub: hay ? plural(nIng, 'ingreso') + ' · ' + mes : sinMovs,
      tono: 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Gastos del mes',
      valor: hay ? fmt(gas) : '—',
      sub: hay ? plural(nGas, 'gasto') + ' · ' + mes : sinMovs,
      tono: 'neutro'
    });
    if (ambito === 'empresa') {
      var u = VF.calc.utilidadMes(est, r.periodo);
      html += VF.ui.kpi({
        titulo: 'Utilidad del mes',
        valor: hay ? fmt(u.utilidad) : '—',
        sub: hay ? (u.margen === null ? 'Sin ingresos este mes' : 'Margen ' + U.fmtNumero(u.margen, 1) + ' %') : sinMovs,
        tono: hay ? (u.utilidad >= 0 ? 'positivo' : 'negativo') : 'neutro'
      });
    } else {
      var bal = VF.calc.balance(est, ambito, r.desde, r.hasta);
      html += VF.ui.kpi({
        titulo: 'Balance del mes',
        valor: hay ? fmt(bal) : '—',
        sub: hay ? 'Ingresos − gastos' : sinMovs,
        tono: hay ? (bal >= 0 ? 'positivo' : 'negativo') : 'neutro'
      });
    }
    var activas = cuentas.filter(function (c) { return c.activa !== false; });
    var d = ambito === 'empresa' ? VF.calc.disponibleEmpresa(est) : VF.calc.disponiblePersonal(est);
    html += VF.ui.kpi({
      titulo: 'Disponible',
      valor: activas.length ? fmt(d.disponible) : 'Sin cuentas',
      sub: activas.length
        ? 'Líquido ' + fmt(d.liquido) + ' − compromisos ' + fmt(d.totalCompromisos) + ' (' + d.dias + ' días)'
        : 'Crea una cuenta para calcularlo',
      tono: activas.length ? (d.disponible < 0 ? 'negativo' : 'positivo') : 'neutro'
    });
    return html + '</div>';
  }

  /* ---------- próximos 7 días ---------------------------------------------- */
  function vencimientosDe(est, ambito, hasta) {
    return VF.calc.vencimientos(est, null, hasta).filter(function (v) {
      return ambito === 'combinado' || v.ambito === ambito;
    });
  }

  function itemVencimiento(v, conAmbito) {
    var cobro = v.tipo === 'cobro';
    // Los badges van al inicio: .lista-sub trunca con elipsis y en 390 px lo del final se pierde.
    var sub = (conAmbito ? VF.ui.badgeAmbito(v.ambito) + ' ' : '') +
      (v.vencido ? '<span class="badge badge-negativo">Vencido</span> ' : '') +
      esc(capitalizar(VF.ui.fechaRelativa(v.fecha))) + ' · ' + esc(U.fmtFecha(v.fecha));
    return '<li class="lista-item clicable" role="button" tabindex="0" data-accion="panel-ir-origen"' +
      ' data-coleccion="' + esc(v.origen.coleccion) + '" data-id="' + esc(v.origen.id) + '" data-ambito="' + esc(v.ambito) + '">' +
      '<span class="lista-icono">' + VF.ui.icono(cobro ? 'ingreso' : 'gasto') + '</span>' +
      '<div class="lista-texto"><p class="lista-titulo">' + esc(v.concepto) + '</p><p class="lista-sub">' + sub + '</p></div>' +
      '<span class="lista-valor ' + (cobro ? 'positivo' : 'negativo') + '">' + esc((cobro ? '+' : '−') + fmt(v.monto)) + '</span>' +
      '</li>';
  }

  function tarjetaProximos(est, ambito) {
    var h = hoy();
    var lista = vencimientosDe(est, ambito, U.sumarDias(h, DIAS_PROXIMOS));
    var vencidos = lista.filter(function (v) { return v.vencido; }).length;
    var mostrar = lista.slice(0, MAX_VENCIMIENTOS);
    var cuerpo;
    if (!lista.length) {
      cuerpo = '<p class="texto-2 mb-0">Sin vencimientos pendientes en los próximos 7 días.</p>';
    } else {
      cuerpo = '<ul class="lista">' + mostrar.map(function (v) { return itemVencimiento(v, ambito === 'combinado'); }).join('') + '</ul>';
      if (lista.length > mostrar.length) {
        cuerpo += '<p class="texto-3 mt-1 mb-0">' + (lista.length - mostrar.length) + ' más en “Ver todo”.</p>';
      }
      if (ambito !== 'combinado') {
        var cobros = U.suma(lista.filter(function (v) { return v.tipo === 'cobro'; }), function (v) { return v.monto; });
        var pagos = U.suma(lista.filter(function (v) { return v.tipo === 'pago'; }), function (v) { return v.monto; });
        cuerpo += '<div class="fila-entre mt-1"><span class="texto-2">Cobros <strong class="cifra positivo">' + esc(fmt(cobros)) + '</strong></span>' +
          '<span class="texto-2">Pagos <strong class="cifra negativo">' + esc(fmt(pagos)) + '</strong></span></div>';
      }
    }
    var acciones = '<span class="fila">' +
      (vencidos ? '<span class="badge badge-negativo">' + esc(plural(vencidos, 'vencido')) + '</span>' : '') +
      '<button type="button" class="btn btn-fantasma btn-chico" data-accion="panel-ver-vencimientos">Ver todo</button></span>';
    return VF.ui.tarjeta({ titulo: 'Próximos 7 días', acciones: acciones, cuerpo: cuerpo });
  }

  /* ---------- gráfica 6 meses --------------------------------------------- */
  function tarjetaGrafica(est, ambito, conAmbito) {
    var serie = VF.calc.serieMensual(est, ambito, MESES_GRAFICA);
    var anios = {};
    serie.forEach(function (s) { anios[String(s.periodo).slice(0, 4)] = true; });
    var variosAnios = Object.keys(anios).length > 1;
    var categorias = serie.map(function (s) { return mesCorto(s.periodo, variosAnios); });
    var grafica = VF.ui.graficaBarras({
      series: [
        { etiqueta: 'Ingresos', valores: serie.map(function (s) { return s.ingresos; }) },
        { etiqueta: 'Gastos', valores: serie.map(function (s) { return s.gastos; }) }
      ],
      categorias: categorias,
      alto: 220,
      titulo: 'Ingresos y gastos mensuales de ' + NOMBRES[ambito] + ', últimos ' + MESES_GRAFICA + ' meses'
    });
    return VF.ui.tarjeta({
      titulo: 'Ingresos vs gastos' + (conAmbito ? ' · ' + NOMBRES[ambito] : ''),
      acciones: '<span class="texto-3">Últimos ' + MESES_GRAFICA + ' meses</span>',
      cuerpo: grafica
    });
  }

  /* ---------- movimientos recientes --------------------------------------- */
  function itemMovimiento(est, m, extra) {
    var titulo = m.descripcion || m.categoria || TIPO_TEXTO[m.tipo] || 'Movimiento';
    var dias = Math.abs(U.diasEntre(m.fecha, hoy()));
    var fecha = dias < 7 ? capitalizar(VF.ui.fechaRelativa(m.fecha)) : U.fmtFecha(m.fecha);
    // Badges al inicio de la línea secundaria (se trunca con elipsis en pantallas angostas).
    var sub = VF.ui.badgeAmbito(m.ambito) + ' ' +
      (m.estado === 'revisar' ? '<span class="badge badge-alerta">Revisar</span> ' : '') +
      (extra ? esc(extra) + ' · ' : '') +
      esc(fecha) + ' · ' + esc(nombreCuenta(est, m.cuentaId)) +
      (m.tipo === 'transferencia' && m.cuentaDestinoId ? ' → ' + esc(nombreCuenta(est, m.cuentaDestinoId)) : '');
    return '<li class="lista-item clicable" role="button" tabindex="0" data-accion="panel-ver-movimiento" data-id="' + esc(m.id) + '">' +
      '<span class="lista-icono">' + VF.ui.icono(TIPO_TEXTO[m.tipo] ? m.tipo : 'info') + '</span>' +
      '<div class="lista-texto"><p class="lista-titulo">' + esc(titulo) + '</p><p class="lista-sub">' + sub + '</p></div>' +
      '<span class="lista-valor ' + tonoTipo(m.tipo) + '">' + esc(signo(m.tipo, m.monto)) + '</span>' +
      '</li>';
  }

  function recientesCombinados(est) {
    var todos = VF.calc.movimientosEn(est, 'empresa', null, null).concat(VF.calc.movimientosEn(est, 'personal', null, null));
    // Sólo se ordenan para mostrarlos juntos; no se suma nada entre ámbitos.
    todos.sort(function (a, b) {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
      var ca = a.creado || '', cb = b.creado || '';
      return ca === cb ? 0 : (ca < cb ? 1 : -1);
    });
    return todos;
  }

  function tarjetaRecientes(est, ambito, movs) {
    var lista = movs.slice(0, MAX_RECIENTES);
    var cuerpo;
    if (lista.length) {
      cuerpo = '<ul class="lista">' + lista.map(function (m) { return itemMovimiento(est, m); }).join('') + '</ul>';
    } else {
      cuerpo = VF.ui.vacio('Sin movimientos', 'Agregar movimiento', function () {
        abrirFormularioMovimiento({ ambito: ambito === 'combinado' ? 'empresa' : ambito });
      });
    }
    var acciones = ambito === 'combinado' ? '' : enlaceChico(ambito, 'Ver todos');
    return VF.ui.tarjeta({ titulo: 'Movimientos recientes', acciones: acciones, cuerpo: cuerpo });
  }

  /* ---------- cuentas y saldos (un ámbito) --------------------------------- */
  function cuerpoCuentas(est, ambito) {
    var s = VF.calc.saldosPorAmbito(est, ambito);
    if (!s.cuentas.length) {
      return '<p class="texto-2 mb-1">Sin cuentas activas.</p>' +
        '<a class="btn btn-secundario btn-chico" href="#/' + esc(ambito) + '">Crear cuenta</a>';
    }
    var items = s.cuentas.map(function (x) {
      return {
        icono: 'cuenta',
        titulo: x.cuenta.nombre,
        sub: (x.cuenta.banco ? x.cuenta.banco + ' · ' : '') + (TIPO_CUENTA[x.cuenta.tipo] || x.cuenta.tipo || ''),
        valor: fmt(x.saldo),
        tono: x.saldo < 0 ? 'negativo' : undefined,
        accion: 'panel-ir-cuenta',
        id: x.cuenta.id
      };
    });
    var html = VF.ui.lista(items);
    html += '<div class="mt-1">' + filaCifra('Líquido', fmt(s.liquido));
    if (s.credito !== 0) html += filaCifra('Tarjetas (deuda)', fmt(s.credito), 'negativo');
    html += filaCifra('Total', fmt(s.total)) + '</div>';
    return html;
  }

  function tarjetaCuentas(est, ambito) {
    return VF.ui.tarjeta({ titulo: 'Cuentas', acciones: enlaceChico(ambito, 'Administrar'), cuerpo: cuerpoCuentas(est, ambito) });
  }

  /* ---------- por cobrar (sólo empresa) ----------------------------------- */
  function tarjetaPorCobrar(est) {
    var pc = VF.calc.porCobrar(est);
    var cuerpo;
    if (!pc.facturas.length) {
      cuerpo = '<p class="texto-2 mb-0">Sin facturas por cobrar.</p>';
    } else {
      cuerpo = '<div class="fila-entre mb-1"><span class="texto-2">Total <strong class="cifra">' + esc(fmt(pc.total)) + '</strong></span>' +
        (pc.vencido > 0
          ? '<span class="badge badge-negativo">Vencido ' + esc(fmt(pc.vencido)) + '</span>'
          : '<span class="badge badge-positivo">Sin vencidos</span>') + '</div>';
      cuerpo += VF.ui.lista(pc.porCliente.slice(0, MAX_COBRAR).map(function (c) {
        return {
          titulo: c.cliente ? c.cliente.nombre : 'Cliente eliminado',
          sub: plural(c.facturas.length, 'factura') + (c.vencido > 0 ? ' · vencido ' + fmt(c.vencido) : ''),
          valor: fmt(c.total),
          tono: c.vencido > 0 ? 'negativo' : undefined,
          accion: 'panel-ir-cliente',
          id: c.clienteId
        };
      }));
      if (pc.porCliente.length > MAX_COBRAR) {
        cuerpo += '<p class="texto-3 mt-1 mb-0">' + esc(plural(pc.porCliente.length - MAX_COBRAR, 'cliente más', 'clientes más')) + ' en Cobros.</p>';
      }
    }
    return VF.ui.tarjeta({ titulo: 'Por cobrar', acciones: enlaceChico('cobros', 'Ver todo'), cuerpo: cuerpo });
  }

  /* ---------- para revisar ------------------------------------------------ */
  function revisionDe(est, ambito) {
    return VF.calc.movimientosARevisar(est, ambito === 'combinado' ? undefined : ambito);
  }

  function tarjetaRevisar(est, ambito) {
    var rev = revisionDe(est, ambito);
    var cuerpo, acciones;
    if (!rev.total) {
      cuerpo = '<p class="texto-2 mb-0 fila">' + VF.ui.icono('exito') + '<span>Nada pendiente de revisar.</span></p>';
      acciones = '<span class="badge badge-positivo">0</span>';
    } else {
      var partes = [];
      if (rev.duplicados.length) partes.push(plural(rev.duplicados.length, 'posible duplicado'));
      if (rev.atipicos.length) partes.push(plural(rev.atipicos.length, 'gasto atípico'));
      if (rev.marcados.length) partes.push(plural(rev.marcados.length, 'marcado') + ' para revisar');
      if (rev.sinCategoria.length) partes.push(rev.sinCategoria.length + ' sin categoría');
      cuerpo = '<p class="mb-1">' + esc(capitalizar(partes.join(' · '))) + '.</p>' +
        '<div class="fila">' +
        '<button type="button" class="btn btn-secundario btn-chico" data-accion="panel-ver-revision">Ver detalle</button>' +
        '<a class="btn btn-fantasma btn-chico" href="#/asistente?pregunta=' + encodeURIComponent('¿Qué movimientos debo revisar?') + '">Preguntar al asistente</a>' +
        '</div>';
      acciones = '<span class="badge badge-alerta">' + rev.total + '</span>';
    }
    return VF.ui.tarjeta({ titulo: 'Para revisar', acciones: acciones, cuerpo: cuerpo });
  }

  /* ---------- vista combinada --------------------------------------------- */
  function bloqueCifra(titulo, valor, clase) {
    return '<div><p class="kpi-titulo">' + esc(titulo) + '</p><p class="kpi-valor ' + esc(clase || '') + '">' + esc(valor) + '</p></div>';
  }

  function columnaAmbito(est, ambito, r) {
    var movsMes = VF.calc.movimientosEn(est, ambito, r.desde, r.hasta);
    var hay = movsMes.length > 0;
    var cuerpo = cuerpoCuentas(est, ambito) + '<hr>' +
      '<p class="kpi-titulo">Este mes · ' + esc(mesLargo(r.periodo)) + '</p>';
    if (hay) {
      var ing = VF.calc.ingresos(est, ambito, r.desde, r.hasta);
      var gas = VF.calc.gastos(est, ambito, r.desde, r.hasta);
      var bal = VF.calc.balance(est, ambito, r.desde, r.hasta);
      cuerpo += filaCifra('Ingresos', fmt(ing)) + filaCifra('Gastos', fmt(gas)) +
        filaCifra(ambito === 'empresa' ? 'Utilidad' : 'Balance', fmt(bal), bal >= 0 ? 'positivo' : 'negativo');
    } else {
      cuerpo += '<p class="texto-2 mb-0">Sin movimientos este mes.</p>';
    }
    var acciones = '<span class="fila">' + VF.ui.badgeAmbito(ambito) + enlaceChico(ambito, 'Abrir') + '</span>';
    return VF.ui.tarjeta({ titulo: NOMBRES[ambito], acciones: acciones, cuerpo: cuerpo });
  }

  function cuerpoCombinado(est) {
    if (!(est.cuentas || []).length && !(est.movimientos || []).length) return vacioGeneral('combinado');
    var r = rangoMes();
    var comb = VF.calc.combinado(est);
    var ci = comb.combinadoInformativo;
    var html = '<div class="rejilla-2">' + columnaAmbito(est, 'empresa', r) + columnaAmbito(est, 'personal', r) + '</div>';
    html += VF.ui.tarjeta({
      titulo: ci.etiqueta || 'Total combinado (solo informativo)',
      acciones: VF.ui.badgeAmbito('combinado'),
      cuerpo: '<div class="rejilla-3" id="panel-total-combinado">' +
        bloqueCifra('Líquido', fmt(ci.liquido)) +
        bloqueCifra('Tarjetas (deuda)', fmt(ci.credito), ci.credito < 0 ? 'negativo' : '') +
        bloqueCifra('Total', fmt(ci.total)) +
        '</div>' +
        '<p class="texto-3 mt-1 mb-0">Suma informativa de ambos ámbitos. Empresa y personal se calculan por separado: ingresos, gastos, utilidad y presupuestos nunca se mezclan.</p>'
    });
    html += '<div class="rejilla-2">' + columna(tarjetaProximos(est, 'combinado')) + columna(tarjetaRevisar(est, 'combinado')) + '</div>';
    html += '<div class="rejilla-2">' + columna(tarjetaGrafica(est, 'empresa', true)) + columna(tarjetaGrafica(est, 'personal', true)) + '</div>';
    html += tarjetaRecientes(est, 'combinado', recientesCombinados(est));
    return html;
  }

  /* ---------- navegación al origen de un vencimiento ----------------------- */
  function irOrigen(coleccion, id, ambito) {
    switch (coleccion) {
      case 'facturas': VF.router.ir('facturas', { id: id }); break;
      case 'cuentasPorPagar': VF.router.ir('proveedores', { pestana: 'cxp', id: id }); break;
      case 'comisiones': VF.router.ir('proveedores', { pestana: 'comisiones', id: id }); break;
      case 'prestamos': VF.router.ir('prestamos', { id: id }); break;
      case 'cuentas': VF.router.ir(ambito === 'personal' ? 'personal' : 'empresa', { cuenta: id }); break;
      default: break;
    }
  }

  /* ---------- modal: todos los vencimientos -------------------------------- */
  function abrirVencimientos(ambito) {
    ambito = NOMBRES[ambito] ? ambito : ambitoActual;
    var est = estado();
    var lista = vencimientosDe(est, ambito, null);
    var mapa = {};
    var filas = lista.map(function (v, i) {
      var id = 'v' + i;
      mapa[id] = v;
      return { id: id, fecha: v.fecha, concepto: v.concepto, tipo: v.tipo, monto: v.monto, ambito: v.ambito, vencido: v.vencido };
    });
    var columnas = [
      { clave: 'fecha', titulo: 'Fecha', render: function (f, fila) {
        // .truncar (nowrap) evita que la columna de fecha se parta en dos líneas en escritorio.
        return '<span class="truncar">' + esc(U.fmtFecha(f)) + '</span><br><small class="truncar ' + (fila.vencido ? 'negativo' : 'texto-2') + '">' + esc(capitalizar(VF.ui.fechaRelativa(f))) + '</small>';
      } },
      { clave: 'concepto', titulo: 'Concepto', render: function (c, fila) {
        return esc(c) + (ambito === 'combinado' ? ' ' + VF.ui.badgeAmbito(fila.ambito) : '');
      } },
      { clave: 'tipo', titulo: 'Tipo', render: function (t) {
        return '<span class="badge badge-' + (t === 'cobro' ? 'positivo' : 'negativo') + '">' + (t === 'cobro' ? 'Cobro' : 'Pago') + '</span>';
      } },
      { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: function (m, fila) {
        return '<strong class="' + (fila.tipo === 'cobro' ? 'positivo' : 'negativo') + '">' + esc((fila.tipo === 'cobro' ? '+' : '−') + fmt(m)) + '</strong>';
      } }
    ];
    var cuerpo;
    if (!lista.length) {
      cuerpo = VF.ui.vacio('Sin vencimientos pendientes');
    } else {
      cuerpo = '<p class="texto-2">' + esc(plural(lista.length, 'vencimiento pendiente', 'vencimientos pendientes')) + '. Toca uno para abrir su origen.</p>';
      if (ambito !== 'combinado') {
        var cobros = U.suma(lista.filter(function (v) { return v.tipo === 'cobro'; }), function (v) { return v.monto; });
        var pagos = U.suma(lista.filter(function (v) { return v.tipo === 'pago'; }), function (v) { return v.monto; });
        cuerpo += '<div class="fila-entre mb-1"><span class="texto-2">Cobros <strong class="cifra positivo">' + esc(fmt(cobros)) + '</strong></span>' +
          '<span class="texto-2">Pagos <strong class="cifra negativo">' + esc(fmt(pagos)) + '</strong></span></div>';
      }
      cuerpo += VF.ui.tabla({
        columnas: columnas,
        filas: filas,
        vacio: 'Sin vencimientos',
        onFila: function (id) {
          var v = mapa[id];
          if (v) irOrigen(v.origen.coleccion, v.origen.id, v.ambito);
        }
      });
    }
    return VF.ui.modal({ titulo: 'Vencimientos · ' + NOMBRES[ambito], cuerpo: cuerpo, botones: [{ texto: 'Cerrar', tono: 'secundario' }] });
  }

  /* ---------- modal: detalle de la revisión -------------------------------- */
  function abrirRevision(ambito) {
    ambito = NOMBRES[ambito] ? ambito : ambitoActual;
    var est = estado();
    var rev = revisionDe(est, ambito);
    var html = '';

    function seccion(titulo, ayuda, items) {
      if (!items.length) return;
      html += '<h3 class="mt-2">' + esc(titulo) + '</h3><p class="texto-2">' + esc(ayuda) + '</p><ul class="lista">' + items.join('') + '</ul>';
    }

    var vistos = {};
    var dup = [];
    rev.duplicados.forEach(function (par) {
      par.forEach(function (m) {
        if (vistos[m.id]) return;
        vistos[m.id] = true;
        dup.push(itemMovimiento(est, m));
      });
    });
    seccion('Posibles duplicados', 'Misma cuenta, fecha, monto y tipo. Si uno sobra, elimínalo desde su detalle.', dup);
    seccion('Gastos atípicos', 'Más de 3 veces la mediana de su categoría.', rev.atipicos.map(function (a) {
      return itemMovimiento(est, a.mov, U.fmtNumero(a.veces, 1) + '× la mediana (' + fmt(a.mediana) + ')');
    }));
    seccion('Marcados para revisar', 'Movimientos guardados con estado “por revisar”.', rev.marcados.map(function (m) { return itemMovimiento(est, m); }));
    seccion('Sin categoría', 'Asigna una categoría para que cuenten en presupuestos y reportes.', rev.sinCategoria.map(function (m) { return itemMovimiento(est, m); }));

    if (!html) html = VF.ui.vacio('Nada pendiente de revisar');
    else html = '<p class="mb-0">' + esc(plural(rev.total, 'hallazgo')) + '. Toca un movimiento para ver su detalle.</p>' + html;
    return VF.ui.modal({ titulo: 'Para revisar · ' + NOMBRES[ambito], cuerpo: html, botones: [{ texto: 'Cerrar', tono: 'secundario' }] });
  }

  /* ---------- modal: detalle de un movimiento ------------------------------ */
  function abrirDetalleMovimiento(id) {
    var est = estado();
    var m = buscar(est.movimientos, id);
    if (!m) { toast('El movimiento ya no existe.', 'alerta'); return null; }
    var vinculo = m.facturaId ? 'una factura (Facturas y cobros)'
      : m.cxpId ? 'una cuenta por pagar (Proveedores)'
        : m.prestamoId ? 'un préstamo (Préstamos)'
          : m.comisionId ? 'una comisión (Proveedores)' : '';
    var filas = [
      ['Fecha', esc(U.fmtFecha(m.fecha)) + ' <small class="texto-3">' + esc(capitalizar(VF.ui.fechaRelativa(m.fecha))) + '</small>'],
      ['Cuenta', esc(nombreCuenta(est, m.cuentaId))],
      m.tipo === 'transferencia' ? ['Cuenta destino', esc(nombreCuenta(est, m.cuentaDestinoId))] : null,
      ['Categoría', esc(m.categoria || 'Sin categoría')],
      ['Descripción', esc(m.descripcion || '—')],
      ['Contraparte', esc(m.contraparte || '—')],
      ['Estado', m.estado === 'revisar' ? '<span class="badge badge-alerta">Por revisar</span>' : '<span class="badge badge-positivo">Confirmado</span>']
    ].filter(Boolean);
    var cuerpo = '<p class="hero-cifra cifra mb-0 ' + tonoTipo(m.tipo) + '">' + esc(signo(m.tipo, m.monto)) + '</p>' +
      '<p class="fila mb-2"><span class="badge badge-info">' + esc(TIPO_TEXTO[m.tipo] || m.tipo) + '</span>' + VF.ui.badgeAmbito(m.ambito) + '</p>' +
      filas.map(function (f) {
        return '<div class="fila-entre mb-1"><span class="texto-2">' + f[0] + '</span><span class="derecha">' + f[1] + '</span></div>';
      }).join('') +
      (vinculo ? '<p class="aviso aviso-alerta mt-2 mb-0">Este movimiento está vinculado a ' + esc(vinculo) + '. Edítalo o elimínalo desde esa sección para mantener la consistencia.</p>' : '');
    var botones = [];
    if (!vinculo) {
      botones.push({
        texto: 'Eliminar', tono: 'peligro',
        accion: function () {
          return VF.ui.confirmar('¿Eliminar este movimiento? El saldo de la cuenta se recalculará.', { peligro: true, textoAceptar: 'Eliminar' })
            .then(function (ok) {
              if (!ok) return false;
              try {
                VF.store.eliminar('movimientos', m.id);
                toast('Movimiento eliminado', 'exito');
                return true;
              } catch (e) {
                toast('No se pudo eliminar: ' + (e && e.message ? e.message : e), 'error');
                return false;
              }
            });
        }
      });
      botones.push({
        texto: 'Editar', tono: 'secundario',
        accion: function () { setTimeout(function () { abrirFormularioMovimiento({ id: m.id }); }, 60); }
      });
    }
    botones.push({ texto: 'Cerrar', tono: 'primario' });
    return VF.ui.modal({ titulo: 'Movimiento', cuerpo: cuerpo, botones: botones });
  }

  /* ---------- modal: alta rápida / edición de movimiento ------------------- */
  function llenarSelect(sel, opciones, valor, placeholder) {
    if (!sel) return;
    var html = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    var existe = false;
    opciones.forEach(function (op) {
      var sel2 = String(op.valor) === String(valor);
      if (sel2) existe = true;
      html += '<option value="' + esc(op.valor) + '"' + (sel2 ? ' selected' : '') + '>' + esc(op.texto) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = existe ? String(valor) : '';
  }

  function agruparCampos(form, nombres) {
    var conts = nombres.map(function (n) { return form.querySelector('[data-campo-cont="' + n + '"]'); }).filter(Boolean);
    if (conts.length < 2) return;
    var fila = document.createElement('div');
    fila.className = 'form-fila';
    conts[0].parentNode.insertBefore(fila, conts[0]);
    conts.forEach(function (c) { fila.appendChild(c); });
  }

  /** Rellena cuentas / destino / categorías según ámbito y tipo elegidos y muestra los avisos. */
  function actualizarFormulario(form, envoltura, iniciales) {
    var est = estado();
    var v = VF.ui.leerFormulario(form);
    var ini = iniciales || {};
    var ambito = v.ambito === 'personal' ? 'personal' : 'empresa';
    var tipo = TIPO_TEXTO[v.tipo] ? v.tipo : 'gasto';
    var esTransfer = tipo === 'transferencia';

    var cuentas = cuentasDe(est, ambito, true);
    var cuentaActual = v.cuentaId || ini.cuentaId || '';
    if (!cuentas.some(function (c) { return c.id === cuentaActual; })) cuentaActual = cuentas.length === 1 ? cuentas[0].id : '';
    llenarSelect(form.querySelector('[data-campo="cuentaId"]'), cuentas.map(function (c) {
      return { valor: c.id, texto: c.nombre + (c.banco ? ' · ' + c.banco : '') };
    }), cuentaActual, 'Elige una cuenta');

    var destinos = (est.cuentas || []).filter(function (c) { return c.activa !== false && c.id !== cuentaActual; }).map(function (c) {
      return { valor: c.id, texto: NOMBRES[c.ambito] + ' · ' + c.nombre };
    });
    var destinoActual = v.cuentaDestinoId || ini.cuentaDestinoId || '';
    llenarSelect(form.querySelector('[data-campo="cuentaDestinoId"]'), destinos, destinoActual, 'Elige la cuenta destino');

    var cats = (est.categorias && est.categorias[ambito] && est.categorias[ambito][tipo === 'ingreso' ? 'ingreso' : 'gasto']) || [];
    var catActual = v.categoria || ini.categoria || '';
    llenarSelect(form.querySelector('[data-campo="categoria"]'), cats.map(function (c) { return { valor: c, texto: c }; }), catActual, 'Elige una categoría');

    var contDestino = form.querySelector('[data-campo-cont="cuentaDestinoId"]');
    var contCat = form.querySelector('[data-campo-cont="categoria"]');
    if (contDestino) contDestino.hidden = !esTransfer;
    if (contCat) contCat.hidden = esTransfer;

    var avisoSin = envoltura.querySelector('[data-aviso-sin-cuentas]');
    if (avisoSin) {
      if (!cuentas.length) {
        avisoSin.innerHTML = 'No hay cuentas activas en ' + esc(NOMBRES[ambito]) + '. ' +
          '<a href="#/' + esc(ambito) + '">Crea una cuenta en ' + esc(NOMBRES[ambito]) + '</a> para poder registrar movimientos.';
        avisoSin.hidden = false;
      } else {
        avisoSin.hidden = true;
      }
    }
    var avisoCruce = envoltura.querySelector('[data-aviso-cruce]');
    if (avisoCruce) {
      var origen = buscar(est.cuentas, cuentaActual);
      var destino = buscar(est.cuentas, form.querySelector('[data-campo="cuentaDestinoId"]').value);
      if (esTransfer && origen && destino && origen.ambito !== destino.ambito) {
        var cat = origen.ambito === 'empresa' ? 'Retiro de socio' : 'Aportación de capital';
        avisoCruce.textContent = 'Las cuentas son de ámbitos distintos: se registrará como «' + cat + '» (' +
          NOMBRES[origen.ambito] + ' → ' + NOMBRES[destino.ambito] + '). Afecta los saldos pero no cuenta como ingreso ni gasto.';
        avisoCruce.hidden = false;
      } else {
        avisoCruce.hidden = true;
      }
    }
  }

  /**
   * Abre el modal de alta rápida (opciones.ambito, opciones.tipo) o de edición (opciones.id).
   * Devuelve la api del modal ({ cerrar, elemento }) o null.
   */
  function abrirFormularioMovimiento(opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est) return null;
    var existente = o.id ? buscar(est.movimientos, o.id) : null;
    if (o.id && !existente) { toast('El movimiento ya no existe.', 'alerta'); return null; }
    if (existente && (existente.facturaId || existente.cxpId || existente.prestamoId || existente.comisionId)) {
      toast('Este movimiento está vinculado; edítalo desde su sección.', 'alerta');
      return null;
    }
    var cuentaOrigen = existente ? buscar(est.cuentas, existente.cuentaId) : null;
    var ambito;
    if (existente) ambito = cuentaOrigen ? cuentaOrigen.ambito : existente.ambito;
    else if (o.ambito === 'empresa' || o.ambito === 'personal') ambito = o.ambito;
    else ambito = ambitoActual === 'combinado' ? 'empresa' : ambitoActual;

    var valores = existente ? {
      ambito: ambito, tipo: existente.tipo, cuentaId: existente.cuentaId, cuentaDestinoId: existente.cuentaDestinoId || '',
      monto: existente.monto, fecha: existente.fecha, categoria: existente.categoria || '', descripcion: existente.descripcion || '',
      contraparte: existente.contraparte || '', estado: existente.estado === 'revisar' ? 'revisar' : 'confirmado'
    } : {
      ambito: ambito, tipo: TIPO_TEXTO[o.tipo] ? o.tipo : 'gasto', cuentaId: '', cuentaDestinoId: '', monto: '', fecha: hoy(),
      categoria: '', descripcion: '', contraparte: '', estado: 'confirmado'
    };

    var campos = [
      { nombre: 'ambito', etiqueta: 'Ámbito', tipo: 'select', requerido: true, ayuda: 'Empresa y personal nunca se mezclan.',
        opciones: [{ valor: 'empresa', texto: 'Empresa' }, { valor: 'personal', texto: 'Personal' }] },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true,
        opciones: [{ valor: 'gasto', texto: 'Gasto' }, { valor: 'ingreso', texto: 'Ingreso' }, { valor: 'transferencia', texto: 'Transferencia' }] },
      { nombre: 'cuentaId', etiqueta: 'Cuenta', tipo: 'select', requerido: true, placeholder: 'Elige una cuenta', opciones: [] },
      { nombre: 'cuentaDestinoId', etiqueta: 'Cuenta destino', tipo: 'select', placeholder: 'Elige la cuenta destino', opciones: [],
        ayuda: 'Puede ser de otro ámbito: se registrará como Retiro de socio o Aportación de capital.' },
      { nombre: 'monto', etiqueta: 'Monto (MXN)', tipo: 'monto', requerido: true, min: 0.01, placeholder: '0.00' },
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', requerido: true },
      { nombre: 'categoria', etiqueta: 'Categoría', tipo: 'select', placeholder: 'Elige una categoría', opciones: [] },
      { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'texto', placeholder: '¿En qué se usó o de dónde viene?', maxlength: 140 },
      { nombre: 'contraparte', etiqueta: 'Contraparte', tipo: 'texto', placeholder: 'Cliente, proveedor, comercio…', maxlength: 100 },
      { nombre: 'estado', etiqueta: 'Estado', tipo: 'select',
        opciones: [{ valor: 'confirmado', texto: 'Confirmado' }, { valor: 'revisar', texto: 'Por revisar' }] }
    ];

    var envoltura = VF.ui.el('<div>' +
      '<p class="aviso aviso-alerta" data-aviso-sin-cuentas hidden></p>' +
      VF.ui.formulario(campos, valores) +
      '<p class="aviso aviso-alerta" data-aviso-cruce hidden></p>' +
      '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['ambito', 'tipo']);
    agruparCampos(form, ['monto', 'fecha']);
    agruparCampos(form, ['contraparte', 'estado']);

    var reglas = {
      monto: function (x) { return x > 0 ? null : 'Ingresa un monto mayor a cero'; },
      cuentaId: function (x) { return x ? null : 'Elige una cuenta'; },
      cuentaDestinoId: function (x, vals) {
        if (vals.tipo !== 'transferencia') return null;
        if (!x) return 'Elige la cuenta destino';
        if (x === vals.cuentaId) return 'La cuenta destino debe ser distinta a la de origen';
        return null;
      },
      categoria: function (x, vals) { return vals.tipo !== 'transferencia' && !x ? 'Elige una categoría' : null; }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var estAhora = estado();
      if (!estAhora) return false;
      var origen = buscar(estAhora.cuentas, v.cuentaId);
      if (!origen) { toast('La cuenta elegida ya no existe.', 'error'); return false; }
      var destino = v.tipo === 'transferencia' ? buscar(estAhora.cuentas, v.cuentaDestinoId) : null;
      if (v.tipo === 'transferencia' && !destino) { toast('La cuenta destino ya no existe.', 'error'); return false; }
      var categoria = v.tipo === 'transferencia'
        ? (destino.ambito !== origen.ambito ? (origen.ambito === 'empresa' ? 'Retiro de socio' : 'Aportación de capital') : CATEGORIA_TRANSFERENCIA)
        : v.categoria;
      var registro = {
        ambito: origen.ambito,
        cuentaId: origen.id,
        tipo: v.tipo,
        monto: U.round2(v.monto),
        fecha: v.fecha,
        categoria: categoria,
        descripcion: v.descripcion,
        contraparte: v.contraparte,
        cuentaDestinoId: destino ? destino.id : null,
        estado: v.estado === 'revisar' ? 'revisar' : 'confirmado'
      };
      try {
        if (existente) {
          VF.store.actualizar('movimientos', existente.id, registro);
          toast('Movimiento actualizado', 'exito');
        } else {
          VF.store.agregar('movimientos', Object.assign({ facturaId: null, cxpId: null, prestamoId: null, comisionId: null, etiquetas: [] }, registro));
          toast('Movimiento guardado', 'exito');
        }
      } catch (e) {
        toast('No se pudo guardar: ' + (e && e.message ? e.message : e), 'error');
        return false;
      }
      // Si el panel muestra otro ámbito, cambiar al del movimiento para que se vea el resultado.
      if (document.getElementById('panel-cuerpo') && ambitoActual !== 'combinado' && ambitoActual !== registro.ambito) {
        seleccionarSegmento(registro.ambito);
      }
      return true;
    }

    form.addEventListener('change', function (e) {
      var campo = e.target && e.target.getAttribute ? e.target.getAttribute('data-campo') : null;
      if (['ambito', 'tipo', 'cuentaId', 'cuentaDestinoId'].indexOf(campo) >= 0) actualizarFormulario(form, envoltura);
    });

    var api = VF.ui.modal({
      titulo: existente ? 'Editar movimiento' : 'Nuevo movimiento',
      cuerpo: envoltura,
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: existente ? 'Guardar cambios' : 'Guardar', tono: 'primario', accion: guardar }
      ]
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (guardar() !== false) api.cerrar();
    });
    actualizarFormulario(form, envoltura, valores);
    return api;
  }

  /* ---------- delegación de eventos (data-accion="panel-…") ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="panel-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    var accion = t.getAttribute('data-accion');
    var id = t.getAttribute('data-id');
    var enModal = !!t.closest('.modal');
    switch (accion) {
      case 'panel-nuevo-movimiento':
        abrirFormularioMovimiento({ ambito: ambitoActual });
        break;
      case 'panel-ver-movimiento':
        if (enModal) {
          VF.ui.cerrarModales();
          setTimeout(function () { abrirDetalleMovimiento(id); }, 60);
        } else {
          abrirDetalleMovimiento(id);
        }
        break;
      case 'panel-ver-vencimientos':
        abrirVencimientos(ambitoActual);
        break;
      case 'panel-ver-revision':
        abrirRevision(ambitoActual);
        break;
      case 'panel-ir-origen':
        irOrigen(t.getAttribute('data-coleccion'), id, t.getAttribute('data-ambito'));
        break;
      case 'panel-ir-cuenta': {
        var c = buscar(estado().cuentas, id);
        VF.router.ir(c && c.ambito === 'personal' ? 'personal' : 'empresa', { cuenta: id });
        break;
      }
      case 'panel-ir-cliente':
        VF.router.ir('cobros', { cliente: id });
        break;
      default:
        break;
    }
  });

  /* ---------- reacción a cambios del store --------------------------------- */
  VF.store.on('cambio', function () {
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(function () {
      if (!VF.store.estaDesbloqueado()) return;
      if (VF.router.actual().ruta !== 'panel') return;
      pintarCuerpo();
    }, 30);
  });

  /* ---------- registro ----------------------------------------------------- */
  VF.router.registrar('panel', { titulo: 'Panel', icono: 'panel', nav: 'principal', render: render });

  VF.panel = {
    render: render,
    ambito: function () { return ambitoActual; },
    fijarAmbito: seleccionarSegmento,
    nuevoMovimiento: abrirFormularioMovimiento,
    verMovimiento: abrirDetalleMovimiento,
    vencimientos: abrirVencimientos,
    revision: abrirRevision
  };
})(window.VF);
