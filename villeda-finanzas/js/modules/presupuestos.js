'use strict';
/*
 * js/modules/presupuestos.js — Vista Presupuestos (#/presupuestos) de VILLEDA Finanzas (docs/ARQUITECTURA.md §4).
 *
 *  - Selector segmentado Empresa | Personal (recordado en sessionStorage 'vf.presupuestos.ambito') y
 *    selector de mes (anterior / siguiente / "Mes actual"; por defecto el mes de VF.calc.hoy()).
 *    Acepta #/presupuestos?ambito=empresa|personal&periodo=YYYY-MM.
 *  - KPIs del mes (presupuesto, gasto real, diferencia, categorías excedidas) y tabla
 *    categoría / presupuesto / real / diferencia / avance con VF.ui.barraProgreso
 *    (tono 'alerta' > 90 %, 'negativo' > 100 %). Totales de VF.calc.presupuestoVsReal.
 *  - Alta en línea (categorías de gasto del ámbito que aún no tienen presupuesto), edición en línea
 *    por categoría (Enter guarda, Esc cancela), eliminación con confirmación y "Copiar del mes anterior"
 *    (nunca duplica categorías que ya existen en el mes).
 *  - Las categorías con gasto real pero sin presupuesto se listan al final ("Sin presupuesto") con un
 *    botón "Asignar" que abre la edición en línea.
 *  - Mes sin presupuestos → estado vacío con acciones (copiar del mes anterior / agregar).
 *  - Toda cifra sale de VF.calc.presupuestoVsReal; empresa y personal nunca se mezclan (principio 0.1).
 *  - Se vuelve a pintar al recibir VF.store 'cambio' únicamente si la ruta activa sigue siendo presupuestos.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="ppto-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.presupuestos] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;

  var RUTA = 'presupuestos';
  var CLAVE_AMBITO = 'vf.presupuestos.ambito';
  var NOMBRES = { empresa: 'Empresa', personal: 'Personal' };
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var UMBRAL_ALERTA = 90;     // % del presupuesto a partir del cual la barra se pinta en tono alerta
  var UMBRAL_EXCEDIDO = 100;  // % a partir del cual se pinta en tono negativo
  var RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

  var ambitoActual = leerAmbito();
  var periodoActual = null;      // 'YYYY-MM' del mes mostrado (null → mes de hoy)
  var edicion = null;            // { categoria, valor } fila en edición en línea
  var enfoquePendiente = null;   // selector a enfocar después de pintar (teclado)
  var temporizadorCambio = null;

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estado(); }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

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
  function periodoHoy() { return U.periodo(hoy()); }
  function periodoVigente() { return RE_PERIODO.test(periodoActual || '') ? periodoActual : periodoHoy(); }

  /** 'YYYY-MM' ± n meses. */
  function sumarMeses(periodo, n) {
    var p = String(periodo).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1 + (Number(n) || 0), 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }
  /** 'YYYY-MM' → 'octubre 2026'. */
  function mesLargo(periodo) {
    var p = String(periodo || '').split('-');
    return (MESES_LARGOS[Number(p[1]) - 1] || '') + ' ' + (p[0] || '');
  }
  /** Rango de fechas del periodo (para saber si hubo movimientos en el mes). */
  function rangoDe(periodo) {
    var inicio = periodo + '-01';
    return { desde: inicio, hasta: U.finMes(inicio) };
  }

  /** Registros de presupuesto del ámbito y periodo (y categoría, si se indica). Nunca cruza ámbitos. */
  function registrosDe(est, ambito, periodo, categoria) {
    return (est && est.presupuestos || []).filter(function (b) {
      return b && b.ambito === ambito && b.periodo === periodo && (categoria === undefined || b.categoria === categoria);
    });
  }
  function categoriasGasto(est, ambito) {
    var c = est && est.categorias && est.categorias[ambito];
    return (c && c.gasto || []).slice();
  }
  /** Categorías de gasto del ámbito que aún no tienen presupuesto en el periodo. */
  function categoriasDisponibles(est, ambito, periodo) {
    var usadas = {};
    registrosDe(est, ambito, periodo).forEach(function (b) { usadas[b.categoria] = true; });
    return categoriasGasto(est, ambito).filter(function (c) { return !usadas[c]; });
  }

  /** Tono de la barra: > 100 % negativo, > 90 % alerta, resto acento del ámbito. Ingresos: ≥ 100 % es bueno. */
  function tonoAvance(pct, tipo) {
    if (pct == null || isNaN(pct)) return '';
    if (tipo === 'ingreso') return pct >= UMBRAL_EXCEDIDO ? 'positivo' : '';
    if (pct > UMBRAL_EXCEDIDO) return 'negativo';
    if (pct > UMBRAL_ALERTA) return 'alerta';
    return '';
  }
  function tonoKpi(pct) {
    if (pct == null || isNaN(pct)) return 'neutro';
    if (pct > UMBRAL_EXCEDIDO) return 'negativo';
    if (pct > UMBRAL_ALERTA) return 'alerta';
    return 'positivo';
  }
  function claseDiferencia(f) {
    // diferencia = presupuesto − real. En gasto, positivo = por debajo (bien); en ingreso, negativo = superó la meta (bien).
    if (f.tipo === 'ingreso') return f.diferencia <= 0 ? 'positivo' : 'negativo';
    return f.diferencia >= 0 ? 'positivo' : 'negativo';
  }
  function pctTexto(pct) { return U.fmtNumero(pct, 0) + ' %'; }
  function enEdicion(categoria) { return !!edicion && edicion.categoria === categoria; }

  function limpiarHash() {
    if (new RegExp('^#\\/' + RUTA + '\\?').test(location.hash)) {
      try { history.replaceState(null, '', '#/' + RUTA); } catch (e) { /* file:// en algunos navegadores */ }
    }
  }

  /* ---------- render de la ruta -------------------------------------------- */
  function render(contenedor, params) {
    var p = params || {};
    if (NOMBRES[p.ambito]) {
      ambitoActual = p.ambito;
      guardarAmbito(ambitoActual);
    }
    periodoActual = RE_PERIODO.test(p.periodo || '') ? p.periodo : periodoHoy();
    edicion = null;
    enfoquePendiente = null;
    VF.ui.ambitoActivo(ambitoActual);
    contenedor.innerHTML = cabecera() + barraMes() + '<div id="ppto-cuerpo"></div>';
    pintar();
  }

  function cabecera() {
    return '<div class="vista-cabecera">' +
      '<div><h1>Presupuestos</h1>' +
      '<p class="texto-2 mb-0">Compara lo presupuestado con el gasto real por categoría. Empresa y personal se calculan por separado.</p></div>' +
      '<div class="vista-acciones">' +
      VF.ui.segmentos([
        { valor: 'empresa', texto: 'Empresa' },
        { valor: 'personal', texto: 'Personal' }
      ], ambitoActual, alCambiarAmbito) +
      '</div></div>';
  }

  function alCambiarAmbito(valor) {
    if (!NOMBRES[valor]) return;
    ambitoActual = valor;
    guardarAmbito(valor);
    VF.ui.ambitoActivo(valor);
    edicion = null;
    limpiarHash();
    pintar();
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

  function cambiarPeriodo(periodo, selectorEnfoque) {
    if (!RE_PERIODO.test(periodo || '')) return;
    periodoActual = periodo;
    edicion = null;
    enfoquePendiente = selectorEnfoque || null;
    limpiarHash();
    pintar();
  }

  /* ---------- cuerpo ------------------------------------------------------- */
  function pintar() {
    var cuerpo = document.getElementById('ppto-cuerpo');
    if (!cuerpo || !VF.store.estaDesbloqueado()) return;
    var est = estado();
    var periodo = periodoVigente();
    var res = VF.calc.presupuestoVsReal(est, ambitoActual, periodo);
    var conPpto = res.filter(function (f) { return !f.sinPresupuesto; });
    var sinPpto = res.filter(function (f) { return f.sinPresupuesto; });

    // Conservar lo que el usuario estaba escribiendo si se vuelve a pintar durante una edición.
    if (edicion) {
      var inputPrevio = cuerpo.querySelector('input[data-ppto-monto]');
      if (inputPrevio) edicion.valor = inputPrevio.value;
    }

    cuerpo.setAttribute('data-ambito', ambitoActual);
    cuerpo.setAttribute('data-periodo', periodo);
    actualizarBarraMes(est, periodo);
    var html = '';
    if (!conPpto.length) {
      html += tarjetaVacia(est, periodo, sinPpto);
    } else {
      html += kpis(res, conPpto, sinPpto, periodo);
      html += tarjetaTabla(est, res, conPpto, sinPpto, periodo);
    }
    if (sinPpto.length) html += tarjetaSinPresupuesto(sinPpto, periodo);
    cuerpo.innerHTML = html;
    enfocarTrasPintar(cuerpo);
  }

  function enfocarTrasPintar(cuerpo) {
    var objetivo = null;
    if (edicion) {
      objetivo = cuerpo.querySelector('input[data-ppto-monto]');
      if (objetivo) { objetivo.focus(); try { objetivo.select(); } catch (e) { /* sin selección */ } return; }
    }
    if (enfoquePendiente) {
      objetivo = (document.getElementById('vista') || cuerpo).querySelector(enfoquePendiente);
      enfoquePendiente = null;
      if (objetivo && typeof objetivo.focus === 'function') { try { objetivo.focus({ preventScroll: true }); } catch (e2) { objetivo.focus(); } }
    }
  }

  /* ---------- selector de mes + copiar -------------------------------------
   * Se pinta UNA vez en render() (fuera de #ppto-cuerpo): así la región aria-live anuncia el mes nuevo
   * y los botones de mes conservan el foco al navegar con teclado. pintar() sólo actualiza sus textos. */
  function barraMes() {
    return '<div class="fila-entre mb-2" id="ppto-mes">' +
      '<div class="fila" role="group" aria-label="Mes del presupuesto" style="gap:4px">' +
      '<button type="button" class="btn btn-icono" data-accion="ppto-mes-anterior" aria-label="Mes anterior" title="Mes anterior">' + VF.ui.icono('flecha-izq') + '</button>' +
      '<strong id="ppto-mes-nombre" class="centro" aria-live="polite" style="min-width:9.5em;display:inline-block"></strong>' +
      '<button type="button" class="btn btn-icono" data-accion="ppto-mes-siguiente" aria-label="Mes siguiente" title="Mes siguiente">' + VF.ui.icono('flecha') + '</button>' +
      '<button type="button" class="btn btn-fantasma btn-chico" data-accion="ppto-mes-actual" hidden>Mes actual</button>' +
      '</div>' +
      '<button type="button" class="btn btn-secundario btn-chico" data-accion="ppto-copiar">' +
      VF.ui.icono('copiar') + '<span>Copiar del mes anterior</span></button>' +
      '</div>';
  }
  function actualizarBarraMes(est, periodo) {
    var barra = document.getElementById('ppto-mes');
    if (!barra) return;
    var nombre = barra.querySelector('#ppto-mes-nombre');
    var texto = capitalizar(mesLargo(periodo));
    if (nombre && nombre.textContent !== texto) nombre.textContent = texto;
    var btnActual = barra.querySelector('[data-accion="ppto-mes-actual"]');
    if (btnActual) btnActual.hidden = periodo === periodoHoy();
    var btnCopiar = barra.querySelector('[data-accion="ppto-copiar"]');
    if (btnCopiar) {
      var anterior = sumarMeses(periodo, -1);
      var hayAnterior = registrosDe(est, ambitoActual, anterior).length > 0;
      btnCopiar.title = hayAnterior
        ? 'Copiar a ' + mesLargo(periodo) + ' los presupuestos de ' + mesLargo(anterior) + ' (' + NOMBRES[ambitoActual] + ')'
        : 'No hay presupuestos de ' + NOMBRES[ambitoActual] + ' en ' + mesLargo(anterior);
    }
  }

  /* ---------- KPIs --------------------------------------------------------- */
  function kpis(res, conPpto, sinPpto, periodo) {
    var mes = mesLargo(periodo);
    var hayReal = res.some(function (f) { return f.real > 0; });
    var pct = res.totalPresupuesto > 0 ? U.round2(res.totalReal / res.totalPresupuesto * 100) : null;
    var excedidas = conPpto.filter(function (f) { return f.tipo === 'gasto' && f.porcentaje != null && f.porcentaje > UMBRAL_EXCEDIDO; }).length;
    var enAlerta = conPpto.filter(function (f) { return f.tipo === 'gasto' && f.porcentaje != null && f.porcentaje > UMBRAL_ALERTA && f.porcentaje <= UMBRAL_EXCEDIDO; }).length;
    var html = '<div class="kpis" id="ppto-kpis">';
    html += VF.ui.kpi({
      titulo: 'Presupuesto del mes',
      valor: fmt(res.totalPresupuesto),
      sub: plural(conPpto.length, 'categoría') + ' · ' + mes,
      tono: 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Gasto real',
      valor: hayReal ? fmt(res.totalReal) : '—',
      sub: hayReal
        ? (pct != null ? pctTexto(pct) + ' del presupuesto' : '') + (sinPpto.length ? ' · incluye ' + plural(sinPpto.length, 'categoría') + ' sin presupuesto' : '')
        : 'Sin movimientos en ' + mes,
      tono: hayReal ? tonoKpi(pct) : 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Diferencia',
      valor: hayReal ? fmt(res.totalDiferencia) : '—',
      sub: hayReal ? (res.totalDiferencia >= 0 ? 'Disponible por gastar' : 'Excedido respecto al presupuesto') : 'Presupuesto − gasto real',
      tono: hayReal ? (res.totalDiferencia >= 0 ? 'positivo' : 'negativo') : 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Categorías excedidas',
      valor: String(excedidas),
      sub: excedidas ? 'Por encima del 100 % del presupuesto' : (enAlerta ? plural(enAlerta, 'categoría') + ' en alerta (> ' + UMBRAL_ALERTA + ' %)' : 'Ninguna supera su presupuesto'),
      tono: excedidas ? 'negativo' : (enAlerta ? 'alerta' : 'positivo')
    });
    return html + '</div>';
  }

  /* ---------- tabla principal --------------------------------------------- */
  function inputMonto(categoria, valor, base) {
    var v = valor == null || valor === '' ? '' : (typeof valor === 'number' ? valor.toFixed(2) : String(valor));
    return '<div class="campo ppto-campo" style="margin:0;flex:1 1 ' + (Number(base) || 140) + 'px;max-width:220px"><div class="campo-monto">' +
      '<span class="prefijo" aria-hidden="true">$</span>' +
      '<input type="text" inputmode="decimal" data-tipo="monto" data-ppto-monto data-categoria="' + esc(categoria) + '" value="' + esc(v) + '"' +
      ' placeholder="0.00" autocomplete="off" aria-label="Presupuesto mensual para ' + esc(categoria) + '"></div></div>';
  }
  function botonesEdicion(categoria) {
    return '<button type="button" class="btn btn-primario btn-chico" data-accion="ppto-guardar" data-categoria="' + esc(categoria) + '">Guardar</button>' +
      '<button type="button" class="btn btn-fantasma btn-chico" data-accion="ppto-cancelar">Cancelar</button>';
  }
  function botonesFila(categoria) {
    return '<button type="button" class="btn btn-icono" data-accion="ppto-editar" data-categoria="' + esc(categoria) + '" aria-label="Editar presupuesto de ' + esc(categoria) + '" title="Editar">' + VF.ui.icono('editar') + '</button>' +
      '<button type="button" class="btn btn-icono" data-accion="ppto-eliminar" data-categoria="' + esc(categoria) + '" aria-label="Eliminar presupuesto de ' + esc(categoria) + '" title="Eliminar">' + VF.ui.icono('eliminar') + '</button>';
  }
  function celdaAvance(f) {
    if (f.porcentaje == null) return '<span class="texto-3">—</span>';
    var tono = tonoAvance(f.porcentaje, f.tipo);
    var nota = f.tipo === 'gasto' && f.porcentaje > UMBRAL_EXCEDIDO ? ' · excedido' : (f.tipo === 'ingreso' && f.porcentaje >= UMBRAL_EXCEDIDO ? ' · meta cumplida' : '');
    return '<div style="min-width:110px;flex:1 1 auto">' + VF.ui.barraProgreso(f.porcentaje, tono) +
      '<small class="' + (tono || 'texto-2') + '" style="display:block;margin-top:4px;text-align:right">' + esc(pctTexto(f.porcentaje) + nota) + '</small></div>';
  }

  function tarjetaTabla(est, res, conPpto, sinPpto, periodo) {
    var hayReal = res.some(function (f) { return f.real > 0; });
    var pct = res.totalPresupuesto > 0 ? U.round2(res.totalReal / res.totalPresupuesto * 100) : null;
    var columnas = [
      { clave: 'categoria', titulo: 'Categoría', render: function (c, f) {
        return '<span data-ppto-categoria="' + esc(c) + '"><strong>' + esc(c) + '</strong>' +
          (f.tipo === 'ingreso' ? ' <span class="badge badge-info">Ingreso</span>' : '') + '</span>';
      } },
      { clave: 'presupuesto', titulo: 'Presupuesto', alinear: 'derecha', render: function (p, f) {
        if (enEdicion(f.categoria)) return inputMonto(f.categoria, edicion.valor != null ? edicion.valor : p);
        return '<strong class="cifra">' + esc(fmt(p)) + '</strong>';
      } },
      { clave: 'real', titulo: 'Real', alinear: 'derecha', render: function (r) {
        return r > 0 ? esc(fmt(r)) : '<span class="texto-3">Sin gasto</span>';
      } },
      { clave: 'diferencia', titulo: 'Diferencia', alinear: 'derecha', render: function (d, f) {
        return '<span class="' + claseDiferencia(f) + '">' + esc(fmt(d)) + '</span>';
      } },
      { clave: 'porcentaje', titulo: 'Avance', render: function (p, f) { return celdaAvance(f); } },
      { clave: 'acciones', titulo: '', render: function (x, f) {
        return '<div class="celda-acciones" style="margin-left:auto">' +
          (enEdicion(f.categoria) ? botonesEdicion(f.categoria) : botonesFila(f.categoria)) + '</div>';
      } }
    ];
    var filas = conPpto.map(function (f) { return Object.assign({ id: f.categoria }, f); });

    var cuerpo = '<div class="mb-2" id="ppto-avance-total">' + VF.ui.barraProgreso(pct, tonoAvance(pct, 'gasto')) +
      '<p class="texto-2 mt-1 mb-0" style="font-size:0.85rem">' +
      (hayReal
        ? esc('Gastado ' + fmt(res.totalReal) + ' de ' + fmt(res.totalPresupuesto) + (pct != null ? ' (' + pctTexto(pct) + ')' : ''))
        : esc('Sin movimientos en ' + mesLargo(periodo) + ' · presupuesto total ' + fmt(res.totalPresupuesto))) +
      '</p></div>';
    cuerpo += VF.ui.tabla({ columnas: columnas, filas: filas, vacio: 'Sin presupuestos' });
    cuerpo += '<div class="fila-entre mt-1" id="ppto-totales">' +
      '<span class="texto-2">Total <strong class="cifra" data-total="presupuesto">' + esc(fmt(res.totalPresupuesto)) + '</strong></span>' +
      '<span class="texto-2">Real <strong class="cifra" data-total="real">' + esc(hayReal ? fmt(res.totalReal) : '—') + '</strong></span>' +
      '<span class="texto-2">Diferencia <strong class="cifra ' + (res.totalDiferencia >= 0 ? 'positivo' : 'negativo') + '" data-total="diferencia">' + esc(hayReal ? fmt(res.totalDiferencia) : '—') + '</strong></span>' +
      '</div>';
    if (sinPpto.length) {
      cuerpo += '<p class="texto-3 mt-1 mb-0" style="font-size:0.8rem">El total real incluye ' + esc(plural(sinPpto.length, 'categoría')) + ' con gasto sin presupuesto (ver abajo).</p>';
    }
    cuerpo += formAlta(est, periodo);
    return VF.ui.tarjeta({
      titulo: 'Presupuesto por categoría',
      acciones: '<span class="texto-3">' + esc(plural(conPpto.length, 'categoría')) + ' · ' + esc(NOMBRES[ambitoActual]) + '</span>',
      cuerpo: cuerpo
    });
  }

  /* ---------- alta en línea ----------------------------------------------- */
  function formAlta(est, periodo) {
    var disponibles = categoriasDisponibles(est, ambitoActual, periodo);
    var html = '<h3 class="mt-2 mb-1">Agregar presupuesto</h3>';
    if (!disponibles.length) {
      return html + '<p class="texto-2 mb-0" id="ppto-alta-completo">Todas las categorías de gasto de ' + esc(NOMBRES[ambitoActual]) +
        ' ya tienen presupuesto en ' + esc(mesLargo(periodo)) + '. Edita una categoría en la tabla para ajustar su monto.</p>';
    }
    html += '<form class="filtros mb-0" data-ppto-alta novalidate autocomplete="off" aria-label="Agregar presupuesto">' +
      '<div class="campo"><label class="visually-hidden" for="ppto-alta-categoria">Categoría</label>' +
      '<select id="ppto-alta-categoria" data-ppto-alta-categoria required><option value="">Elige una categoría</option>' +
      disponibles.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="campo" style="flex:0 1 190px"><label class="visually-hidden" for="ppto-alta-monto">Monto mensual (MXN)</label>' +
      '<div class="campo-monto"><span class="prefijo" aria-hidden="true">$</span>' +
      '<input id="ppto-alta-monto" type="text" inputmode="decimal" data-tipo="monto" data-ppto-alta-monto placeholder="0.00" required></div></div>' +
      '<button type="submit" class="btn btn-primario" id="ppto-alta-agregar">' + VF.ui.icono('agregar') + '<span>Agregar</span></button>' +
      '</form>' +
      '<p class="campo-ayuda mt-1 mb-0">Monto mensual para ' + esc(mesLargo(periodo)) + ' en ' + esc(NOMBRES[ambitoActual]) + '. Las transferencias nunca cuentan como gasto.</p>';
    return html;
  }

  function enfocarFormularioAlta() {
    var sel = document.getElementById('ppto-alta-categoria');
    if (sel) sel.focus();
  }

  function marcarInvalido(input, mensaje) {
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    var campo = input.closest('.campo');
    if (campo) campo.classList.add('con-error');
    toast(mensaje, 'error');
    input.focus();
  }

  function guardarAlta(form) {
    if (!VF.store.estaDesbloqueado()) return false;
    var sel = form.querySelector('[data-ppto-alta-categoria]');
    var inp = form.querySelector('[data-ppto-alta-monto]');
    var categoria = sel ? sel.value : '';
    if (!categoria) { marcarInvalido(sel, 'Elige una categoría'); return false; }
    var monto = U.parseMonto(inp ? inp.value : '');
    if (isNaN(monto) || monto <= 0) { marcarInvalido(inp, 'Ingresa un monto mayor a cero'); return false; }
    var guardado = asignar(categoria, monto, { ambito: ambitoActual, periodo: periodoVigente() });
    if (guardado) {
      toast('Presupuesto de ' + categoria + ' guardado', 'exito');
      enfoquePendiente = '#ppto-alta-categoria';
      pintar();
    }
    return guardado;
  }

  /* ---------- edición en línea ------------------------------------------- */
  function iniciarEdicion(categoria) {
    if (!categoria) return;
    edicion = { categoria: categoria, valor: null };
    pintar();
  }
  function cancelarEdicion() {
    var cat = edicion ? edicion.categoria : null;
    edicion = null;
    enfoquePendiente = cat ? '[data-accion="ppto-editar"][data-categoria="' + cat.replace(/"/g, '\\"') + '"]' : null;
    pintar();
  }
  function guardarEdicion(categoria) {
    if (!VF.store.estaDesbloqueado()) return false;
    var cuerpo = document.getElementById('ppto-cuerpo');
    var input = cuerpo ? cuerpo.querySelector('input[data-ppto-monto]') : null;
    if (!input) return false;
    categoria = categoria || input.getAttribute('data-categoria');
    var monto = U.parseMonto(input.value);
    if (isNaN(monto) || monto <= 0) { marcarInvalido(input, 'Ingresa un monto mayor a cero'); return false; }
    var guardado = asignar(categoria, monto, { ambito: ambitoActual, periodo: periodoVigente() });
    if (guardado) {
      edicion = null;
      enfoquePendiente = '[data-accion="ppto-editar"][data-categoria="' + categoria.replace(/"/g, '\\"') + '"]';
      toast('Presupuesto de ' + categoria + ' actualizado', 'exito');
      pintar();
    }
    return guardado;
  }

  /**
   * Crea o actualiza el presupuesto de una categoría (ámbito y periodo indicados o los visibles).
   * Si hubiera registros duplicados de la misma categoría, conserva el primero y elimina el resto.
   * → true si se guardó.
   */
  function asignar(categoria, monto, opciones) {
    var o = opciones || {};
    var ambito = NOMBRES[o.ambito] ? o.ambito : ambitoActual;
    var periodo = RE_PERIODO.test(o.periodo || '') ? o.periodo : periodoVigente();
    var m = U.round2(Number(monto));
    if (!categoria || !(m > 0)) return false;
    var est = estado();
    if (!est) return false;
    var registros = registrosDe(est, ambito, periodo, categoria);
    try {
      if (registros.length) {
        VF.store.actualizar('presupuestos', registros[0].id, { monto: m });
        registros.slice(1).forEach(function (r) { VF.store.eliminar('presupuestos', r.id); });
      } else {
        VF.store.agregar('presupuestos', { ambito: ambito, periodo: periodo, categoria: categoria, monto: m });
      }
      return true;
    } catch (e) {
      toast('No se pudo guardar: ' + (e && e.message ? e.message : e), 'error');
      return false;
    }
  }

  /* ---------- eliminar ----------------------------------------------------- */
  function eliminarPresupuesto(categoria) {
    if (!categoria || !VF.store.estaDesbloqueado()) return Promise.resolve(false);
    var periodo = periodoVigente();
    var registros = registrosDe(estado(), ambitoActual, periodo, categoria);
    if (!registros.length) { toast('Ese presupuesto ya no existe.', 'alerta'); pintar(); return Promise.resolve(false); }
    return VF.ui.confirmar(
      '¿Eliminar el presupuesto de «' + categoria + '» de ' + mesLargo(periodo) + ' (' + NOMBRES[ambitoActual] + ')? El gasto real de la categoría no se modifica.',
      { peligro: true, titulo: 'Eliminar presupuesto', textoAceptar: 'Eliminar' }
    ).then(function (ok) {
      if (!ok) return false;
      try {
        registros.forEach(function (r) { VF.store.eliminar('presupuestos', r.id); });
        toast('Presupuesto de ' + categoria + ' eliminado', 'exito');
        if (edicion && edicion.categoria === categoria) edicion = null;
        pintar();
        return true;
      } catch (e) {
        toast('No se pudo eliminar: ' + (e && e.message ? e.message : e), 'error');
        return false;
      }
    });
  }

  /* ---------- copiar del mes anterior ------------------------------------- */
  /** Copia al mes visible los presupuestos del mes anterior cuyas categorías aún no existen. → Promise<número copiado>. */
  function copiarMesAnterior() {
    if (!VF.store.estaDesbloqueado()) return Promise.resolve(0);
    var est = estado();
    var periodo = periodoVigente();
    var anterior = sumarMeses(periodo, -1);
    var previos = registrosDe(est, ambitoActual, anterior);
    if (!previos.length) {
      toast('No hay presupuestos de ' + NOMBRES[ambitoActual] + ' en ' + mesLargo(anterior) + '.', 'alerta');
      return Promise.resolve(0);
    }
    var existentes = {};
    registrosDe(est, ambitoActual, periodo).forEach(function (b) { existentes[b.categoria] = true; });
    var porCategoria = {};
    var orden = [];
    previos.forEach(function (b) {
      if (existentes[b.categoria]) return;
      if (porCategoria[b.categoria] === undefined) orden.push(b.categoria);
      porCategoria[b.categoria] = U.round2((porCategoria[b.categoria] || 0) + (Number(b.monto) || 0));
    });
    var nuevas = orden.filter(function (c) { return porCategoria[c] > 0; });
    if (!nuevas.length) {
      toast('Nada que copiar: las categorías de ' + mesLargo(anterior) + ' ya tienen presupuesto en ' + mesLargo(periodo) + '.', 'info');
      return Promise.resolve(0);
    }
    var total = U.suma(nuevas, function (c) { return porCategoria[c]; });
    return VF.ui.confirmar(
      'Se copiarán ' + plural(nuevas.length, 'presupuesto') + ' de ' + mesLargo(anterior) + ' a ' + mesLargo(periodo) +
      ' (' + NOMBRES[ambitoActual] + ', ' + fmt(total) + ' en total). Las categorías que ya tienen presupuesto este mes se conservan.',
      { titulo: 'Copiar del mes anterior', textoAceptar: 'Copiar' }
    ).then(function (ok) {
      if (!ok) return 0;
      var copiados = 0;
      try {
        nuevas.forEach(function (c) {
          VF.store.agregar('presupuestos', { ambito: ambitoActual, periodo: periodo, categoria: c, monto: porCategoria[c] });
          copiados += 1;
        });
        toast(plural(copiados, 'presupuesto copiado', 'presupuestos copiados') + ' de ' + mesLargo(anterior), 'exito');
      } catch (e) {
        toast('No se pudo copiar: ' + (e && e.message ? e.message : e), 'error');
      }
      pintar();
      return copiados;
    });
  }

  /* ---------- estado vacío ------------------------------------------------ */
  function tarjetaVacia(est, periodo, sinPpto) {
    var anterior = sumarMeses(periodo, -1);
    var hayAnterior = registrosDe(est, ambitoActual, anterior).length > 0;
    var mensaje = 'Sin presupuestos en ' + mesLargo(periodo) + ' para ' + NOMBRES[ambitoActual] + '.';
    if (sinPpto.length) mensaje += ' Hay gasto real en ' + plural(sinPpto.length, 'categoría') + ' sin presupuesto; puedes asignárselo abajo.';
    mensaje += hayAnterior
      ? ' Copia los presupuestos de ' + mesLargo(anterior) + ' o agrega categorías una por una.'
      : ' Agrega tu primera categoría para empezar a comparar presupuesto y gasto real.';
    var vacio = hayAnterior
      ? VF.ui.vacio(mensaje, 'Copiar del mes anterior', function () { copiarMesAnterior(); })
      : VF.ui.vacio(mensaje, 'Agregar presupuesto', function () { enfocarFormularioAlta(); });
    return VF.ui.tarjeta({
      titulo: 'Presupuesto por categoría',
      acciones: '<span class="texto-3">' + esc(NOMBRES[ambitoActual]) + '</span>',
      cuerpo: '<div id="ppto-vacio">' + vacio + '</div>' + formAlta(est, periodo)
    });
  }

  /* ---------- categorías con gasto real pero sin presupuesto -------------- */
  function tarjetaSinPresupuesto(sinPpto, periodo) {
    var total = U.suma(sinPpto, function (f) { return f.real; });
    var items = sinPpto.map(function (f) {
      var editando = enEdicion(f.categoria);
      return '<li class="lista-item envolver" data-ppto-sin="' + esc(f.categoria) + '">' +
        '<span class="lista-icono">' + VF.ui.icono('gasto') + '</span>' +
        '<div class="lista-texto"><p class="lista-titulo">' + esc(f.categoria) + '</p>' +
        '<p class="lista-sub">Gasto real en ' + esc(mesLargo(periodo)) + '</p></div>' +
        '<span class="lista-valor negativo">' + esc(fmt(f.real)) + '</span>' +
        (editando
          ? '<div class="fila" style="flex:1 1 100%;justify-content:flex-end">' + inputMonto(f.categoria, edicion.valor, 120) +
            '<span class="celda-acciones" style="flex:none">' + botonesEdicion(f.categoria) + '</span></div>'
          : '<button type="button" class="btn btn-secundario btn-chico" data-accion="ppto-asignar" data-categoria="' + esc(f.categoria) + '" aria-label="Asignar presupuesto a ' + esc(f.categoria) + '">Asignar</button>') +
        '</li>';
    }).join('');
    return VF.ui.tarjeta({
      titulo: 'Sin presupuesto',
      acciones: '<span class="badge badge-alerta">' + esc(plural(sinPpto.length, 'categoría')) + '</span>',
      clase: 'ppto-sin-presupuesto',
      cuerpo: '<p class="texto-2">Categorías de ' + esc(NOMBRES[ambitoActual]) + ' con gasto real en ' + esc(mesLargo(periodo)) +
        ' que aún no tienen presupuesto. Asígnales uno para que cuenten en el seguimiento.</p>' +
        '<ul class="lista" id="ppto-sin-presupuesto">' + items + '</ul>' +
        '<div class="fila-entre mt-1"><span class="texto-2">Gasto sin presupuesto</span><strong class="cifra negativo" data-total="sin-presupuesto">' + esc(fmt(total)) + '</strong></div>'
    });
  }

  /* ---------- delegación de eventos (data-accion="ppto-…") ----------------- */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="ppto-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    var accion = t.getAttribute('data-accion');
    var categoria = t.getAttribute('data-categoria');
    switch (accion) {
      case 'ppto-mes-anterior':
        cambiarPeriodo(sumarMeses(periodoVigente(), -1));
        break;
      case 'ppto-mes-siguiente':
        cambiarPeriodo(sumarMeses(periodoVigente(), 1));
        break;
      case 'ppto-mes-actual':
        // El botón se oculta al volver al mes actual: el foco pasa a "Mes anterior".
        cambiarPeriodo(periodoHoy(), '#ppto-mes [data-accion="ppto-mes-anterior"]');
        break;
      case 'ppto-copiar':
        copiarMesAnterior();
        break;
      case 'ppto-editar':
      case 'ppto-asignar':
        iniciarEdicion(categoria);
        break;
      case 'ppto-guardar':
        guardarEdicion(categoria);
        break;
      case 'ppto-cancelar':
        cancelarEdicion();
        break;
      case 'ppto-eliminar':
        eliminarPresupuesto(categoria);
        break;
      default:
        break;
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target && e.target.matches && e.target.matches('form[data-ppto-alta]') ? e.target : null;
    if (!form) return;
    e.preventDefault();
    guardarAlta(form);
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('input[data-ppto-monto]')) return;
    if (e.key === 'Enter') { e.preventDefault(); guardarEdicion(t.getAttribute('data-categoria')); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelarEdicion(); }
  });

  /* ---------- reacción a cambios del store --------------------------------- */
  VF.store.on('cambio', function () {
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(function () {
      if (!VF.store.estaDesbloqueado()) return;
      if (VF.router.actual().ruta !== RUTA) return;
      pintar();
    }, 30);
  });
  VF.store.on('bloqueado', function () { edicion = null; periodoActual = null; });

  /* ---------- registro ----------------------------------------------------- */
  VF.router.registrar(RUTA, { titulo: 'Presupuestos', icono: 'presupuestos', nav: 'mas', render: render });

  VF.presupuestos = {
    render: render,
    ambito: function () { return ambitoActual; },
    periodo: function () { return periodoVigente(); },
    fijarAmbito: seleccionarSegmento,
    fijarPeriodo: function (p) { cambiarPeriodo(p); },
    asignar: asignar,
    copiarMesAnterior: copiarMesAnterior
  };
})(window.VF);
