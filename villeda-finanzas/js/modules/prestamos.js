'use strict';
/*
 * js/modules/prestamos.js — Vista Préstamos (#/prestamos) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  - Selector segmentado Empresa | Personal (se recuerda en sessionStorage 'vf.prestamos.ambito' y puede
 *    fijarse con #/prestamos?ambito=…). Al pintar y al cambiar de segmento llama a VF.ui.ambitoActivo.
 *  - Lista por ámbito con saldo insoluto (VF.calc.saldoPrestamo), próximo pago (VF.calc.proximoPagoPrestamo),
 *    barra de progreso (capital pagado / principal) y etiqueta clara del tipo: "Debo" (recibido) o
 *    "Me deben" (otorgado). Resumen del ámbito: Debo, Me deben, mensualidad y próximo vencimiento.
 *  - CRUD en modal (contraparte, tipo, principal, tasa anual, plazo, fecha de inicio, día de pago, notas)
 *    con el pago mensual calculado en vivo (VF.calc.pagoMensual) e intereses totales (VF.calc.tablaAmortizacion).
 *  - Detalle con tabla de amortización (VF.calc.tablaAmortizacion) marcando los pagos ya realizados y el próximo,
 *    pagos registrados (con su cuenta y movimiento) y acciones Registrar pago / Editar / Eliminar.
 *  - "Registrar pago": monto (por defecto el próximo pago = pago mensual, o lo que liquida si es el último),
 *    fecha y cuenta del MISMO ámbito. interés = round2(saldo × tasa/100/12); capital = pago − interés; si el pago
 *    liquida, capital = saldo e interés = pago − capital (nunca negativo). Crea el movimiento vinculado
 *    (gasto 'Préstamos' si recibido; ingreso 'Otros ingresos' si otorgado) con prestamoId. Eliminar un pago
 *    revierte su movimiento. El estado pasa a 'liquidado' automáticamente cuando el saldo llega a 0.
 *  - Toda cifra sale de VF.calc; sin préstamos en el ámbito → VF.ui.vacio (nunca ceros falsos).
 *  - Se vuelve a pintar al recibir VF.store 'cambio' únicamente si la ruta activa sigue siendo prestamos.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="prestamos-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.prestamos] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;
  var r2 = U.round2;

  var CLAVE_AMBITO = 'vf.prestamos.ambito';
  var NOMBRES = { empresa: 'Empresa', personal: 'Personal' };
  var TIPOS = {
    recibido: { corto: 'Debo', largo: 'Recibido · yo debo', badge: 'negativo', tono: 'negativo', verbo: 'Pago', verboLargo: 'Pago de préstamo' },
    otorgado: { corto: 'Me deben', largo: 'Otorgado · me deben', badge: 'positivo', tono: 'positivo', verbo: 'Cobro', verboLargo: 'Cobro de préstamo' }
  };
  var ESTADOS = {
    activo: { texto: 'Activo', badge: 'info' },
    liquidado: { texto: 'Liquidado', badge: 'positivo' },
    cancelado: { texto: 'Cancelado', badge: 'neutro' }
  };
  var CATEGORIA_PAGO = { recibido: 'Préstamos', otorgado: 'Otros ingresos' };
  var TIPO_MOVIMIENTO = { recibido: 'gasto', otorgado: 'ingreso' };
  var TIPO_CUENTA = { cheques: 'Cheques', ahorro: 'Ahorro', credito: 'Tarjeta de crédito', efectivo: 'Efectivo', inversion: 'Inversión', billetera: 'Billetera digital' };

  var ambitoActual = leerAmbito();
  var temporizadorCambio = null;
  var detalleAbierto = null;   // { id, api } del modal de detalle abierto (para refrescarlo al cambiar el store)

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estaDesbloqueado() ? VF.store.estado() : null; }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }
  function esAmbito(a) { return a === 'empresa' || a === 'personal'; }

  function capitalizar(s) {
    s = String(s == null ? '' : s);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function plural(n, singular, pluralTexto) {
    return n + ' ' + (n === 1 ? singular : (pluralTexto || singular + 's'));
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
  function cuentasDe(est, ambito, soloActivas) {
    return (est.cuentas || []).filter(function (c) {
      return c && c.ambito === ambito && (!soloActivas || c.activa !== false);
    });
  }
  function nombreCuenta(est, id) {
    var c = buscar(est.cuentas, id);
    return c ? c.nombre : 'Cuenta eliminada';
  }
  function prestamosDe(est, ambito) {
    return (est.prestamos || []).filter(function (p) { return p && p.ambito === ambito; });
  }
  function infoTipo(p) { return TIPOS[p && p.tipo] || TIPOS.recibido; }
  function infoEstado(p) { return ESTADOS[p && p.estado] || ESTADOS.activo; }
  function badge(texto, clase) { return '<span class="badge badge-' + esc(clase) + '">' + esc(texto) + '</span>'; }
  function fechaConRelativa(iso) {
    var rel = VF.ui.fechaRelativa(iso);
    return U.fmtFecha(iso) + (rel ? ' (' + rel + ')' : '');
  }
  function filaCifra(etiqueta, valorHtml) {
    return '<div class="fila-entre mb-1"><span class="texto-2">' + esc(etiqueta) + '</span><span class="derecha">' + valorHtml + '</span></div>';
  }
  function entero(n) {
    var x = Math.floor(Number(n));
    return isFinite(x) ? x : 0;
  }
  function enteroValido(n, min, max) {
    var x = Number(n);
    return isFinite(x) && x === Math.floor(x) && x >= min && x <= max;
  }
  function fmtTasa(t) {
    var x = Number(t) || 0;
    return U.fmtNumero(x, x === Math.floor(x) ? 0 : 2) + ' % anual';
  }
  /** Agrupa dos campos consecutivos del formulario en una .form-fila (2 columnas ≥ 560 px). */
  function agruparCampos(form, nombres) {
    var conts = nombres.map(function (n) { return form.querySelector('[data-campo-cont="' + n + '"]'); }).filter(Boolean);
    if (conts.length < 2) return;
    var fila = document.createElement('div');
    fila.className = 'form-fila';
    conts[0].parentNode.insertBefore(fila, conts[0]);
    conts.forEach(function (c) { fila.appendChild(c); });
  }

  /* ---------- cálculo (sobre VF.calc) -------------------------------------- */
  /** Cifras derivadas de un préstamo: saldo, pagado, porcentaje, pago mensual, próximo pago, conteos. */
  function resumen(p) {
    var principal = r2(Number(p.principal) || 0);
    var saldo = VF.calc.saldoPrestamo(p);
    var pagado = r2(principal - saldo);
    var pct = principal > 0 ? Math.max(0, Math.min(100, r2(pagado / principal * 100))) : 0;
    var pagos = p.pagos || [];
    return {
      principal: principal,
      saldo: saldo,
      pagado: pagado,
      porcentaje: pct,
      pagoMensual: VF.calc.pagoMensual(p),
      proximo: VF.calc.proximoPagoPrestamo(p, hoy()),
      nPagos: pagos.length,
      plazo: Math.max(1, entero(p.plazoMeses) || 1),
      interesesPagados: U.suma(pagos, function (x) { return Number(x.interes) || 0; }),
      liquidado: saldo <= 0
    };
  }

  /**
   * Divide un pago en interés y capital sobre el saldo REAL del préstamo:
   *   interés = round2(saldo × tasa/100/12); capital = pago − interés.
   *   Si el pago liquida (capital ≥ saldo): capital = saldo e interés = pago − capital (nunca negativo).
   *   Si el pago no cubre el interés del periodo: capital = 0 e interés = pago.
   * Devuelve { pago, interes, capital, interesPeriodo, saldoAntes, saldoDespues, liquida, cubreInteres, maximo }.
   */
  function dividirPago(p, monto) {
    var saldoAntes = VF.calc.saldoPrestamo(p);
    var pago = r2(Number(monto) || 0);
    var interesPeriodo = r2(saldoAntes * (Number(p.tasaAnual) || 0) / 100 / 12);
    var interes = interesPeriodo;
    var capital = r2(pago - interes);
    if (capital >= saldoAntes) {
      capital = saldoAntes;
      interes = r2(pago - capital);
    }
    if (interes < 0) interes = 0;
    if (capital < 0) { capital = 0; interes = pago; }
    var saldoDespues = r2(saldoAntes - capital);
    return {
      pago: pago, interes: interes, capital: capital, interesPeriodo: interesPeriodo,
      saldoAntes: saldoAntes, saldoDespues: saldoDespues,
      liquida: saldoDespues <= 0,
      cubreInteres: pago >= interesPeriodo,
      maximo: r2(saldoAntes + interesPeriodo)
    };
  }

  /* ---------- operaciones sobre el store ----------------------------------- */
  /**
   * Registra un pago: { monto, fecha, cuentaId }. Crea el movimiento vinculado (gasto 'Préstamos' si el
   * préstamo es recibido; ingreso 'Otros ingresos' si es otorgado) en una cuenta del MISMO ámbito y
   * marca el préstamo como 'liquidado' si el saldo queda en 0. → { pago, movimiento, liquidado }.
   * Lanza Error con código: PRESTAMO_NO_EXISTE, PRESTAMO_NO_ACTIVO, CUENTA_INVALIDA, CUENTA_DE_OTRO_AMBITO,
   * MONTO_INVALIDO, MONTO_EXCEDE_SALDO, FECHA_INVALIDA.
   */
  function registrarPago(prestamoId, datos) {
    var d = datos || {};
    var p = VF.store.obtener('prestamos', prestamoId);
    if (!p) throw new Error('PRESTAMO_NO_EXISTE');
    if (p.estado !== 'activo') throw new Error('PRESTAMO_NO_ACTIVO');
    var cuenta = VF.store.obtener('cuentas', d.cuentaId);
    if (!cuenta) throw new Error('CUENTA_INVALIDA');
    if (cuenta.ambito !== p.ambito) throw new Error('CUENTA_DE_OTRO_AMBITO');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || ''))) throw new Error('FECHA_INVALIDA');
    var div = dividirPago(p, d.monto);
    if (!(div.pago > 0)) throw new Error('MONTO_INVALIDO');
    if (div.pago > div.maximo + 0.005) throw new Error('MONTO_EXCEDE_SALDO');

    var t = infoTipo(p);
    var n = (p.pagos || []).length + 1;
    var plazo = Math.max(1, entero(p.plazoMeses) || 1);
    var movimiento = VF.store.agregar('movimientos', {
      ambito: p.ambito,
      cuentaId: cuenta.id,
      tipo: TIPO_MOVIMIENTO[p.tipo] || 'gasto',
      monto: div.pago,
      fecha: d.fecha,
      categoria: CATEGORIA_PAGO[p.tipo] || 'Préstamos',
      descripcion: t.verboLargo + ' — pago ' + n + ' de ' + plazo + (p.contraparte ? ' · ' + p.contraparte : ''),
      contraparte: p.contraparte || '',
      cuentaDestinoId: null,
      facturaId: null,
      cxpId: null,
      prestamoId: p.id,
      comisionId: null,
      estado: 'confirmado',
      etiquetas: []
    });
    var pago = {
      id: U.uid('pago'),
      fecha: d.fecha,
      monto: div.pago,
      capital: div.capital,
      interes: div.interes,
      movimientoId: movimiento.id,
      cuentaId: cuenta.id
    };
    var pagos = (p.pagos || []).concat([pago]);
    var cambios = { pagos: pagos };
    if (VF.calc.saldoPrestamo({ principal: p.principal, pagos: pagos }) <= 0) cambios.estado = 'liquidado';
    try {
      VF.store.actualizar('prestamos', p.id, cambios);
    } catch (e) {
      try { VF.store.eliminar('movimientos', movimiento.id); } catch (e2) { /* ya revertido */ }
      throw e;
    }
    return { pago: pago, movimiento: movimiento, liquidado: cambios.estado === 'liquidado' };
  }

  /** Elimina un pago y su movimiento vinculado; si el préstamo estaba 'liquidado' y vuelve a tener saldo, pasa a 'activo'. → bool */
  function eliminarPago(prestamoId, pagoId) {
    var p = VF.store.obtener('prestamos', prestamoId);
    if (!p) return false;
    var pago = buscar(p.pagos, pagoId);
    if (!pago) return false;
    var pagos = (p.pagos || []).filter(function (x) { return x.id !== pagoId; });
    var cambios = { pagos: pagos };
    if (p.estado === 'liquidado' && VF.calc.saldoPrestamo({ principal: p.principal, pagos: pagos }) > 0) cambios.estado = 'activo';
    VF.store.actualizar('prestamos', p.id, cambios);
    if (pago.movimientoId && VF.store.obtener('movimientos', pago.movimientoId)) {
      VF.store.eliminar('movimientos', pago.movimientoId);
    }
    return true;
  }

  /* ---------- render de la ruta -------------------------------------------- */
  function render(contenedor, params) {
    var p = params || {};
    var est = estado();
    var abrirId = null;
    if (p.id && est) {
      var pr = buscar(est.prestamos, p.id);
      if (pr) {
        abrirId = pr.id;
        if (NOMBRES[pr.ambito]) ambitoActual = pr.ambito;
      }
    }
    if (NOMBRES[p.ambito]) ambitoActual = p.ambito;
    guardarAmbito(ambitoActual);
    VF.ui.ambitoActivo(ambitoActual);
    contenedor.innerHTML = cabecera() + '<div id="prestamos-cuerpo"></div>';
    pintarCuerpo();
    if (p.id && !abrirId) toast('El préstamo indicado ya no existe.', 'alerta');
    if (abrirId) {
      setTimeout(function () {
        if (VF.router.actual().ruta !== 'prestamos' || !VF.store.estaDesbloqueado()) return;
        abrirDetalle(abrirId);
      }, 40);
    }
    limpiarHash();
  }

  /** Quita los parámetros del hash (#/prestamos?id=…) para que recargar no vuelva a abrir el detalle. */
  function limpiarHash() {
    if (/^#\/prestamos\?/.test(location.hash)) {
      try { history.replaceState(null, '', '#/prestamos'); } catch (e) { /* file:// en algunos navegadores */ }
    }
  }

  function cabecera() {
    return '<div class="vista-cabecera">' +
      '<div><h1>Préstamos</h1><p class="texto-2 mb-0">Recibidos (debo) y otorgados (me deben), siempre por ámbito.</p></div>' +
      '<div class="vista-acciones">' +
      VF.ui.segmentos([{ valor: 'empresa', texto: 'Empresa' }, { valor: 'personal', texto: 'Personal' }], ambitoActual, alCambiarAmbito) +
      '<button type="button" class="btn btn-primario" data-accion="prestamos-nuevo">' + VF.ui.icono('agregar') + '<span>Préstamo</span></button>' +
      '</div></div>';
  }

  function alCambiarAmbito(valor) {
    if (!NOMBRES[valor]) return;
    ambitoActual = valor;
    guardarAmbito(valor);
    VF.ui.ambitoActivo(valor);
    limpiarHash();
    pintarCuerpo();
  }

  /** Cambia el segmento activo (aria-selected) y vuelve a pintar. */
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
    var cuerpo = document.getElementById('prestamos-cuerpo');
    var est = estado();
    if (!cuerpo || !est) return;
    cuerpo.setAttribute('data-ambito', ambitoActual);
    cuerpo.innerHTML = cuerpoAmbito(est, ambitoActual);
  }

  /* ---------- cuerpo de un ámbito ------------------------------------------ */
  function cuerpoAmbito(est, ambito) {
    var lista = prestamosDe(est, ambito);
    if (!lista.length) {
      return '<div class="tarjeta">' + VF.ui.vacio(
        'Sin préstamos en ' + NOMBRES[ambito].toLowerCase() + '. Registra un préstamo recibido (debo) u otorgado (me deben) para seguir su saldo y sus pagos.',
        'Registrar préstamo',
        function () { abrirFormulario({ ambito: ambito }); }
      ) + '</div>';
    }
    var activos = lista.filter(function (p) { return p.estado === 'activo'; });
    var otros = lista.filter(function (p) { return p.estado !== 'activo'; });
    activos.sort(ordenPorProximo);
    otros = U.ordenar(otros, 'actualizado', 'desc');

    var html = resumenAmbito(est, ambito, activos);
    html += VF.ui.tarjeta({
      titulo: 'Activos',
      acciones: '<span class="badge badge-info">' + esc(plural(activos.length, 'préstamo')) + '</span>',
      cuerpo: activos.length
        ? '<ul class="lista" id="prestamos-activos">' + activos.map(function (p) { return itemPrestamo(est, p); }).join('') + '</ul>'
        : '<p class="texto-2 mb-0">Sin préstamos activos en ' + esc(NOMBRES[ambito].toLowerCase()) + '.</p>'
    });
    if (otros.length) {
      html += VF.ui.tarjeta({
        titulo: 'Liquidados y cancelados',
        acciones: '<span class="badge badge-neutro">' + esc(plural(otros.length, 'préstamo')) + '</span>',
        cuerpo: '<ul class="lista" id="prestamos-cerrados">' + otros.map(function (p) { return itemPrestamo(est, p); }).join('') + '</ul>'
      });
    }
    return html;
  }

  function ordenPorProximo(a, b) {
    var pa = VF.calc.proximoPagoPrestamo(a, hoy());
    var pb = VF.calc.proximoPagoPrestamo(b, hoy());
    if (pa && pb && pa.fecha !== pb.fecha) return pa.fecha < pb.fecha ? -1 : 1;
    if (!!pa !== !!pb) return pa ? -1 : 1;
    return String(a.contraparte || '').localeCompare(String(b.contraparte || ''), 'es-MX');
  }

  /** KPIs del ámbito: Debo, Me deben, mensualidad (debo) y próximo vencimiento. Sólo con préstamos activos. */
  function resumenAmbito(est, ambito, activos) {
    if (!activos.length) return '';
    var recibidos = activos.filter(function (p) { return p.tipo === 'recibido'; });
    var otorgados = activos.filter(function (p) { return p.tipo === 'otorgado'; });
    var debo = U.suma(recibidos, function (p) { return VF.calc.saldoPrestamo(p); });
    var meDeben = U.suma(otorgados, function (p) { return VF.calc.saldoPrestamo(p); });
    var mensualidad = U.suma(recibidos, function (p) { return VF.calc.pagoMensual(p); });
    var proximo = null;
    activos.forEach(function (p) {
      var prox = VF.calc.proximoPagoPrestamo(p, hoy());
      if (prox && (!proximo || prox.fecha < proximo.prox.fecha)) proximo = { prox: prox, prestamo: p };
    });
    var html = '<div class="kpis" id="prestamos-kpis">';
    html += VF.ui.kpi({
      titulo: 'Debo',
      valor: recibidos.length ? fmt(debo) : '—',
      sub: recibidos.length ? 'Saldo insoluto de ' + plural(recibidos.length, 'préstamo recibido', 'préstamos recibidos') : 'Sin préstamos recibidos activos',
      tono: recibidos.length && debo > 0 ? 'negativo' : 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Me deben',
      valor: otorgados.length ? fmt(meDeben) : '—',
      sub: otorgados.length ? 'Por cobrar de ' + plural(otorgados.length, 'préstamo otorgado', 'préstamos otorgados') : 'Sin préstamos otorgados activos',
      tono: otorgados.length && meDeben > 0 ? 'positivo' : 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Mensualidad (debo)',
      valor: recibidos.length ? fmt(mensualidad) : '—',
      sub: recibidos.length ? 'Suma de los pagos mensuales de lo recibido' : 'Sin préstamos recibidos activos',
      tono: 'neutro'
    });
    if (proximo) {
      var tp = infoTipo(proximo.prestamo);
      html += VF.ui.kpi({
        titulo: 'Próximo vencimiento',
        valor: fmt(proximo.prox.monto),
        sub: tp.verbo + ' · ' + (proximo.prestamo.contraparte || '') + ' · ' + capitalizar(VF.ui.fechaRelativa(proximo.prox.fecha)) + (proximo.prox.vencido ? ' (vencido)' : ''),
        tono: proximo.prox.vencido ? 'alerta' : (proximo.prestamo.tipo === 'otorgado' ? 'positivo' : 'neutro')
      });
    } else {
      html += VF.ui.kpi({ titulo: 'Próximo vencimiento', valor: '—', sub: 'Sin pagos pendientes', tono: 'neutro' });
    }
    return html + '</div>';
  }

  function itemPrestamo(est, p) {
    var r = resumen(p);
    var t = infoTipo(p);
    var e = infoEstado(p);
    var activo = p.estado === 'activo';
    var partes = [fmt(r.principal) + ' a ' + plural(r.plazo, 'mes', 'meses'), Number(p.tasaAnual) > 0 ? fmtTasa(p.tasaAnual) : 'sin intereses'];
    var detalle;
    if (!activo) detalle = e.texto + (p.estado === 'liquidado' ? ' · ' + plural(r.nPagos, 'pago registrado', 'pagos registrados') : '');
    else if (r.proximo) detalle = (p.tipo === 'otorgado' ? 'Próximo cobro ' : 'Próximo pago ') + fmt(r.proximo.monto) + ' el ' + fechaConRelativa(r.proximo.fecha);
    else detalle = 'Sin pagos pendientes';
    return '<li class="lista-item clicable" role="button" tabindex="0" style="align-items:flex-start" data-accion="prestamos-ver" data-id="' + esc(p.id) + '" aria-label="Ver detalle del préstamo ' + esc(p.contraparte || '') + '">' +
      '<span class="lista-icono">' + VF.ui.icono('prestamos') + '</span>' +
      '<div class="lista-texto">' +
      '<div class="fila-entre" style="flex-wrap:nowrap;gap:8px"><p class="lista-titulo" style="flex:1 1 auto;min-width:0">' + esc(p.contraparte || 'Préstamo') + '</p>' +
      '<strong class="cifra ' + (activo ? t.tono : 'texto-2') + '" style="white-space:nowrap" data-saldo>' + esc(fmt(r.saldo)) + '</strong></div>' +
      '<p class="lista-sub" style="white-space:normal">' + badge(t.corto, t.badge) + ' ' + (activo ? '' : badge(e.texto, e.badge) + ' ') + esc(partes.join(' · ')) + '</p>' +
      '<div class="mt-1 mb-1">' + VF.ui.barraProgreso(r.porcentaje, p.tipo === 'otorgado' ? 'positivo' : undefined) + '</div>' +
      '<p class="lista-sub" style="white-space:normal">' + esc('Pagado ' + fmt(r.pagado) + ' de ' + fmt(r.principal) + ' (' + U.fmtNumero(r.porcentaje, 0) + ' %) · ' + r.nPagos + ' de ' + r.plazo + ' pagos') + '</p>' +
      '<p class="lista-sub mb-0" style="white-space:normal">' + (activo && r.proximo && r.proximo.vencido ? badge('Vencido', 'negativo') + ' ' : '') + esc(detalle) + '</p>' +
      (activo ? '<div class="fila mt-1"><button type="button" class="btn btn-secundario btn-chico" data-accion="prestamos-pagar" data-id="' + esc(p.id) + '">' + VF.ui.icono('pago') + '<span>Registrar ' + (p.tipo === 'otorgado' ? 'cobro' : 'pago') + '</span></button>' +
        '<button type="button" class="btn btn-fantasma btn-chico" data-accion="prestamos-ver" data-id="' + esc(p.id) + '">Detalle</button></div>' : '') +
      '</div></li>';
  }

  /* ---------- modal: detalle ---------------------------------------------- */
  function cuerpoDetalle(est, p) {
    var r = resumen(p);
    var t = infoTipo(p);
    var e = infoEstado(p);
    var activo = p.estado === 'activo';
    var diaPago = Number(p.diaPago);
    if (!(diaPago >= 1 && diaPago <= 31)) diaPago = U.parseFecha(p.fechaInicio).getDate();

    var html = '<p class="kpi-titulo mb-0">Saldo insoluto</p>' +
      '<p class="hero-cifra cifra mb-0 ' + (activo ? t.tono : 'texto-2') + '" data-detalle-saldo>' + esc(fmt(r.saldo)) + '</p>' +
      '<p class="fila mb-2">' + badge(t.corto, t.badge) + VF.ui.badgeAmbito(p.ambito) + badge(e.texto, e.badge) + '</p>' +
      '<div class="mb-1">' + VF.ui.barraProgreso(r.porcentaje, p.tipo === 'otorgado' ? 'positivo' : undefined) + '</div>' +
      '<p class="texto-2 mb-2">' + esc('Pagado ' + fmt(r.pagado) + ' de ' + fmt(r.principal) + ' (' + U.fmtNumero(r.porcentaje, 0) + ' %) · ' + r.nPagos + ' de ' + r.plazo + ' pagos') + '</p>';

    var filas = [
      ['Contraparte', esc(p.contraparte || '—')],
      ['Tipo', esc(t.largo)],
      ['Principal', esc(fmt(r.principal))],
      ['Tasa', esc(Number(p.tasaAnual) > 0 ? fmtTasa(p.tasaAnual) : 'Sin intereses (0 %)')],
      ['Plazo', esc(plural(r.plazo, 'mes', 'meses'))],
      ['Pago mensual', '<strong class="cifra">' + esc(fmt(r.pagoMensual)) + '</strong>'],
      ['Fecha de inicio', esc(U.fmtFecha(p.fechaInicio))],
      ['Día de pago', esc('Día ' + diaPago + ' de cada mes')],
      ['Intereses pagados', esc(fmt(r.interesesPagados))]
    ];
    if (activo) {
      filas.push(['Próximo ' + (p.tipo === 'otorgado' ? 'cobro' : 'pago'), r.proximo
        ? '<strong class="cifra">' + esc(fmt(r.proximo.monto)) + '</strong> <span class="' + (r.proximo.vencido ? 'negativo' : 'texto-2') + '">' + esc(capitalizar(fechaConRelativa(r.proximo.fecha))) + (r.proximo.vencido ? ' · vencido' : '') + '</span>'
        : '<span class="texto-2">Sin pagos pendientes</span>']);
    }
    html += filas.map(function (f) { return filaCifra(f[0], f[1]); }).join('');
    if (p.notas) html += '<p class="texto-2 mb-0">Notas</p><p class="mb-1" style="white-space:pre-line;overflow-wrap:anywhere">' + esc(p.notas) + '</p>';

    html += '<div class="fila mt-2 mb-2">' +
      (activo && r.saldo > 0 ? '<button type="button" class="btn btn-primario" data-accion="prestamos-pagar" data-id="' + esc(p.id) + '">' + VF.ui.icono('pago') + '<span>Registrar ' + (p.tipo === 'otorgado' ? 'cobro' : 'pago') + '</span></button>' : '') +
      '<button type="button" class="btn btn-secundario" data-accion="prestamos-editar" data-id="' + esc(p.id) + '">' + VF.ui.icono('editar') + '<span>Editar</span></button>' +
      '<button type="button" class="btn btn-fantasma negativo" data-accion="prestamos-eliminar" data-id="' + esc(p.id) + '">' + VF.ui.icono('eliminar') + '<span>Eliminar</span></button>' +
      '</div>';

    html += '<h3 class="mt-2">Pagos registrados</h3>' + tablaPagos(est, p);
    html += '<details class="mt-2" data-seccion="amortizacion"><summary class="texto-2" style="cursor:pointer;min-height:36px;display:flex;align-items:center">Tabla de amortización (' + esc(plural(r.plazo, 'pago')) + ')</summary>' +
      tablaAmortizacion(p, r) + '</details>';
    return html;
  }

  function tablaPagos(est, p) {
    var pagos = (p.pagos || []).slice();
    if (!pagos.length) return '<p class="texto-2 mb-0">Sin pagos registrados.</p>';
    pagos.sort(function (a, b) { return a.fecha === b.fecha ? 0 : (a.fecha < b.fecha ? -1 : 1); });
    var filas = pagos.map(function (x, i) {
      var mov = x.movimientoId ? buscar(est.movimientos, x.movimientoId) : null;
      var cuentaId = x.cuentaId || (mov ? mov.cuentaId : null);
      return { id: x.id, n: i + 1, fecha: x.fecha, monto: x.monto, capital: x.capital, interes: x.interes, cuenta: cuentaId ? nombreCuenta(est, cuentaId) : '—', sinMovimiento: !mov };
    });
    // Cuatro columnas para que quepa en el modal (560 px) sin desplazamiento horizontal:
    // N.º + fecha (con la cuenta debajo), monto, capital / interés (dos líneas) y la acción de eliminar.
    return VF.ui.tabla({
      columnas: [
        { clave: 'fecha', titulo: 'Pago', render: function (f, fila) {
          // Un solo hijo en la celda: en móvil la celda es flex y varios hijos se repartirían (y truncarían) el ancho.
          return '<span><strong>' + fila.n + '</strong> · <span style="white-space:nowrap">' + esc(U.fmtFecha(f)) + '</span><br><small class="texto-2">' + esc(fila.cuenta) + '</small>' +
            (fila.sinMovimiento ? ' <span class="badge badge-alerta">Sin movimiento</span>' : '') + '</span>';
        } },
        { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: function (v) { return '<strong>' + esc(fmt(v)) + '</strong>'; } },
        { clave: 'capital', titulo: 'Capital / interés', alinear: 'derecha', render: function (v, fila) {
          return esc(fmt(v)) + '<br><small class="texto-2" data-interes>' + esc(fmt(fila.interes)) + '</small>';
        } },
        { clave: 'id', titulo: '', alinear: 'derecha', render: function (id, fila) {
          // margin-left:auto → en móvil (celda flex sin título) el botón queda a la derecha, como en escritorio.
          return '<span style="display:inline-block;margin-left:auto"><button type="button" class="btn btn-icono" data-accion="prestamos-eliminar-pago" data-id="' + esc(p.id) + '" data-pago="' + esc(id) + '" aria-label="Eliminar pago ' + fila.n + '" title="Eliminar pago">' + VF.ui.icono('eliminar') + '</button></span>';
        } }
      ],
      filas: filas,
      vacio: 'Sin pagos registrados'
    }) + '<p class="texto-3 mb-0">Eliminar un pago también elimina su movimiento y recalcula el saldo.</p>';
  }

  /** Tabla de amortización teórica (VF.calc.tablaAmortizacion) marcando pagados, próximo y pendientes. */
  function tablaAmortizacion(p, r) {
    var tabla = VF.calc.tablaAmortizacion(p);
    var h = hoy();
    var filas = tabla.map(function (f) {
      var estadoFila = f.n <= r.nPagos ? 'pagado' : (p.estado === 'activo' && f.n === r.nPagos + 1 ? (f.fecha < h ? 'vencido' : 'proximo') : 'pendiente');
      return { id: 'n' + f.n, n: f.n, fecha: f.fecha, pago: f.pago, capital: f.capital, interes: f.interes, saldo: f.saldo, estadoFila: estadoFila };
    });
    var total = U.suma(tabla, function (f) { return f.pago; });
    var intereses = U.suma(tabla, function (f) { return f.interes; });
    function celda(v, fila) {
      return '<span class="' + (fila.estadoFila === 'pagado' ? 'texto-2' : '') + '">' + esc(fmt(v)) + '</span>';
    }
    function badgeEstado(s) {
      if (s === 'pagado') return badge('Pagado', 'positivo');
      if (s === 'proximo') return badge('Próximo', 'info');
      if (s === 'vencido') return badge('Vencido', 'negativo');
      return '<span class="texto-3">Pendiente</span>';
    }
    // Cinco columnas (el estado va bajo la fecha y capital / interés comparten celda) para caber en 560 px.
    return '<p class="texto-2 mt-1">' + esc('Total a pagar ' + fmt(total) + ' · intereses ' + fmt(intereses) + '. Las filas reflejan el plan teórico; los pagos reales pueden variar.') + '</p>' +
      VF.ui.tabla({
        columnas: [
          { clave: 'n', titulo: 'N.º', alinear: 'centro' },
          { clave: 'fecha', titulo: 'Fecha', render: function (f, fila) {
            return '<span class="' + (fila.estadoFila === 'pagado' ? 'texto-2' : '') + '" style="white-space:nowrap">' + esc(U.fmtFecha(f)) + '</span><br>' + badgeEstado(fila.estadoFila);
          } },
          { clave: 'pago', titulo: 'Pago', alinear: 'derecha', render: celda },
          { clave: 'capital', titulo: 'Capital / interés', alinear: 'derecha', render: function (v, fila) {
            return celda(v, fila) + '<br><small class="texto-2" data-interes>' + esc(fmt(fila.interes)) + '</small>';
          } },
          { clave: 'saldo', titulo: 'Saldo', alinear: 'derecha', render: celda }
        ],
        filas: filas,
        vacio: 'Sin filas'
      });
  }

  /** Abre (o reutiliza) el modal de detalle de un préstamo. Devuelve la api del modal o null. */
  function abrirDetalle(id) {
    var est = estado();
    if (!est) return null;
    var p = buscar(est.prestamos, id);
    if (!p) { toast('El préstamo ya no existe.', 'alerta'); return null; }
    if (detalleAbierto && detalleAbierto.id === id && document.contains(detalleAbierto.api.elemento)) {
      refrescarDetalle();
      return detalleAbierto.api;
    }
    if (detalleAbierto) detalleAbierto.api.cerrar();
    var api = VF.ui.modal({
      titulo: 'Préstamo',
      cuerpo: cuerpoDetalle(est, p),
      botones: [{ texto: 'Cerrar', tono: 'secundario' }],
      alCerrar: function () { if (detalleAbierto && detalleAbierto.api === api) detalleAbierto = null; }
    });
    api.elemento.setAttribute('data-prestamo', p.id);
    detalleAbierto = { id: p.id, api: api };
    return api;
  }

  /** Vuelve a pintar el cuerpo del detalle abierto (tras un pago, edición o eliminación). */
  function refrescarDetalle() {
    if (!detalleAbierto) return;
    var api = detalleAbierto.api;
    if (!document.contains(api.elemento)) { detalleAbierto = null; return; }
    var est = estado();
    if (!est) { api.cerrar(); return; }
    var p = buscar(est.prestamos, detalleAbierto.id);
    if (!p) { api.cerrar(); return; }
    var cuerpo = api.elemento.querySelector('.modal-cuerpo');
    if (!cuerpo) return;
    var abierto = cuerpo.querySelector('details[data-seccion="amortizacion"]');
    var estabaAbierto = !!(abierto && abierto.open);
    cuerpo.innerHTML = cuerpoDetalle(est, p);
    var det = cuerpo.querySelector('details[data-seccion="amortizacion"]');
    if (det && estabaAbierto) det.open = true;
  }

  /* ---------- modal: registrar pago --------------------------------------- */
  function abrirPago(id) {
    var est = estado();
    if (!est) return null;
    var p = buscar(est.prestamos, id);
    if (!p) { toast('El préstamo ya no existe.', 'alerta'); return null; }
    if (p.estado !== 'activo') { toast('Este préstamo no está activo; cámbialo a “Activo” para registrar pagos.', 'alerta'); return null; }
    var r = resumen(p);
    if (r.saldo <= 0) { toast('Este préstamo ya no tiene saldo pendiente.', 'info'); return null; }
    var t = infoTipo(p);
    var cuentas = cuentasDe(est, p.ambito, true);
    var montoDefecto = r.proximo ? r.proximo.monto : r.pagoMensual;
    var n = r.nPagos + 1;
    var esCobro = p.tipo === 'otorgado';

    var campos = [
      { nombre: 'monto', etiqueta: 'Monto (MXN)', tipo: 'monto', requerido: true, min: 0.01, placeholder: '0.00',
        ayuda: 'Pago mensual ' + fmt(r.pagoMensual) + (r.proximo && r.proximo.monto !== r.pagoMensual ? ' · para liquidar ' + fmt(r.proximo.monto) : '') },
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', requerido: true },
      { nombre: 'cuentaId', etiqueta: (esCobro ? 'Cuenta que recibe' : 'Cuenta de pago') + ' · ' + NOMBRES[p.ambito], tipo: 'select', requerido: true, placeholder: 'Elige una cuenta',
        opciones: cuentas.map(function (c) {
          return { valor: c.id, texto: c.nombre + (c.banco ? ' · ' + c.banco : '') + ' (' + fmt(VF.calc.saldoCuenta(est, c.id)) + ')' };
        }),
        ayuda: 'Sólo cuentas de ' + NOMBRES[p.ambito].toLowerCase() + ': el movimiento se registra en el mismo ámbito del préstamo.' }
    ];
    var valores = { monto: montoDefecto, fecha: hoy(), cuentaId: cuentas.length === 1 ? cuentas[0].id : '' };

    var envoltura = VF.ui.el('<div>' +
      '<p class="mb-2"><strong>' + esc(p.contraparte || 'Préstamo') + '</strong> ' + badge(t.corto, t.badge) + ' ' + VF.ui.badgeAmbito(p.ambito) + '<br>' +
      '<span class="texto-2">' + esc(t.verbo + ' ' + n + ' de ' + r.plazo + ' · saldo insoluto ' + fmt(r.saldo) + ' · interés del periodo ' + fmt(dividirPago(p, montoDefecto).interesPeriodo)) + '</span></p>' +
      (!cuentas.length ? '<p class="aviso aviso-alerta">No hay cuentas activas en ' + esc(NOMBRES[p.ambito]) + '. <a href="#/' + esc(p.ambito) + '">Crea una cuenta en ' + esc(NOMBRES[p.ambito]) + '</a> para registrar el ' + (esCobro ? 'cobro' : 'pago') + '.</p>' : '') +
      VF.ui.formulario(campos, valores) +
      '<div class="tarjeta mb-0" style="padding:12px 14px;box-shadow:none" data-desglose aria-live="polite"></div>' +
      '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['monto', 'fecha']);
    var desglose = envoltura.querySelector('[data-desglose]');

    function pintarDesglose() {
      var v = VF.ui.leerFormulario(form);
      if (isNaN(v.monto) || !(v.monto > 0)) {
        desglose.innerHTML = '<p class="texto-2 mb-0">Escribe el monto para ver cómo se divide entre interés y capital.</p>';
        return;
      }
      var d = dividirPago(p, v.monto);
      var excede = d.pago > d.maximo + 0.005;
      desglose.innerHTML = '<p class="kpi-titulo">Desglose del ' + (esCobro ? 'cobro' : 'pago') + '</p>' +
        filaCifra('Interés', '<strong class="cifra">' + esc(fmt(d.interes)) + '</strong>') +
        filaCifra('Capital', '<strong class="cifra">' + esc(fmt(d.capital)) + '</strong>') +
        filaCifra('Saldo después', '<strong class="cifra ' + (d.liquida ? 'positivo' : '') + '">' + esc(fmt(Math.max(0, d.saldoDespues))) + '</strong>') +
        (excede ? '<p class="aviso aviso-error mt-1 mb-0">El monto supera lo necesario para liquidar (' + esc(fmt(d.maximo)) + ').</p>'
          : d.liquida ? '<p class="aviso aviso-exito mt-1 mb-0">Este ' + (esCobro ? 'cobro' : 'pago') + ' liquida el préstamo: pasará a “Liquidado”.</p>'
            : !d.cubreInteres ? '<p class="aviso aviso-alerta mt-1 mb-0">El monto no cubre el interés del periodo (' + esc(fmt(d.interesPeriodo)) + '): no abona a capital.</p>' : '');
    }
    form.addEventListener('input', pintarDesglose);
    form.addEventListener('change', pintarDesglose);
    pintarDesglose();

    var reglas = {
      monto: function (x) {
        if (!(x > 0)) return 'Ingresa un monto mayor a cero';
        var d = dividirPago(p, x);
        if (d.pago > d.maximo + 0.005) return 'El máximo para liquidar es ' + fmt(d.maximo);
        return null;
      },
      cuentaId: function (x) {
        if (!x) return 'Elige una cuenta de ' + NOMBRES[p.ambito].toLowerCase();
        var c = buscar(estado().cuentas, x);
        if (!c || c.ambito !== p.ambito) return 'La cuenta debe ser de ' + NOMBRES[p.ambito].toLowerCase();
        return null;
      }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      try {
        var res = registrarPago(p.id, { monto: v.monto, fecha: v.fecha, cuentaId: v.cuentaId });
        toast(res.liquidado ? '¡Préstamo liquidado! Pago registrado.' : (esCobro ? 'Cobro registrado' : 'Pago registrado'), 'exito');
        return true;
      } catch (e) {
        toast('No se pudo registrar: ' + mensajeError(e), 'error');
        return false;
      }
    }

    var api = VF.ui.modal({
      titulo: (esCobro ? 'Registrar cobro' : 'Registrar pago'),
      cuerpo: envoltura,
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: esCobro ? 'Registrar cobro' : 'Registrar pago', tono: 'primario', accion: guardar }
      ]
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (guardar() !== false) api.cerrar();
    });
    return api;
  }

  function mensajeError(e) {
    var codigo = e && e.message ? e.message : String(e);
    var textos = {
      PRESTAMO_NO_EXISTE: 'el préstamo ya no existe',
      PRESTAMO_NO_ACTIVO: 'el préstamo no está activo',
      CUENTA_INVALIDA: 'la cuenta ya no existe',
      CUENTA_DE_OTRO_AMBITO: 'la cuenta es de otro ámbito',
      MONTO_INVALIDO: 'el monto no es válido',
      MONTO_EXCEDE_SALDO: 'el monto supera el saldo pendiente',
      FECHA_INVALIDA: 'la fecha no es válida',
      BLOQUEADO: 'la aplicación está bloqueada'
    };
    return textos[codigo] || codigo;
  }

  /* ---------- modal: alta / edición ---------------------------------------- */
  function abrirFormulario(opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est) return null;
    var existente = o.id ? buscar(est.prestamos, o.id) : null;
    if (o.id && !existente) { toast('El préstamo ya no existe.', 'alerta'); return null; }
    var conPagos = !!(existente && existente.pagos && existente.pagos.length);
    var capitalPagado = existente ? r2(U.suma(existente.pagos || [], function (x) { return Number(x.capital) || 0; })) : 0;
    var ambito = existente ? existente.ambito : (esAmbito(o.ambito) ? o.ambito : ambitoActual);

    var valores = existente ? {
      ambito: ambito, tipo: existente.tipo, contraparte: existente.contraparte || '', principal: existente.principal,
      tasaAnual: existente.tasaAnual, plazoMeses: existente.plazoMeses, fechaInicio: existente.fechaInicio,
      diaPago: existente.diaPago != null && existente.diaPago !== '' ? existente.diaPago : '', estado: existente.estado || 'activo', notas: existente.notas || ''
    } : {
      ambito: ambito, tipo: o.tipo === 'otorgado' ? 'otorgado' : 'recibido', contraparte: '', principal: '', tasaAnual: '', plazoMeses: '',
      fechaInicio: hoy(), diaPago: '', estado: 'activo', notas: ''
    };

    var campos = [
      { nombre: 'ambito', etiqueta: 'Ámbito', tipo: 'select', requerido: true, deshabilitado: conPagos,
        opciones: [{ valor: 'empresa', texto: 'Empresa' }, { valor: 'personal', texto: 'Personal' }],
        ayuda: conPagos ? 'No se puede cambiar: ya tiene pagos registrados en cuentas de este ámbito.' : 'Empresa y personal nunca se mezclan.' },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, deshabilitado: conPagos,
        opciones: [{ valor: 'recibido', texto: 'Recibido — yo debo' }, { valor: 'otorgado', texto: 'Otorgado — me deben' }],
        ayuda: conPagos ? 'No se puede cambiar: los pagos ya generaron movimientos.' : undefined },
      { nombre: 'contraparte', etiqueta: 'Contraparte', tipo: 'texto', requerido: true, maxlength: 100, placeholder: 'Banco, financiera o persona', autofoco: true },
      { nombre: 'principal', etiqueta: 'Principal (MXN)', tipo: 'monto', requerido: true, min: 0.01, placeholder: '0.00',
        ayuda: conPagos ? 'Capital ya pagado: ' + fmt(capitalPagado) + '. El principal no puede ser menor.' : undefined },
      { nombre: 'tasaAnual', etiqueta: 'Tasa anual (%)', tipo: 'numero', requerido: true, min: 0, max: 500, paso: 0.01, placeholder: '0', ayuda: 'Porcentaje anual. Escribe 0 si no genera intereses.' },
      { nombre: 'plazoMeses', etiqueta: 'Plazo (meses)', tipo: 'numero', requerido: true, min: 1, max: 600, paso: 1, placeholder: '12' },
      { nombre: 'fechaInicio', etiqueta: 'Fecha de inicio', tipo: 'fecha', requerido: true, ayuda: 'El primer pago es un mes después.' },
      { nombre: 'diaPago', etiqueta: 'Día de pago', tipo: 'numero', min: 1, max: 31, paso: 1, placeholder: 'Igual al de inicio', ayuda: 'Del 1 al 31. Vacío = el día de la fecha de inicio.' }
    ];
    if (existente) {
      campos.push({ nombre: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true,
        opciones: [{ valor: 'activo', texto: 'Activo' }, { valor: 'liquidado', texto: 'Liquidado' }, { valor: 'cancelado', texto: 'Cancelado' }],
        ayuda: 'Se marca “Liquidado” automáticamente cuando el saldo llega a cero.' });
    }
    campos.push({ nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2, placeholder: 'Destino del dinero, condiciones, referencias…' });

    var envoltura = VF.ui.el('<div>' + VF.ui.formulario(campos, valores) +
      '<div class="kpis mb-0" data-resumen-pago aria-live="polite"></div>' +
      (conPagos ? '<p class="aviso aviso-alerta mt-2 mb-0">Este préstamo tiene ' + esc(plural(existente.pagos.length, 'pago registrado', 'pagos registrados')) + '. Al cambiar principal, tasa o plazo, los pagos conservan su capital e interés y el saldo se recalcula.</p>' : '') +
      '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['ambito', 'tipo']);
    agruparCampos(form, ['principal', 'tasaAnual']);
    agruparCampos(form, ['plazoMeses', 'fechaInicio']);
    if (existente) agruparCampos(form, ['diaPago', 'estado']);
    var resumenEl = envoltura.querySelector('[data-resumen-pago]');

    /** Pago mensual e intereses totales en vivo (VF.calc.pagoMensual / tablaAmortizacion). */
    function pintarResumen() {
      var v = VF.ui.leerFormulario(form);
      var principal = v.principal;
      var tasa = v.tasaAnual;
      var plazo = v.plazoMeses;
      var listo = !isNaN(principal) && principal > 0 && tasa != null && !isNaN(tasa) && tasa >= 0 && plazo != null && enteroValido(plazo, 1, 600);
      if (!listo) {
        resumenEl.innerHTML = VF.ui.kpi({ titulo: 'Pago mensual estimado', valor: '—', sub: 'Captura principal, tasa y plazo', tono: 'neutro' }) +
          VF.ui.kpi({ titulo: 'Intereses totales', valor: '—', sub: 'Amortización francesa', tono: 'neutro' });
        return;
      }
      var simulado = { principal: r2(principal), tasaAnual: tasa, plazoMeses: plazo, fechaInicio: v.fechaInicio || hoy(), diaPago: v.diaPago };
      var pago = VF.calc.pagoMensual(simulado);
      var tabla = VF.calc.tablaAmortizacion(simulado);
      var intereses = U.suma(tabla, function (f) { return f.interes; });
      var total = U.suma(tabla, function (f) { return f.pago; });
      resumenEl.innerHTML = VF.ui.kpi({ titulo: 'Pago mensual estimado', valor: fmt(pago), sub: plural(plazo, 'pago') + ' · total ' + fmt(total), tono: 'neutro' }) +
        VF.ui.kpi({ titulo: 'Intereses totales', valor: fmt(intereses), sub: tasa > 0 ? fmtTasa(tasa) : 'Sin intereses', tono: 'neutro' });
    }
    form.addEventListener('input', pintarResumen);
    form.addEventListener('change', pintarResumen);
    pintarResumen();

    var reglas = {
      contraparte: function (x) { return x ? null : 'Escribe quién presta o a quién se le presta'; },
      principal: function (x) {
        if (!(x > 0)) return 'Ingresa un principal mayor a cero';
        if (conPagos && r2(x) < capitalPagado) return 'No puede ser menor al capital ya pagado (' + fmt(capitalPagado) + ')';
        return null;
      },
      tasaAnual: function (x) { return x == null || isNaN(x) || x < 0 ? 'Ingresa una tasa de 0 o mayor' : null; },
      plazoMeses: function (x) { return enteroValido(x, 1, 600) ? null : 'Ingresa un plazo entero entre 1 y 600 meses'; },
      diaPago: function (x) { return x == null || x === '' || enteroValido(x, 1, 31) ? null : 'Ingresa un día entre 1 y 31'; }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var ambitoFinal = existente && conPagos ? existente.ambito : (esAmbito(v.ambito) ? v.ambito : ambito);
      var tipoFinal = existente && conPagos ? existente.tipo : (TIPOS[v.tipo] ? v.tipo : 'recibido');
      var diaPago = v.diaPago == null || v.diaPago === '' ? U.parseFecha(v.fechaInicio).getDate() : entero(v.diaPago);
      var registro = {
        ambito: ambitoFinal,
        tipo: tipoFinal,
        contraparte: v.contraparte,
        principal: r2(v.principal),
        tasaAnual: r2(v.tasaAnual),
        plazoMeses: entero(v.plazoMeses),
        fechaInicio: v.fechaInicio,
        diaPago: diaPago,
        notas: v.notas || ''
      };
      try {
        if (existente) {
          var estadoNuevo = ESTADOS[v.estado] ? v.estado : (existente.estado || 'activo');
          var saldoNuevo = VF.calc.saldoPrestamo({ principal: registro.principal, pagos: existente.pagos || [] });
          if (saldoNuevo <= 0 && estadoNuevo === 'activo') estadoNuevo = 'liquidado';
          registro.estado = estadoNuevo;
          VF.store.actualizar('prestamos', existente.id, registro);
          toast('Préstamo actualizado', 'exito');
        } else {
          registro.estado = 'activo';
          registro.pagos = [];
          VF.store.agregar('prestamos', registro);
          toast('Préstamo guardado', 'exito');
        }
      } catch (e) {
        toast('No se pudo guardar: ' + mensajeError(e), 'error');
        return false;
      }
      if (document.getElementById('prestamos-cuerpo') && ambitoActual !== registro.ambito) seleccionarSegmento(registro.ambito);
      return true;
    }

    var api = VF.ui.modal({
      titulo: existente ? 'Editar préstamo' : 'Nuevo préstamo',
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
    return api;
  }

  /* ---------- eliminar préstamo / pago ------------------------------------- */
  function eliminarPrestamo(id) {
    var est = estado();
    if (!est) return Promise.resolve(false);
    var p = buscar(est.prestamos, id);
    if (!p) { toast('El préstamo ya no existe.', 'alerta'); return Promise.resolve(false); }
    var nMovs = (est.movimientos || []).filter(function (m) { return m && m.prestamoId === p.id; }).length;
    var mensaje = '¿Eliminar el préstamo de ' + (p.contraparte || 'esta contraparte') + '?' +
      (nMovs ? ' También se eliminarán sus ' + plural(nMovs, 'movimiento vinculado', 'movimientos vinculados') + ' y los saldos de las cuentas se recalcularán.' : '') +
      ' Esta acción no se puede deshacer.';
    return VF.ui.confirmar(mensaje, { peligro: true, titulo: 'Eliminar préstamo', textoAceptar: 'Eliminar' }).then(function (ok) {
      if (!ok) return false;
      try {
        VF.store.eliminar('prestamos', p.id);
        if (detalleAbierto && detalleAbierto.id === p.id) detalleAbierto.api.cerrar();
        toast('Préstamo eliminado', 'exito');
        return true;
      } catch (e) {
        toast('No se pudo eliminar: ' + mensajeError(e), 'error');
        return false;
      }
    });
  }

  function confirmarEliminarPago(prestamoId, pagoId) {
    var est = estado();
    if (!est) return Promise.resolve(false);
    var p = buscar(est.prestamos, prestamoId);
    var pago = p ? buscar(p.pagos, pagoId) : null;
    if (!pago) { toast('El pago ya no existe.', 'alerta'); return Promise.resolve(false); }
    var mensaje = '¿Eliminar el pago de ' + fmt(pago.monto) + ' del ' + U.fmtFecha(pago.fecha) + '? Se eliminará también su movimiento y el saldo del préstamo volverá a ' + fmt(r2(VF.calc.saldoPrestamo(p) + (Number(pago.capital) || 0))) + '.';
    return VF.ui.confirmar(mensaje, { peligro: true, titulo: 'Eliminar pago', textoAceptar: 'Eliminar' }).then(function (ok) {
      if (!ok) return false;
      try {
        var hecho = eliminarPago(prestamoId, pagoId);
        toast(hecho ? 'Pago eliminado y movimiento revertido' : 'El pago ya no existe', hecho ? 'exito' : 'alerta');
        return hecho;
      } catch (e) {
        toast('No se pudo eliminar: ' + mensajeError(e), 'error');
        return false;
      }
    });
  }

  /* ---------- delegación de eventos (data-accion="prestamos-…") ------------- */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="prestamos-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    var id = t.getAttribute('data-id');
    switch (t.getAttribute('data-accion')) {
      case 'prestamos-nuevo':
        abrirFormulario({ ambito: ambitoActual });
        break;
      case 'prestamos-ver':
        abrirDetalle(id);
        break;
      case 'prestamos-pagar':
        abrirPago(id);
        break;
      case 'prestamos-editar':
        abrirFormulario({ id: id });
        break;
      case 'prestamos-eliminar':
        eliminarPrestamo(id);
        break;
      case 'prestamos-eliminar-pago':
        confirmarEliminarPago(id, t.getAttribute('data-pago'));
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
      if (VF.router.actual().ruta !== 'prestamos') return;
      pintarCuerpo();
      refrescarDetalle();
    }, 30);
  });
  VF.store.on('bloqueado', function () { detalleAbierto = null; });

  /* ---------- registro ----------------------------------------------------- */
  VF.router.registrar('prestamos', { titulo: 'Préstamos', icono: 'prestamos', nav: 'mas', render: render });

  VF.prestamos = {
    render: render,
    ambito: function () { return ambitoActual; },
    fijarAmbito: seleccionarSegmento,
    nuevo: abrirFormulario,
    ver: abrirDetalle,
    pagar: abrirPago,
    registrarPago: registrarPago,
    eliminarPago: eliminarPago,
    dividirPago: dividirPago
  };
})(window.VF);
