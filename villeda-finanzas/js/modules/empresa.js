'use strict';
/*
 * js/modules/empresa.js — Vista Empresa (#/empresa) y componente reutilizable VF.vistas.ambito
 * (docs/ARQUITECTURA.md §4 y sección "Extensiones").
 *
 *  VF.vistas.ambito(contenedor, ambito, { extras, params }) pinta la vista de UN ámbito:
 *    1. Cuentas: tarjetas con saldo (VF.calc.saldoCuenta); tarjetas de crédito muestran deuda, límite,
 *       uso y días de corte/pago. Crear / editar / archivar / restaurar / eliminar (sin movimientos) con
 *       modal + VF.ui.formulario. Resumen líquido / tarjetas / total (VF.calc.saldosPorAmbito).
 *    2. Movimientos: filtros (periodo rápido Hoy / Semana / Mes / Personalizado, tipo, cuenta, categoría,
 *       búsqueda), tabla responsiva (VF.ui.tabla; columnas compactas en < 720 px), alta rápida
 *       "+ Ingreso", "+ Gasto", "+ Transferencia", detalle, editar, eliminar, marcar por revisar /
 *       confirmar, paginación "Mostrar más". Las cifras salen de VF.calc.movimientosEn.
 *    3. Gastos por categoría: VF.ui.graficaDona sobre VF.calc.gastosPorCategoria del periodo filtrado.
 *    4. Extras del módulo que lo usa: [{ id, titulo, acciones?, render(el, ctx) }] en tarjetas propias.
 *  Formulario de movimiento: cuenta sólo del ámbito; categorías según ámbito y tipo; una transferencia a
 *  una cuenta del otro ámbito muestra el aviso y se guarda con categoría 'Retiro de socio'
 *  (empresa → personal) o 'Aportación de capital' (personal → empresa); entre cuentas del mismo ámbito
 *  usa 'Transferencia entre cuentas'. El ámbito del movimiento es SIEMPRE el de la cuenta origen.
 *  La vista se vuelve a pintar al recibir VF.store 'cambio' sólo si su ruta sigue activa y su raíz
 *  sigue en el documento. Los filtros se recuerdan por ámbito mientras la app esté abierta.
 *
 *  Empresa registra #/empresa con extras: Facturas / Cuentas por cobrar (VF.calc.porCobrar), Proveedores /
 *  Cuentas por pagar (VF.calc.porPagar) y Comisiones (VF.calc.comisionesPendientes).
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="ambito-…" / "empresa-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.vistas.ambito] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;

  var NOMBRES = { empresa: 'Empresa', personal: 'Personal' };
  var TIPO_TEXTO = { ingreso: 'Ingreso', gasto: 'Gasto', transferencia: 'Transferencia' };
  var TIPO_CUENTA = { cheques: 'Cheques', ahorro: 'Ahorro', credito: 'Tarjeta de crédito', efectivo: 'Efectivo', inversion: 'Inversión', billetera: 'Billetera digital' };
  var TIPOS_CUENTA = ['cheques', 'ahorro', 'credito', 'efectivo', 'inversion', 'billetera'];
  var COLORES = [
    { valor: '#1D4ED8', texto: 'Azul' }, { valor: '#047857', texto: 'Verde' }, { valor: '#B91C1C', texto: 'Rojo' },
    { valor: '#B45309', texto: 'Ámbar' }, { valor: '#7C3AED', texto: 'Morado' }, { valor: '#0F766E', texto: 'Verde azulado' },
    { valor: '#DB2777', texto: 'Rosa' }, { valor: '#DC2626', texto: 'Rojo intenso' }, { valor: '#475569', texto: 'Gris' }
  ];
  var PERIODOS = [
    { valor: 'hoy', texto: 'Hoy' }, { valor: 'semana', texto: 'Semana' },
    { valor: 'mes', texto: 'Mes' }, { valor: 'personalizado', texto: 'Personalizado' }
  ];
  var CATEGORIA_TRANSFERENCIA = 'Transferencia entre cuentas';
  var POR_PAGINA = 20;
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* Filtros de movimientos por ámbito (se conservan mientras la app esté abierta). */
  var filtrosPorAmbito = {};
  /* Instancia pintada actualmente: { ruta, ambito, contenedor, raiz, opciones }. */
  var instancia = null;
  var temporizadorCambio = null;
  var mqMovil = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 719px)') : null;

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estaDesbloqueado() ? VF.store.estado() : null; }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo); }
  function esAmbito(a) { return a === 'empresa' || a === 'personal'; }
  function otroAmbito(a) { return a === 'empresa' ? 'personal' : 'empresa'; }

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
  function cuentaConMovimientos(est, id) {
    return (est.movimientos || []).some(function (m) { return m && (m.cuentaId === id || m.cuentaDestinoId === id); });
  }
  function colorValido(c) {
    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '';
  }
  function signo(tipo, monto) {
    if (tipo === 'ingreso') return '+' + fmt(monto);
    if (tipo === 'gasto') return '−' + fmt(monto);
    return fmt(monto);
  }
  function tonoTipo(tipo) {
    return tipo === 'ingreso' ? 'positivo' : tipo === 'gasto' ? 'negativo' : 'texto-2';
  }
  function vinculoDe(m) {
    if (!m) return '';
    return m.facturaId ? 'una factura (Facturas y cobros)'
      : m.cxpId ? 'una cuenta por pagar (Proveedores)'
        : m.prestamoId ? 'un préstamo (Préstamos)'
          : m.comisionId ? 'una comisión (Proveedores)' : '';
  }
  function filaCifra(etiqueta, valor, clase) {
    return '<div class="fila-entre mb-1"><span class="texto-2">' + esc(etiqueta) + '</span>' +
      '<strong class="cifra ' + esc(clase || '') + '">' + esc(valor) + '</strong></div>';
  }
  /** Atributos de una acción delegada: data-accion + data-ambito (+ data-id). */
  function accion(nombre, ambito, id) {
    return 'data-accion="' + esc(nombre) + '" data-ambito="' + esc(ambito) + '"' + (id != null ? ' data-id="' + esc(id) + '"' : '');
  }
  function btnIcono(nombre, icono, ambito, id, etiqueta, deshabilitado, titulo) {
    return '<button type="button" class="btn btn-icono" ' + accion(nombre, ambito, id) +
      ' aria-label="' + esc(etiqueta) + '" title="' + esc(titulo || etiqueta) + '"' + (deshabilitado ? ' disabled' : '') + '>' +
      VF.ui.icono(icono) + '</button>';
  }
  function filtrosDe(ambito) {
    if (!filtrosPorAmbito[ambito]) {
      filtrosPorAmbito[ambito] = { periodo: 'mes', desde: '', hasta: '', tipo: '', cuentaId: '', categoria: '', busqueda: '', pagina: 1 };
    }
    return filtrosPorAmbito[ambito];
  }
  function esMovil() { return !!(mqMovil && mqMovil.matches); }

  /** Rango de fechas del periodo rápido elegido: { desde, hasta, etiqueta }. */
  function rangoDe(f) {
    var h = hoy();
    if (f.periodo === 'hoy') return { desde: h, hasta: h, etiqueta: 'Hoy · ' + U.fmtFecha(h) };
    if (f.periodo === 'semana') {
      var ini = U.inicioSemana(h);
      var fin = U.sumarDias(ini, 6);
      return { desde: ini, hasta: fin, etiqueta: 'Semana del ' + U.fmtFecha(ini) + ' al ' + U.fmtFecha(fin) };
    }
    if (f.periodo === 'personalizado') {
      var desde = /^\d{4}-\d{2}-\d{2}$/.test(f.desde) ? f.desde : U.sumarDias(h, -30);
      var hasta = /^\d{4}-\d{2}-\d{2}$/.test(f.hasta) ? f.hasta : h;
      if (desde > hasta) { var t = desde; desde = hasta; hasta = t; }
      return { desde: desde, hasta: hasta, etiqueta: 'Del ' + U.fmtFecha(desde) + ' al ' + U.fmtFecha(hasta) };
    }
    return { desde: U.inicioMes(h), hasta: U.finMes(h), etiqueta: capitalizar(mesLargo(U.periodo(h))) };
  }

  /** Movimientos del ámbito filtrados: VF.calc.movimientosEn + búsqueda de texto local. */
  function movimientosFiltrados(est, ambito, f, r) {
    var filtros = {};
    if (f.tipo && TIPO_TEXTO[f.tipo]) filtros.tipo = f.tipo;
    if (f.categoria) filtros.categoria = f.categoria;
    if (f.cuentaId && buscar(est.cuentas, f.cuentaId)) filtros.cuentaId = f.cuentaId;
    var movs = VF.calc.movimientosEn(est, ambito, r.desde, r.hasta, filtros);
    var q = U.normalizar(f.busqueda);
    if (q) {
      movs = movs.filter(function (m) {
        var texto = [m.descripcion, m.contraparte, m.categoria, m.monto, U.fmtFecha(m.fecha), nombreCuenta(est, m.cuentaId),
          m.cuentaDestinoId ? nombreCuenta(est, m.cuentaDestinoId) : '', m.estado === 'revisar' ? 'revisar' : ''].join(' ');
        return U.normalizar(texto).indexOf(q) >= 0;
      });
    }
    return movs;
  }

  /** Categorías disponibles para filtrar: las del ámbito más las presentes en sus movimientos. */
  function categoriasFiltro(est, ambito) {
    var cats = est.categorias && est.categorias[ambito] ? est.categorias[ambito] : { ingreso: [], gasto: [] };
    var vistas = {};
    var lista = [];
    function agregar(c) { if (c && !vistas[c]) { vistas[c] = true; lista.push(c); } }
    (cats.ingreso || []).forEach(agregar);
    (cats.gasto || []).forEach(agregar);
    (est.movimientos || []).forEach(function (m) { if (m && m.ambito === ambito) agregar(m.categoria); });
    lista.sort(function (a, b) { return a.localeCompare(b, 'es-MX'); });
    return lista;
  }

  /* ---------- cabecera de la vista ------------------------------------------ */
  function cabecera(est, ambito) {
    var activas = cuentasDe(est, ambito, true);
    var sub;
    if (activas.length) {
      var s = VF.calc.saldosPorAmbito(est, ambito);
      sub = (ambito === 'empresa' ? (est.ajustes.nombreEmpresa || 'Empresa') : (est.ajustes.nombreUsuario || 'Personal')) +
        ' · Líquido ' + fmt(s.liquido) + ' en ' + plural(activas.length, 'cuenta activa', 'cuentas activas');
    } else {
      sub = 'Sin cuentas activas. Crea una cuenta para empezar.';
    }
    return '<div class="vista-cabecera">' +
      '<div><h1>' + esc(NOMBRES[ambito]) + '</h1><p class="texto-2 mb-0" id="ambito-subtitulo">' + esc(sub) + '</p></div>' +
      '<div class="vista-acciones">' +
      '<button type="button" class="btn btn-secundario" ' + accion('ambito-nuevo-movimiento', ambito) + ' data-tipo="ingreso">' + VF.ui.icono('ingreso') + '<span>+ Ingreso</span></button>' +
      '<button type="button" class="btn btn-secundario" ' + accion('ambito-nuevo-movimiento', ambito) + ' data-tipo="gasto">' + VF.ui.icono('gasto') + '<span>+ Gasto</span></button>' +
      '<button type="button" class="btn btn-secundario" ' + accion('ambito-nuevo-movimiento', ambito) + ' data-tipo="transferencia">' + VF.ui.icono('transferencia') + '<span>+ Transferencia</span></button>' +
      '</div></div>';
  }

  /* ---------- sección: cuentas ---------------------------------------------- */
  function tarjetaCuenta(est, ambito, c) {
    var saldo = VF.calc.saldoCuenta(est, c.id);
    var color = colorValido(c.color);
    var esCredito = c.tipo === 'credito';
    var sub = (c.banco ? c.banco + ' · ' : '') + (TIPO_CUENTA[c.tipo] || c.tipo || '');
    var html = '<div class="kpi" role="button" tabindex="0" ' + accion('ambito-ver-cuenta', ambito, c.id) +
      ' aria-label="Ver movimientos de ' + esc(c.nombre) + '" style="cursor:pointer' + (color ? ';border-left-color:' + color : '') + '">' +
      '<div class="fila-entre" style="align-items:flex-start;flex-wrap:nowrap">' +
      '<div style="min-width:0"><p class="lista-titulo">' + esc(c.nombre) + '</p><p class="kpi-titulo">' + esc(sub) + '</p></div>' +
      btnIcono('ambito-editar-cuenta', 'editar', ambito, c.id, 'Editar cuenta ' + c.nombre) +
      '</div>';
    if (esCredito) {
      var deuda = saldo < 0 ? U.round2(-saldo) : 0;
      var limite = Number(c.limiteCredito) || 0;
      html += '<p class="kpi-valor ' + (deuda > 0 ? 'negativo' : 'positivo') + '" data-saldo>' + (deuda > 0 ? esc(fmt(deuda)) : 'Sin deuda') + '</p>';
      html += '<p class="kpi-sub">' + (deuda > 0 ? 'Deuda actual' : (saldo > 0 ? 'Saldo a favor ' + esc(fmt(saldo)) : 'Sin saldo pendiente')) + '</p>';
      if (limite > 0) {
        var uso = U.round2(deuda / limite * 100);
        html += '<div class="mt-1 mb-1">' + VF.ui.barraProgreso(uso, uso >= 80 ? 'negativo' : uso >= 50 ? 'alerta' : undefined) + '</div>' +
          '<p class="kpi-sub">Uso ' + esc(U.fmtNumero(uso, 1)) + ' % · Límite ' + esc(fmt(limite)) + ' · Disponible ' + esc(fmt(U.round2(limite - deuda))) + '</p>';
      }
      if (c.diaCorte || c.diaPago) {
        html += '<p class="kpi-sub">' + (c.diaCorte ? 'Corte día ' + esc(c.diaCorte) : '') + (c.diaCorte && c.diaPago ? ' · ' : '') + (c.diaPago ? 'Pago día ' + esc(c.diaPago) : '') + '</p>';
      }
    } else {
      html += '<p class="kpi-valor' + (saldo < 0 ? ' negativo' : '') + '" data-saldo>' + esc(fmt(saldo)) + '</p>';
      html += '<p class="kpi-sub">Saldo actual</p>';
    }
    return html + '</div>';
  }

  function itemArchivada(est, ambito, c) {
    var saldo = VF.calc.saldoCuenta(est, c.id);
    return '<li class="lista-item">' +
      '<span class="lista-icono">' + VF.ui.icono('cuenta') + '</span>' +
      '<div class="lista-texto"><p class="lista-titulo">' + esc(c.nombre) + '</p>' +
      '<p class="lista-sub">' + esc((c.banco ? c.banco + ' · ' : '') + (TIPO_CUENTA[c.tipo] || c.tipo || '') + ' · saldo ' + fmt(saldo)) + '</p></div>' +
      '<button type="button" class="btn btn-secundario" ' + accion('ambito-restaurar-cuenta', ambito, c.id) + '>Restaurar</button>' +
      btnIcono('ambito-editar-cuenta', 'editar', ambito, c.id, 'Editar cuenta ' + c.nombre) +
      '</li>';
  }

  function seccionCuentas(est, ambito) {
    var todas = cuentasDe(est, ambito, false);
    var activas = todas.filter(function (c) { return c.activa !== false; });
    var archivadas = todas.filter(function (c) { return c.activa === false; });
    var acciones = '<button type="button" class="btn btn-secundario" ' + accion('ambito-nueva-cuenta', ambito) + '>' +
      VF.ui.icono('agregar') + '<span>Cuenta</span></button>';
    var cuerpo;
    if (!todas.length) {
      cuerpo = VF.ui.vacio('Sin cuentas en ' + NOMBRES[ambito] + '. Crea una cuenta para empezar a registrar movimientos.', 'Crear cuenta', function () {
        abrirFormularioCuenta(ambito, {});
      });
    } else {
      if (activas.length) {
        var s = VF.calc.saldosPorAmbito(est, ambito);
        cuerpo = '<div class="' + (activas.length > 3 ? 'rejilla-4' : 'rejilla-3') + '" id="ambito-cuentas-activas">' +
          activas.map(function (c) { return tarjetaCuenta(est, ambito, c); }).join('') + '</div>';
        cuerpo += '<div class="mt-2" id="ambito-saldos">' + filaCifra('Líquido (cuentas activas sin tarjetas)', fmt(s.liquido));
        if (s.credito !== 0) cuerpo += filaCifra('Tarjetas de crédito (deuda)', fmt(s.credito), 'negativo');
        cuerpo += filaCifra('Total ' + NOMBRES[ambito], fmt(s.total)) + '</div>';
      } else {
        cuerpo = '<p class="texto-2">Todas las cuentas de ' + esc(NOMBRES[ambito]) + ' están archivadas.</p>';
      }
      if (archivadas.length) {
        cuerpo += '<details class="mt-1" id="ambito-archivadas"><summary class="texto-2" style="cursor:pointer;min-height:44px;display:flex;align-items:center">' +
          esc(plural(archivadas.length, 'cuenta archivada', 'cuentas archivadas')) + '</summary><ul class="lista">' +
          archivadas.map(function (c) { return itemArchivada(est, ambito, c); }).join('') + '</ul></details>';
      }
    }
    return VF.ui.tarjeta({ titulo: 'Cuentas', acciones: acciones, cuerpo: cuerpo, clase: 'ambito-cuentas' });
  }

  /* ---------- sección: movimientos ------------------------------------------ */
  function campoFiltro(ambito, nombre, etiqueta, control) {
    return '<div class="campo" data-campo-cont="' + esc(nombre) + '"><label class="sr-solo" for="ambito-filtro-' + esc(nombre) + '">' + esc(etiqueta) + '</label>' + control + '</div>';
  }
  function opciones(lista, valorActual) {
    return lista.map(function (op) {
      return '<option value="' + esc(op.valor) + '"' + (String(op.valor) === String(valorActual) ? ' selected' : '') + '>' + esc(op.texto) + '</option>';
    }).join('');
  }

  function filtrosHTML(est, ambito, f, inst) {
    var cuentas = cuentasDe(est, ambito, false);
    var cats = categoriasFiltro(est, ambito);
    var html = '<div class="fila-entre mb-1" style="align-items:flex-start">' +
      VF.ui.segmentos(PERIODOS, f.periodo, function (valor) {
        f.periodo = PERIODOS.some(function (p) { return p.valor === valor; }) ? valor : 'mes';
        f.pagina = 1;
        pintarMovimientos(inst);
      }) + '</div>';
    html += '<div class="filtros">';
    html += '<div class="fila" data-fechas-personalizadas' + (f.periodo === 'personalizado' ? '' : ' hidden') + ' style="flex:1 1 100%">' +
      campoFiltro(ambito, 'desde', 'Desde', '<input type="date" id="ambito-filtro-desde" data-filtro="desde" data-ambito="' + esc(ambito) + '" value="' + esc(f.desde) + '" aria-label="Desde">') +
      campoFiltro(ambito, 'hasta', 'Hasta', '<input type="date" id="ambito-filtro-hasta" data-filtro="hasta" data-ambito="' + esc(ambito) + '" value="' + esc(f.hasta) + '" aria-label="Hasta">') +
      '</div>';
    html += campoFiltro(ambito, 'tipo', 'Tipo', '<select id="ambito-filtro-tipo" data-filtro="tipo" data-ambito="' + esc(ambito) + '">' +
      opciones([{ valor: '', texto: 'Tipo: todos' }, { valor: 'ingreso', texto: 'Ingresos' }, { valor: 'gasto', texto: 'Gastos' }, { valor: 'transferencia', texto: 'Transferencias' }], f.tipo) + '</select>');
    html += campoFiltro(ambito, 'cuentaId', 'Cuenta', '<select id="ambito-filtro-cuentaId" data-filtro="cuentaId" data-ambito="' + esc(ambito) + '">' +
      opciones([{ valor: '', texto: 'Cuenta: todas' }].concat(cuentas.map(function (c) {
        return { valor: c.id, texto: c.nombre + (c.activa === false ? ' (archivada)' : '') };
      })), f.cuentaId) + '</select>');
    html += campoFiltro(ambito, 'categoria', 'Categoría', '<select id="ambito-filtro-categoria" data-filtro="categoria" data-ambito="' + esc(ambito) + '">' +
      opciones([{ valor: '', texto: 'Categoría: todas' }].concat(cats.map(function (c) { return { valor: c, texto: c }; })), f.categoria) + '</select>');
    html += campoFiltro(ambito, 'busqueda', 'Buscar', '<input type="search" id="ambito-filtro-busqueda" data-filtro="busqueda" data-ambito="' + esc(ambito) + '" value="' + esc(f.busqueda) + '" placeholder="Buscar descripción, contraparte, monto…" autocomplete="off">');
    html += '</div>';
    return html;
  }

  function tituloMovimiento(m) {
    return m.descripcion || m.categoria || TIPO_TEXTO[m.tipo] || 'Movimiento';
  }
  function celdaConcepto(est, m) {
    return '<div><strong>' + esc(tituloMovimiento(m)) + '</strong>' +
      (m.estado === 'revisar' ? ' <span class="badge badge-alerta">Revisar</span>' : '') +
      (m.contraparte ? '<br><small class="texto-2">' + esc(m.contraparte) + '</small>' : '') + '</div>';
  }
  /** Fila compacta (< 720 px): una sola celda con concepto, fecha · categoría · cuenta, monto y chevron. */
  function celdaMovil(est, m) {
    var sub = [U.fmtFecha(m.fecha), m.tipo === 'transferencia' ? 'Transferencia' : (m.categoria || 'Sin categoría'),
      nombreCuenta(est, m.cuentaId) + (m.tipo === 'transferencia' && m.cuentaDestinoId ? ' → ' + nombreCuenta(est, m.cuentaDestinoId) : '')];
    return '<div style="flex:1 1 auto;min-width:0;text-align:left;display:flex;align-items:center;gap:10px">' +
      '<div style="flex:1 1 auto;min-width:0">' +
      '<p class="mb-0" style="font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(tituloMovimiento(m)) +
      (m.estado === 'revisar' ? ' <span class="badge badge-alerta">Revisar</span>' : '') + '</p>' +
      '<p class="lista-sub" style="white-space:normal">' + esc(sub.join(' · ')) + '</p></div>' +
      '<strong class="cifra ' + tonoTipo(m.tipo) + '" style="white-space:nowrap">' + esc(signo(m.tipo, m.monto)) + '</strong>' +
      '<span class="texto-3" aria-hidden="true" style="display:inline-flex;margin-right:-6px">' + VF.ui.icono('flecha') + '</span></div>';
  }
  function celdaCuenta(est, m) {
    var html = esc(nombreCuenta(est, m.cuentaId));
    if (m.tipo === 'transferencia' && m.cuentaDestinoId) {
      var destino = buscar(est.cuentas, m.cuentaDestinoId);
      html += ' → ' + esc(destino ? destino.nombre : 'Cuenta eliminada') +
        (destino && destino.ambito !== m.ambito ? ' ' + VF.ui.badgeAmbito(destino.ambito) : '');
    }
    return html;
  }
  function celdaAcciones(ambito, m) {
    var vinculado = !!vinculoDe(m);
    var revisar = m.estado === 'revisar';
    return '<span class="fila" style="margin-left:auto;justify-content:flex-end;flex-wrap:nowrap;gap:2px">' +
      btnIcono('ambito-alternar-estado', revisar ? 'exito' : 'revisar', ambito, m.id, revisar ? 'Marcar como confirmado' : 'Marcar por revisar') +
      btnIcono('ambito-editar-movimiento', 'editar', ambito, m.id, 'Editar movimiento', vinculado, vinculado ? 'Vinculado: edítalo desde su sección' : 'Editar movimiento') +
      btnIcono('ambito-eliminar-movimiento', 'eliminar', ambito, m.id, 'Eliminar movimiento', vinculado, vinculado ? 'Vinculado: elimínalo desde su sección' : 'Eliminar movimiento') +
      '</span>';
  }

  function columnasPara(est, ambito) {
    if (esMovil()) {
      // Una sola celda por fila: la fila completa abre el detalle (editar, eliminar, marcar por revisar).
      return [{ clave: 'descripcion', titulo: '', render: function (v, m) { return celdaMovil(est, m); } }];
    }
    var colFecha = { clave: 'fecha', titulo: 'Fecha', render: function (f) {
      var dias = Math.abs(U.diasEntre(f, hoy()));
      return '<span style="white-space:nowrap">' + esc(U.fmtFecha(f)) + '</span>' +
        (dias < 7 ? '<br><small class="texto-3">' + esc(capitalizar(VF.ui.fechaRelativa(f))) + '</small>' : '');
    } };
    var colMonto = { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: function (monto, m) {
      return '<strong class="cifra ' + tonoTipo(m.tipo) + '" style="white-space:nowrap">' + esc(signo(m.tipo, monto)) + '</strong>';
    } };
    var colAcciones = { clave: '_acciones', titulo: '', alinear: 'derecha', render: function (v, m) { return celdaAcciones(ambito, m); } };
    return [colFecha,
      { clave: 'descripcion', titulo: 'Concepto', render: function (v, m) { return celdaConcepto(est, m); } },
      { clave: 'categoria', titulo: 'Categoría', render: function (c, m) { return esc(m.tipo === 'transferencia' ? (c || 'Transferencia') : (c || 'Sin categoría')); } },
      { clave: 'cuentaId', titulo: 'Cuenta', render: function (v, m) { return celdaCuenta(est, m); } },
      colMonto, colAcciones];
  }

  function chipsFiltros(est, ambito, f) {
    var chips = [];
    if (f.tipo && TIPO_TEXTO[f.tipo]) chips.push({ filtro: 'tipo', texto: 'Tipo: ' + TIPO_TEXTO[f.tipo] + 's' });
    if (f.cuentaId && buscar(est.cuentas, f.cuentaId)) chips.push({ filtro: 'cuentaId', texto: 'Cuenta: ' + nombreCuenta(est, f.cuentaId) });
    if (f.categoria) chips.push({ filtro: 'categoria', texto: 'Categoría: ' + f.categoria });
    if (f.busqueda) chips.push({ filtro: 'busqueda', texto: 'Búsqueda: “' + f.busqueda + '”' });
    if (!chips.length) return '';
    return '<div class="chips mb-1" id="ambito-chips">' + chips.map(function (ch) {
      return '<button type="button" class="chip" ' + accion('ambito-quitar-filtro', ambito) + ' data-filtro="' + esc(ch.filtro) + '" aria-label="Quitar filtro ' + esc(ch.texto) + '">' + esc(ch.texto) + ' ✕</button>';
    }).join('') + '<button type="button" class="btn btn-enlace" ' + accion('ambito-limpiar-filtros', ambito) + '>Limpiar filtros</button></div>';
  }

  function resumenMovimientos(movs, r) {
    if (!movs.length) {
      return '<p class="texto-2 mb-1" id="ambito-resumen">Sin movimientos · ' + esc(r.etiqueta) + '</p>';
    }
    var ing = U.suma(movs.filter(function (m) { return m.tipo === 'ingreso'; }), function (m) { return m.monto; });
    var gas = U.suma(movs.filter(function (m) { return m.tipo === 'gasto'; }), function (m) { return m.monto; });
    var tr = U.suma(movs.filter(function (m) { return m.tipo === 'transferencia'; }), function (m) { return m.monto; });
    var bal = U.round2(ing - gas);
    return '<div class="fila-entre mb-1" id="ambito-resumen"><span class="texto-2">' + esc(plural(movs.length, 'movimiento')) + ' · ' + esc(r.etiqueta) + '</span>' +
      '<span class="fila" style="gap:14px">' +
      '<span class="texto-2">Ingresos <strong class="cifra positivo" data-resumen="ingresos">' + esc('+' + fmt(ing)) + '</strong></span>' +
      '<span class="texto-2">Gastos <strong class="cifra negativo" data-resumen="gastos">' + esc('−' + fmt(gas)) + '</strong></span>' +
      '<span class="texto-2">Balance <strong class="cifra ' + (bal < 0 ? 'negativo' : '') + '" data-resumen="balance">' + esc(fmt(bal)) + '</strong></span>' +
      (tr > 0 ? '<span class="texto-3">Transferencias <strong class="cifra" data-resumen="transferencias">' + esc(fmt(tr)) + '</strong> (no cuentan en el balance)</span>' : '') +
      '</span></div>';
  }

  function cuerpoTabla(est, ambito, f, r) {
    var movs = movimientosFiltrados(est, ambito, f, r);
    var visibles = movs.slice(0, POR_PAGINA * Math.max(1, f.pagina));
    var html = chipsFiltros(est, ambito, f) + resumenMovimientos(movs, r);
    html += VF.ui.tabla({
      columnas: columnasPara(est, ambito),
      filas: visibles,
      vacio: 'Sin movimientos en este periodo',
      onFila: function (id) { abrirDetalleMovimiento(ambito, id); }
    });
    if (movs.length > visibles.length) {
      html += '<p class="centro mt-1 mb-0"><button type="button" class="btn btn-secundario" ' + accion('ambito-mas-movimientos', ambito) + '>Mostrar más (' +
        esc(plural(movs.length - visibles.length, 'restante')) + ')</button></p>';
    }
    return html;
  }

  function seccionMovimientos(est, ambito, f, r, inst) {
    return VF.ui.tarjeta({
      titulo: 'Movimientos',
      acciones: '<span class="texto-3">' + esc(NOMBRES[ambito]) + ' · solo cuentas de este ámbito</span>',
      cuerpo: filtrosHTML(est, ambito, f, inst) + '<div id="ambito-tabla">' + cuerpoTabla(est, ambito, f, r) + '</div>',
      clase: 'ambito-movimientos'
    });
  }

  /* ---------- sección: gastos por categoría -------------------------------- */
  function cuerpoDona(est, ambito, r) {
    var cats = VF.calc.gastosPorCategoria(est, ambito, r.desde, r.hasta);
    if (!cats.length) return VF.ui.vacio('Sin gastos en este periodo');
    return VF.ui.graficaDona({
      datos: cats.map(function (c) { return { etiqueta: c.categoria, valor: c.monto }; }),
      titulo: 'Gastos por categoría de ' + NOMBRES[ambito] + ' · ' + r.etiqueta
    });
  }
  function tarjetaDona(est, ambito, r) {
    return VF.ui.tarjeta({
      titulo: 'Gastos por categoría',
      acciones: '<span class="texto-3" data-periodo-etiqueta>' + esc(r.etiqueta) + '</span>',
      cuerpo: cuerpoDona(est, ambito, r),
      clase: 'ambito-dona'
    });
  }

  /* ---------- extras ------------------------------------------------------- */
  function idExtra(ex) { return String(ex && ex.id != null ? ex.id : '').replace(/[^a-zA-Z0-9_-]/g, ''); }
  function contexto(inst, est) {
    return {
      ambito: inst.ambito,
      estado: est,
      hoy: hoy(),
      repintar: function () { pintar(inst); },
      nuevoMovimiento: function (o) { return abrirFormularioMovimiento(inst.ambito, o || {}); },
      verCuenta: function (id) { filtrarPorCuenta(inst, id); }
    };
  }
  function extrasHTML(inst, est) {
    var ctx = contexto(inst, est);
    return (inst.opciones.extras || []).map(function (ex) {
      var id = idExtra(ex);
      if (!id) return '';
      var acciones = '';
      try { acciones = typeof ex.acciones === 'function' ? ex.acciones(ctx) : (ex.acciones || ''); } catch (e) { console.error('[VF.vistas.ambito] acciones del extra "' + id + '":', e); }
      return VF.ui.tarjeta({ titulo: ex.titulo || id, acciones: acciones, cuerpo: '', clase: 'ambito-extra ambito-extra-' + id });
    }).join('');
  }
  function pintarExtras(inst, est) {
    var ctx = contexto(inst, est);
    (inst.opciones.extras || []).forEach(function (ex) {
      var id = idExtra(ex);
      var el = id ? inst.raiz.querySelector('.ambito-extra-' + id + ' .tarjeta-cuerpo') : null;
      if (!el || typeof ex.render !== 'function') return;
      try {
        ex.render(el, ctx);
      } catch (e) {
        console.error('[VF.vistas.ambito] error en el extra "' + id + '":', e);
        el.innerHTML = '<p class="aviso aviso-error mb-0">No se pudo mostrar esta sección.</p>';
      }
    });
  }

  /* ---------- pintado ------------------------------------------------------- */
  function pintar(inst) {
    var est = estado();
    if (!est || !inst || !inst.contenedor) return;
    var ambito = inst.ambito;
    var f = filtrosDe(ambito);
    var r = rangoDe(f);
    var extras = inst.opciones.extras || [];
    var rejilla = extras.length === 3 ? 'rejilla-3' : extras.length >= 4 ? 'rejilla-4' : 'rejilla-2';
    var html = cabecera(est, ambito) + seccionCuentas(est, ambito) + seccionMovimientos(est, ambito, f, r, inst) +
      tarjetaDona(est, ambito, r) +
      (extras.length ? '<div class="' + rejilla + '">' + extrasHTML(inst, est) + '</div>' : '');
    inst.contenedor.innerHTML = '<div class="vista-ambito" id="ambito-' + esc(ambito) + '" data-vista-ambito="' + esc(ambito) + '">' + html + '</div>';
    inst.raiz = inst.contenedor.firstElementChild;
    pintarExtras(inst, est);
  }

  /** Vuelve a pintar sólo la tabla de movimientos, el resumen y la dona (los filtros conservan el foco). */
  function pintarMovimientos(inst) {
    var est = estado();
    if (!est || !inst || !inst.raiz || !document.contains(inst.raiz)) return;
    var f = filtrosDe(inst.ambito);
    var r = rangoDe(f);
    var cont = inst.raiz.querySelector('#ambito-tabla');
    if (cont) cont.innerHTML = cuerpoTabla(est, inst.ambito, f, r);
    var dona = inst.raiz.querySelector('.ambito-dona .tarjeta-cuerpo');
    if (dona) dona.innerHTML = cuerpoDona(est, inst.ambito, r);
    var etq = inst.raiz.querySelector('.ambito-dona [data-periodo-etiqueta]');
    if (etq) etq.textContent = r.etiqueta;
    var fechas = inst.raiz.querySelector('[data-fechas-personalizadas]');
    if (fechas) fechas.hidden = f.periodo !== 'personalizado';
    ['tipo', 'cuentaId', 'categoria', 'busqueda', 'desde', 'hasta'].forEach(function (n) {
      var ctrl = inst.raiz.querySelector('[data-filtro="' + n + '"]');
      if (ctrl && ctrl.value !== String(f[n] || '') && document.activeElement !== ctrl) ctrl.value = f[n] || '';
    });
  }

  function filtrarPorCuenta(inst, cuentaId) {
    var est = estado();
    if (!est || !inst) return;
    var f = filtrosDe(inst.ambito);
    var c = buscar(est.cuentas, cuentaId);
    f.cuentaId = c && c.ambito === inst.ambito ? c.id : '';
    f.pagina = 1;
    pintarMovimientos(inst);
    var sec = inst.raiz && inst.raiz.querySelector('.ambito-movimientos');
    if (sec && typeof sec.scrollIntoView === 'function') {
      setTimeout(function () { try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { sec.scrollIntoView(); } }, 30);
    }
  }

  /* ---------- modal: detalle de un movimiento ------------------------------ */
  function abrirDetalleMovimiento(ambito, id) {
    var est = estado();
    if (!est) return null;
    var m = buscar(est.movimientos, id);
    if (!m) { toast('El movimiento ya no existe.', 'alerta'); return null; }
    var vinculo = vinculoDe(m);
    var destino = m.tipo === 'transferencia' && m.cuentaDestinoId ? buscar(est.cuentas, m.cuentaDestinoId) : null;
    var filas = [
      ['Fecha', esc(U.fmtFecha(m.fecha)) + ' <small class="texto-3">' + esc(capitalizar(VF.ui.fechaRelativa(m.fecha))) + '</small>'],
      [m.tipo === 'transferencia' ? 'Cuenta origen' : 'Cuenta', esc(nombreCuenta(est, m.cuentaId))],
      m.tipo === 'transferencia' ? ['Cuenta destino', esc(destino ? destino.nombre : 'Cuenta eliminada') + (destino && destino.ambito !== m.ambito ? ' ' + VF.ui.badgeAmbito(destino.ambito) : '')] : null,
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
      botones.push({ texto: 'Eliminar', tono: 'peligro', accion: function () { return eliminarMovimiento(m.id); } });
      botones.push({ texto: 'Editar', tono: 'secundario', accion: function () { setTimeout(function () { abrirFormularioMovimiento(ambito, { id: m.id }); }, 60); } });
    }
    botones.push({ texto: m.estado === 'revisar' ? 'Confirmar' : 'Marcar por revisar', tono: 'secundario', accion: function () { alternarEstado(m.id); } });
    botones.push({ texto: 'Cerrar', tono: 'primario' });
    return VF.ui.modal({ titulo: 'Movimiento · ' + NOMBRES[m.ambito], cuerpo: cuerpo, botones: botones });
  }

  /** → Promise<bool>: true si se eliminó (cierra el modal), false si se canceló o falló. */
  function eliminarMovimiento(id) {
    return VF.ui.confirmar('¿Eliminar este movimiento? El saldo de la cuenta se recalculará.', { peligro: true, textoAceptar: 'Eliminar' })
      .then(function (ok) {
        if (!ok) return false;
        try {
          if (!VF.store.eliminar('movimientos', id)) { toast('El movimiento ya no existe.', 'alerta'); return true; }
          toast('Movimiento eliminado', 'exito');
          return true;
        } catch (e) {
          toast('No se pudo eliminar: ' + (e && e.message ? e.message : e), 'error');
          return false;
        }
      });
  }

  function alternarEstado(id) {
    var est = estado();
    var m = est ? buscar(est.movimientos, id) : null;
    if (!m) { toast('El movimiento ya no existe.', 'alerta'); return; }
    var nuevo = m.estado === 'revisar' ? 'confirmado' : 'revisar';
    try {
      VF.store.actualizar('movimientos', id, { estado: nuevo });
      toast(nuevo === 'revisar' ? 'Marcado por revisar' : 'Movimiento confirmado', 'exito');
    } catch (e) {
      toast('No se pudo actualizar: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  /* ---------- modal: alta / edición de movimiento -------------------------- */
  function llenarSelect(sel, lista, valor, placeholder) {
    if (!sel) return;
    var html = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    var existe = false;
    lista.forEach(function (op) {
      var s = String(op.valor) === String(valor);
      if (s) existe = true;
      html += '<option value="' + esc(op.valor) + '"' + (s ? ' selected' : '') + '>' + esc(op.texto) + '</option>';
    });
    if (!existe && valor) {
      // Conserva un valor que ya no está en la lista (p. ej. categoría eliminada) para no perderlo al editar.
      html += '<option value="' + esc(valor) + '" selected>' + esc(valor) + '</option>';
      existe = true;
    }
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

  function actualizarFormularioMovimiento(ambito, form, envoltura, iniciales) {
    var est = estado();
    if (!est) return;
    var v = VF.ui.leerFormulario(form);
    var ini = iniciales || {};
    var tipo = TIPO_TEXTO[v.tipo] ? v.tipo : 'gasto';
    var esTransfer = tipo === 'transferencia';

    var cuentas = cuentasDe(est, ambito, true);
    var cuentaActual = v.cuentaId || ini.cuentaId || '';
    if (!cuentas.some(function (c) { return c.id === cuentaActual; })) cuentaActual = cuentas.length === 1 ? cuentas[0].id : '';
    llenarSelect(form.querySelector('[data-campo="cuentaId"]'), cuentas.map(function (c) {
      return { valor: c.id, texto: c.nombre + (c.banco ? ' · ' + c.banco : '') };
    }), cuentaActual, 'Elige una cuenta');
    var etiquetaCuenta = form.querySelector('[data-campo-cont="cuentaId"] label');
    if (etiquetaCuenta) etiquetaCuenta.textContent = esTransfer ? 'Cuenta origen' : 'Cuenta';

    var destinos = (est.cuentas || []).filter(function (c) { return c && c.activa !== false && c.id !== cuentaActual; })
      .sort(function (a, b) { return (a.ambito === ambito ? 0 : 1) - (b.ambito === ambito ? 0 : 1); })
      .map(function (c) { return { valor: c.id, texto: NOMBRES[c.ambito] + ' · ' + c.nombre }; });
    var destinoActual = v.cuentaDestinoId || ini.cuentaDestinoId || '';
    llenarSelect(form.querySelector('[data-campo="cuentaDestinoId"]'), destinos, destinoActual, 'Elige la cuenta destino');

    var cats = (est.categorias && est.categorias[ambito] && est.categorias[ambito][tipo === 'ingreso' ? 'ingreso' : 'gasto']) || [];
    var catActual = v.categoria || ini.categoria || '';
    if (esTransfer) catActual = '';
    // Al cambiar de Ingreso a Gasto (o viceversa) la categoría anterior deja de ser válida; sólo se conserva
    // una categoría fuera de la lista si es la que ya tenía el movimiento que se está editando.
    if (catActual && cats.indexOf(catActual) < 0 && catActual !== ini.categoria) catActual = '';
    llenarSelect(form.querySelector('[data-campo="categoria"]'), cats.map(function (c) { return { valor: c, texto: c }; }), catActual, 'Elige una categoría');

    var contDestino = form.querySelector('[data-campo-cont="cuentaDestinoId"]');
    var contCat = form.querySelector('[data-campo-cont="categoria"]');
    if (contDestino) contDestino.hidden = !esTransfer;
    if (contCat) contCat.hidden = esTransfer;

    var avisoSin = envoltura.querySelector('[data-aviso-sin-cuentas]');
    if (avisoSin) {
      avisoSin.hidden = cuentas.length > 0;
      if (!cuentas.length) avisoSin.textContent = 'No hay cuentas activas en ' + NOMBRES[ambito] + '. Crea una cuenta en la sección Cuentas para poder registrar movimientos.';
    }
    var avisoCruce = envoltura.querySelector('[data-aviso-cruce]');
    if (avisoCruce) {
      var origen = buscar(est.cuentas, cuentaActual);
      var destino = buscar(est.cuentas, (form.querySelector('[data-campo="cuentaDestinoId"]') || {}).value);
      if (esTransfer && origen && destino && origen.ambito !== destino.ambito) {
        var cat = origen.ambito === 'empresa' ? 'Retiro de socio' : 'Aportación de capital';
        avisoCruce.textContent = 'Se registrará como «' + cat + '» (' + NOMBRES[origen.ambito] + ' → ' + NOMBRES[destino.ambito] +
          '). Afecta los saldos de ambas cuentas pero no cuenta como ingreso ni gasto.';
        avisoCruce.hidden = false;
      } else {
        avisoCruce.hidden = true;
      }
    }
  }

  /**
   * Abre el modal de alta rápida ({ tipo, cuentaId }) o de edición ({ id }) de un movimiento del ámbito.
   * Devuelve la api del modal ({ cerrar, elemento }) o null.
   */
  function abrirFormularioMovimiento(ambito, opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est || !esAmbito(ambito)) return null;
    var existente = o.id ? buscar(est.movimientos, o.id) : null;
    if (o.id && !existente) { toast('El movimiento ya no existe.', 'alerta'); return null; }
    if (existente && vinculoDe(existente)) { toast('Este movimiento está vinculado; edítalo desde su sección.', 'alerta'); return null; }
    if (existente && existente.ambito !== ambito) ambito = esAmbito(existente.ambito) ? existente.ambito : ambito;

    var valores = existente ? {
      tipo: existente.tipo, cuentaId: existente.cuentaId, cuentaDestinoId: existente.cuentaDestinoId || '',
      monto: existente.monto, fecha: existente.fecha, categoria: existente.categoria || '', descripcion: existente.descripcion || '',
      contraparte: existente.contraparte || '', estado: existente.estado === 'revisar' ? 'revisar' : 'confirmado'
    } : {
      tipo: TIPO_TEXTO[o.tipo] ? o.tipo : 'gasto', cuentaId: o.cuentaId || '', cuentaDestinoId: '', monto: '', fecha: hoy(),
      categoria: '', descripcion: '', contraparte: '', estado: 'confirmado'
    };

    var campos = [
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true,
        opciones: [{ valor: 'gasto', texto: 'Gasto' }, { valor: 'ingreso', texto: 'Ingreso' }, { valor: 'transferencia', texto: 'Transferencia' }] },
      { nombre: 'cuentaId', etiqueta: 'Cuenta', tipo: 'select', requerido: true, placeholder: 'Elige una cuenta', opciones: [],
        ayuda: 'Sólo cuentas de ' + NOMBRES[ambito] + '.' },
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
      '<p class="fila mb-2">' + VF.ui.badgeAmbito(ambito) + '<span class="texto-3">Empresa y personal nunca se mezclan.</span></p>' +
      '<p class="aviso aviso-alerta" data-aviso-sin-cuentas hidden></p>' +
      VF.ui.formulario(campos, valores) +
      '<p class="aviso aviso-alerta" data-aviso-cruce hidden></p>' +
      '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['tipo', 'cuentaId']);
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
      if (!origen || origen.ambito !== ambito) { toast('Elige una cuenta de ' + NOMBRES[ambito] + '.', 'error'); return false; }
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
          toast(v.tipo === 'transferencia' ? 'Transferencia guardada' : TIPO_TEXTO[v.tipo] + ' guardado', 'exito');
        }
      } catch (e) {
        toast('No se pudo guardar: ' + (e && e.message ? e.message : e), 'error');
        return false;
      }
      return true;
    }

    form.addEventListener('change', function (e) {
      var campo = e.target && e.target.getAttribute ? e.target.getAttribute('data-campo') : null;
      if (['tipo', 'cuentaId', 'cuentaDestinoId'].indexOf(campo) >= 0) actualizarFormularioMovimiento(ambito, form, envoltura, { categoria: valores.categoria });
    });

    var tituloTipo = existente ? 'Editar movimiento' : (valores.tipo === 'ingreso' ? 'Nuevo ingreso' : valores.tipo === 'transferencia' ? 'Nueva transferencia' : 'Nuevo gasto');
    var api = VF.ui.modal({
      titulo: tituloTipo + ' · ' + NOMBRES[ambito],
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
    actualizarFormularioMovimiento(ambito, form, envoltura, valores);
    return api;
  }

  /* ---------- modal: alta / edición de cuenta ------------------------------ */
  function actualizarFormularioCuenta(form) {
    var v = VF.ui.leerFormulario(form);
    var esCredito = v.tipo === 'credito';
    ['deudaInicial', 'limiteCredito', 'diaCorte', 'diaPago'].forEach(function (n) {
      var cont = form.querySelector('[data-campo-cont="' + n + '"]');
      if (cont) cont.hidden = !esCredito;
    });
    var contSaldo = form.querySelector('[data-campo-cont="saldoInicial"]');
    if (contSaldo) contSaldo.hidden = esCredito;
  }

  /** Abre el modal para crear ({}) o editar ({ id }) una cuenta del ámbito. */
  function abrirFormularioCuenta(ambito, opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est || !esAmbito(ambito)) return null;
    var existente = o.id ? buscar(est.cuentas, o.id) : null;
    if (o.id && !existente) { toast('La cuenta ya no existe.', 'alerta'); return null; }
    if (existente && esAmbito(existente.ambito)) ambito = existente.ambito;
    var conMovs = existente ? cuentaConMovimientos(est, existente.id) : false;

    var valores = existente ? {
      nombre: existente.nombre || '', banco: existente.banco || '', tipo: TIPO_CUENTA[existente.tipo] ? existente.tipo : 'cheques',
      color: colorValido(existente.color) || COLORES[0].valor,
      saldoInicial: existente.tipo === 'credito' ? 0 : (Number(existente.saldoInicial) || 0),
      deudaInicial: existente.tipo === 'credito' ? U.round2(-(Number(existente.saldoInicial) || 0)) : 0,
      limiteCredito: existente.limiteCredito != null ? existente.limiteCredito : '',
      diaCorte: existente.diaCorte != null ? existente.diaCorte : '', diaPago: existente.diaPago != null ? existente.diaPago : ''
    } : {
      nombre: '', banco: '', tipo: 'cheques', color: ambito === 'empresa' ? COLORES[0].valor : COLORES[1].valor,
      saldoInicial: 0, deudaInicial: 0, limiteCredito: '', diaCorte: '', diaPago: ''
    };

    var campos = [
      { nombre: 'nombre', etiqueta: 'Nombre de la cuenta', tipo: 'texto', requerido: true, placeholder: ambito === 'empresa' ? 'BBVA Empresas' : 'Nu Cuenta', maxlength: 60 },
      { nombre: 'banco', etiqueta: 'Banco o institución', tipo: 'texto', placeholder: 'BBVA, Nu, Efectivo…', maxlength: 60 },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, opciones: TIPOS_CUENTA.map(function (t) { return { valor: t, texto: TIPO_CUENTA[t] }; }) },
      { nombre: 'color', etiqueta: 'Color', tipo: 'select', opciones: COLORES },
      { nombre: 'saldoInicial', etiqueta: 'Saldo inicial (MXN)', tipo: 'monto', placeholder: '0.00',
        ayuda: 'Saldo que tenía la cuenta antes del primer movimiento registrado' + (conMovs ? '. Cambiarlo recalcula el saldo actual.' : '.') },
      { nombre: 'deudaInicial', etiqueta: 'Deuda inicial (MXN)', tipo: 'monto', min: 0, placeholder: '0.00',
        ayuda: 'Lo que debías en la tarjeta antes del primer movimiento registrado (se guarda como saldo negativo).' },
      { nombre: 'limiteCredito', etiqueta: 'Límite de crédito (MXN)', tipo: 'monto', min: 0, placeholder: '0.00' },
      { nombre: 'diaCorte', etiqueta: 'Día de corte', tipo: 'numero', min: 1, max: 31, paso: 1, placeholder: '1 a 31' },
      { nombre: 'diaPago', etiqueta: 'Día límite de pago', tipo: 'numero', min: 1, max: 31, paso: 1, placeholder: '1 a 31' }
    ];

    var envoltura = VF.ui.el('<div>' +
      '<p class="fila mb-2">' + VF.ui.badgeAmbito(ambito) +
      (existente && existente.activa === false ? '<span class="badge">Archivada</span>' : '') +
      (conMovs ? '<span class="texto-3">Tiene movimientos: no se puede eliminar, sólo archivar.</span>' : '') + '</p>' +
      VF.ui.formulario(campos, valores) + '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['tipo', 'color']);
    agruparCampos(form, ['deudaInicial', 'limiteCredito']);
    agruparCampos(form, ['diaCorte', 'diaPago']);
    form.addEventListener('change', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-campo') === 'tipo') actualizarFormularioCuenta(form);
    });
    actualizarFormularioCuenta(form);

    var reglas = {
      nombre: function (x) { return x ? null : 'Escribe un nombre'; },
      saldoInicial: function (x, vals) { return vals.tipo !== 'credito' && isNaN(x) && String((form.querySelector('[data-campo="saldoInicial"]') || {}).value || '').trim() !== '' ? 'Ingresa un monto válido' : null; },
      deudaInicial: function (x, vals) { return vals.tipo === 'credito' && !isNaN(x) && x < 0 ? 'La deuda no puede ser negativa' : null; }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var esCredito = v.tipo === 'credito';
      var saldoInicial = esCredito
        ? U.round2(-(isNaN(v.deudaInicial) ? 0 : v.deudaInicial))
        : U.round2(isNaN(v.saldoInicial) ? 0 : v.saldoInicial);
      var registro = {
        ambito: ambito,
        nombre: v.nombre,
        banco: v.banco,
        tipo: TIPO_CUENTA[v.tipo] ? v.tipo : 'cheques',
        saldoInicial: saldoInicial,
        moneda: 'MXN',
        limiteCredito: esCredito && !isNaN(v.limiteCredito) && v.limiteCredito > 0 ? U.round2(v.limiteCredito) : null,
        diaCorte: esCredito && v.diaCorte != null ? Math.round(v.diaCorte) : null,
        diaPago: esCredito && v.diaPago != null ? Math.round(v.diaPago) : null,
        color: colorValido(v.color) || null
      };
      try {
        if (existente) {
          VF.store.actualizar('cuentas', existente.id, registro);
          toast('Cuenta actualizada', 'exito');
        } else {
          VF.store.agregar('cuentas', Object.assign({ activa: true }, registro));
          toast('Cuenta creada', 'exito');
        }
      } catch (e) {
        toast('No se pudo guardar: ' + (e && e.message ? e.message : e), 'error');
        return false;
      }
      return true;
    }

    var botones = [];
    var api = null;
    if (existente) {
      botones.push({ texto: 'Eliminar', tono: 'peligro', accion: function () {
        var estAhora = estado();
        if (!estAhora) return false;
        // Integridad (ARQUITECTURA.md 2.1): una cuenta con movimientos no se elimina. Se explica con amabilidad
        // y se ofrece archivarla; el modal de edición permanece abierto detrás.
        if (cuentaConMovimientos(estAhora, existente.id)) {
          explicarNoEliminable(existente, api);
          return false;
        }
        return VF.ui.confirmar('¿Eliminar la cuenta «' + existente.nombre + '»? No tiene movimientos, así que no se pierde ningún registro.', { peligro: true, textoAceptar: 'Eliminar' })
          .then(function (ok) {
            if (!ok) return false;
            try {
              VF.store.eliminar('cuentas', existente.id);
              toast('Cuenta eliminada', 'exito');
              return true;
            } catch (e) {
              if (e && e.message === 'CUENTA_CON_MOVIMIENTOS') { explicarNoEliminable(existente, api); return false; }
              toast('No se pudo eliminar: ' + (e && e.message ? e.message : e), 'error');
              return false;
            }
          });
      } });
      var archivada = existente.activa === false;
      botones.push({ texto: archivada ? 'Restaurar' : 'Archivar', tono: 'secundario', accion: function () {
        return cambiarArchivo(existente.id, !archivada);
      } });
    }
    botones.push({ texto: 'Cancelar', tono: 'secundario' });
    botones.push({ texto: existente ? 'Guardar cambios' : 'Crear cuenta', tono: 'primario', accion: guardar });

    api = VF.ui.modal({
      titulo: existente ? 'Editar cuenta' : 'Nueva cuenta · ' + NOMBRES[ambito],
      cuerpo: envoltura,
      botones: botones
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (guardar() !== false) api.cerrar();
    });
    return api;
  }

  function movimientosDeCuenta(est, id) {
    return (est.movimientos || []).filter(function (m) { return m && (m.cuentaId === id || m.cuentaDestinoId === id); });
  }

  /**
   * Modal amable: la cuenta tiene movimientos y no puede eliminarse (regla de integridad); ofrece archivarla.
   * `apiEdicion` (opcional) es el modal de edición que se cierra si el usuario decide archivar.
   */
  function explicarNoEliminable(cuenta, apiEdicion) {
    var est = estado();
    if (!est || !cuenta) return null;
    var n = movimientosDeCuenta(est, cuenta.id).length;
    var botones = [{ texto: 'Entendido', tono: 'secundario' }];
    if (cuenta.activa !== false) {
      botones.push({ texto: 'Archivar cuenta', tono: 'primario', accion: function () {
        var ok = aplicarArchivo(cuenta.id, true);
        if (ok && apiEdicion && typeof apiEdicion.cerrar === 'function') apiEdicion.cerrar();
        return ok;
      } });
    }
    return VF.ui.modal({
      titulo: 'Esta cuenta no se puede eliminar',
      cuerpo: '<p class="aviso aviso-alerta">La cuenta «' + esc(cuenta.nombre) + '» tiene ' + esc(plural(n, 'movimiento registrado', 'movimientos registrados')) +
        '. Para no perder tu historial ni descuadrar los saldos, las cuentas con movimientos no se eliminan.</p>' +
        '<p class="texto-2 mb-0">' + (cuenta.activa !== false
          ? 'Si ya no la usas, archívala: sus movimientos se conservan y dejará de contar en el líquido y los totales de ' + esc(NOMBRES[cuenta.ambito] || '') + '. Podrás restaurarla cuando quieras.'
          : 'La cuenta ya está archivada: no suma en los totales, pero conserva su historial.') + '</p>',
      botones: botones
    });
  }

  /** Aplica el cambio activa:true/false sin preguntar. → true si se aplicó. */
  function aplicarArchivo(id, archivar) {
    var est = estado();
    var c = est ? buscar(est.cuentas, id) : null;
    if (!c) { toast('La cuenta ya no existe.', 'alerta'); return false; }
    try {
      VF.store.actualizar('cuentas', id, { activa: !archivar });
      toast(archivar ? 'Cuenta archivada. Sus movimientos se conservan.' : 'Cuenta restaurada', 'exito');
      return true;
    } catch (e) {
      toast('No se pudo actualizar: ' + (e && e.message ? e.message : e), 'error');
      return false;
    }
  }

  /**
   * Archiva (activa:false) o restaura una cuenta. Restaurar es inmediato. Archivar una cuenta con movimientos
   * o con saldo pide confirmación explicando que el historial se conserva pero deja de contar en los totales.
   * → true | false | Promise<bool> (cuando hubo confirmación).
   */
  function cambiarArchivo(id, archivar) {
    var est = estado();
    var c = est ? buscar(est.cuentas, id) : null;
    if (!c) { toast('La cuenta ya no existe.', 'alerta'); return false; }
    if (!archivar) return aplicarArchivo(id, false);
    var n = movimientosDeCuenta(est, id).length;
    var saldo = VF.calc.saldoCuenta(est, id);
    if (!n && saldo === 0) return aplicarArchivo(id, true);
    var mensaje = '¿Archivar la cuenta «' + c.nombre + '»? ' +
      (n ? 'Sus ' + plural(n, 'movimiento') + ' se conservan, pero la cuenta' : 'La cuenta') +
      ' dejará de contar en el líquido y los totales de ' + NOMBRES[c.ambito] +
      (saldo !== 0 ? ' (saldo actual ' + fmt(saldo) + ')' : '') + '. Podrás restaurarla cuando quieras.';
    return VF.ui.confirmar(mensaje, { titulo: 'Archivar cuenta', textoAceptar: 'Archivar' })
      .then(function (ok) { return ok ? aplicarArchivo(id, true) : false; });
  }

  /* ---------- API pública: VF.vistas.ambito -------------------------------- */
  /**
   * Pinta la vista de un ámbito dentro de `contenedor`.
   * opciones: { extras: [{ id, titulo, acciones?: string | fn(ctx) → string, render(el, ctx) }], params }
   *   ctx = { ambito, estado, hoy, repintar(), nuevoMovimiento(o), verCuenta(id) }
   *   params.cuenta = id → filtra los movimientos por esa cuenta al abrir (lo usa el Panel).
   * Devuelve { ambito, repintar(), pintarMovimientos(), filtros() }.
   */
  function vistaAmbito(contenedor, ambito, opciones) {
    if (!esAmbito(ambito)) throw new Error('AMBITO_REQUERIDO');
    var cont = typeof contenedor === 'string' ? document.querySelector(contenedor) : contenedor;
    if (!cont) return null;
    var o = opciones || {};
    var inst = { ruta: VF.router.actual().ruta, ambito: ambito, contenedor: cont, raiz: null, opciones: o };
    instancia = inst;
    filtrosDe(ambito).pagina = 1;   // los filtros se recuerdan; la paginación "Mostrar más" no
    if (VF.ui.ambitoActivo) VF.ui.ambitoActivo(ambito);
    pintar(inst);

    var est = estado();
    var params = o.params || {};
    if (params.cuenta && est) {
      var c = buscar(est.cuentas, params.cuenta);
      if (c && c.ambito === ambito) {
        var f = filtrosDe(ambito);
        f.cuentaId = c.id;
        f.pagina = 1;
        pintarMovimientos(inst);
        setTimeout(function () {
          var sec = inst.raiz && inst.raiz.querySelector('.ambito-movimientos');
          if (sec && document.contains(sec)) { try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { sec.scrollIntoView(); } }
        }, 80);
      }
      if (/\?/.test(location.hash)) {
        try { history.replaceState(null, '', '#/' + inst.ruta); } catch (e) { /* file:// en algunos navegadores */ }
      }
    }
    return {
      ambito: ambito,
      repintar: function () { pintar(inst); },
      pintarMovimientos: function () { pintarMovimientos(inst); },
      filtros: function () { return filtrosDe(ambito); }
    };
  }

  function instanciaActiva() {
    if (!instancia || !VF.store.estaDesbloqueado()) return null;
    if (VF.router.actual().ruta !== instancia.ruta) return null;
    if (!instancia.raiz || !document.contains(instancia.raiz)) return null;
    return instancia;
  }

  /* ---------- delegación de eventos (data-accion="ambito-…") --------------- */
  var buscarConRetardo = U.debounce(function (inst) { pintarMovimientos(inst); }, 250);

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="ambito-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    var ambito = t.getAttribute('data-ambito');
    if (!esAmbito(ambito)) {
      var raiz = t.closest('[data-vista-ambito]');
      ambito = raiz ? raiz.getAttribute('data-vista-ambito') : (instancia ? instancia.ambito : null);
    }
    if (!esAmbito(ambito)) return;
    var id = t.getAttribute('data-id');
    var inst = instanciaActiva();
    var f = filtrosDe(ambito);
    switch (t.getAttribute('data-accion')) {
      case 'ambito-nuevo-movimiento':
        abrirFormularioMovimiento(ambito, { tipo: t.getAttribute('data-tipo') || 'gasto', cuentaId: t.getAttribute('data-cuenta') || '' });
        break;
      case 'ambito-nueva-cuenta':
        abrirFormularioCuenta(ambito, {});
        break;
      case 'ambito-editar-cuenta':
        abrirFormularioCuenta(ambito, { id: id });
        break;
      case 'ambito-restaurar-cuenta':
        cambiarArchivo(id, false);
        break;
      case 'ambito-ver-cuenta':
        if (inst && inst.ambito === ambito) filtrarPorCuenta(inst, id);
        else VF.router.ir(ambito, { cuenta: id });
        break;
      case 'ambito-ver-movimiento':
        abrirDetalleMovimiento(ambito, id);
        break;
      case 'ambito-editar-movimiento':
        abrirFormularioMovimiento(ambito, { id: id });
        break;
      case 'ambito-eliminar-movimiento':
        eliminarMovimiento(id);
        break;
      case 'ambito-alternar-estado':
        alternarEstado(id);
        break;
      case 'ambito-mas-movimientos':
        f.pagina = (f.pagina || 1) + 1;
        if (inst) pintarMovimientos(inst);
        break;
      case 'ambito-quitar-filtro': {
        var nombre = t.getAttribute('data-filtro');
        if (nombre && Object.prototype.hasOwnProperty.call(f, nombre)) { f[nombre] = ''; f.pagina = 1; }
        if (inst) pintarMovimientos(inst);
        break;
      }
      case 'ambito-limpiar-filtros':
        f.tipo = ''; f.cuentaId = ''; f.categoria = ''; f.busqueda = ''; f.pagina = 1;
        if (inst) pintarMovimientos(inst);
        break;
      default:
        break;
    }
  });

  /* Enter / Espacio sobre elementos con role="button" propios (tarjetas de cuenta, etc.). */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target;
    if (!t || !t.matches || !t.matches('[role="button"][data-accion^="ambito-"], [role="button"][data-accion^="empresa-"], [role="button"][data-accion^="personal-"]')) return;
    if (t.tagName === 'BUTTON' || t.tagName === 'A') return;
    e.preventDefault();
    t.click();
  });

  /* Filtros de movimientos */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.hasAttribute('data-filtro')) return;
    var raiz = t.closest('[data-vista-ambito]');
    if (!raiz) return;
    var inst = instanciaActiva();
    if (!inst || inst.raiz !== raiz) return;
    var nombre = t.getAttribute('data-filtro');
    var f = filtrosDe(inst.ambito);
    if (!Object.prototype.hasOwnProperty.call(f, nombre)) return;
    f[nombre] = String(t.value || '').trim();
    f.pagina = 1;
    pintarMovimientos(inst);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute || t.getAttribute('data-filtro') !== 'busqueda') return;
    var inst = instanciaActiva();
    if (!inst || !inst.raiz.contains(t)) return;
    var f = filtrosDe(inst.ambito);
    f.busqueda = String(t.value || '').trim();
    f.pagina = 1;
    buscarConRetardo(inst);
  });

  /* Columnas compactas / completas al cruzar 720 px */
  if (mqMovil) {
    var alCambiarAncho = function () { var inst = instanciaActiva(); if (inst) pintarMovimientos(inst); };
    if (typeof mqMovil.addEventListener === 'function') mqMovil.addEventListener('change', alCambiarAncho);
    else if (typeof mqMovil.addListener === 'function') mqMovil.addListener(alCambiarAncho);
  }

  /* ---------- reacción a cambios del store --------------------------------- */
  VF.store.on('cambio', function () {
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(function () {
      var inst = instanciaActiva();
      if (inst) pintar(inst);
    }, 30);
  });
  VF.store.on('bloqueado', function () { instancia = null; });

  VF.vistas = VF.vistas || {};
  VF.vistas.ambito = vistaAmbito;
  /* Formularios del componente, reutilizables desde otros módulos (personal.js, asistente…). */
  VF.vistas.formularioMovimiento = function (ambito, opciones) { return abrirFormularioMovimiento(ambito, opciones || {}); };
  VF.vistas.formularioCuenta = function (ambito, opciones) { return abrirFormularioCuenta(ambito, opciones || {}); };
  VF.vistas.detalleMovimiento = function (ambito, id) { return abrirDetalleMovimiento(ambito, id); };

  /* ======================================================================== */
  /*  Vista Empresa (#/empresa): extras Facturas / CxC, Proveedores / CxP, Comisiones                       */
  /* ======================================================================== */
  function enlaceChico(ruta, texto, params) {
    var q = '';
    if (params) {
      q = '?' + Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    }
    return '<a class="btn btn-fantasma" href="#/' + esc(ruta) + q + '">' + esc(texto) + '</a>';
  }
  function bloqueCifra(titulo, valor, clase) {
    return '<div><p class="kpi-titulo">' + esc(titulo) + '</p><p class="kpi-valor ' + esc(clase || '') + '" style="font-size:1.25rem">' + esc(valor) + '</p></div>';
  }

  function extraFacturas(el, ctx) {
    var est = ctx.estado;
    var pc = VF.calc.porCobrar(est);
    var nFacturas = (est.facturas || []).length;
    if (!nFacturas) {
      el.innerHTML = '<p class="texto-2 mb-1">Sin facturas registradas.</p><p class="mb-0">' + enlaceChico('facturas', 'Ir a Facturas') + '</p>';
      return;
    }
    var html = '<div class="rejilla-2 mb-1">' +
      bloqueCifra('Por cobrar', pc.facturas.length ? fmt(pc.total) : 'Sin pendientes') +
      bloqueCifra('Vencido', pc.vencido > 0 ? fmt(pc.vencido) : 'Nada vencido', pc.vencido > 0 ? 'negativo' : 'positivo') + '</div>';
    if (pc.facturas.length) {
      html += '<p class="texto-2 mb-1">' + esc(plural(pc.facturas.length, 'factura pendiente', 'facturas pendientes')) + ' de ' + esc(plural(pc.porCliente.length, 'cliente')) + '.</p>';
      html += VF.ui.lista(pc.porCliente.slice(0, 3).map(function (c) {
        return {
          titulo: c.cliente ? c.cliente.nombre : 'Cliente eliminado',
          sub: plural(c.facturas.length, 'factura') + (c.vencido > 0 ? ' · vencido ' + fmt(c.vencido) : ''),
          valor: fmt(c.total),
          tono: c.vencido > 0 ? 'negativo' : undefined
        };
      }));
    }
    html += '<div class="fila mt-1">' + enlaceChico('facturas', 'Facturas') + enlaceChico('cobros', 'Cuentas por cobrar') + '</div>';
    el.innerHTML = html;
  }

  function extraProveedores(el, ctx) {
    var est = ctx.estado;
    var pp = VF.calc.porPagar(est);
    if (!(est.cuentasPorPagar || []).length && !(est.proveedores || []).length) {
      el.innerHTML = '<p class="texto-2 mb-1">Sin proveedores ni cuentas por pagar registradas.</p><p class="mb-0">' + enlaceChico('proveedores', 'Ir a Proveedores') + '</p>';
      return;
    }
    var html = '<div class="rejilla-2 mb-1">' +
      bloqueCifra('Por pagar', pp.cuentas.length ? fmt(pp.total) : 'Sin pendientes') +
      bloqueCifra('Vencido', pp.vencido > 0 ? fmt(pp.vencido) : 'Nada vencido', pp.vencido > 0 ? 'negativo' : 'positivo') + '</div>';
    if (pp.cuentas.length) {
      html += '<p class="texto-2 mb-1">' + esc(plural(pp.cuentas.length, 'cuenta pendiente', 'cuentas pendientes')) + ' con ' + esc(plural(pp.porProveedor.length, 'proveedor', 'proveedores')) + '.</p>';
      html += VF.ui.lista(pp.cuentas.slice(0, 3).map(function (x) {
        return {
          titulo: (x.proveedor ? x.proveedor.nombre : 'Proveedor eliminado'),
          sub: (x.cxp.concepto || 'Cuenta por pagar') + ' · vence ' + U.fmtFecha(x.fecha) + (x.vencida ? ' (vencida)' : ''),
          valor: fmt(x.pendiente),
          tono: x.vencida ? 'negativo' : undefined
        };
      }));
    }
    html += '<div class="fila mt-1">' + enlaceChico('proveedores', 'Proveedores') + enlaceChico('proveedores', 'Cuentas por pagar', { pestana: 'cxp' }) + '</div>';
    el.innerHTML = html;
  }

  function extraComisiones(el, ctx) {
    var est = ctx.estado;
    var com = VF.calc.comisionesPendientes(est);
    var todas = (est.comisiones || []).length;
    if (!todas) {
      el.innerHTML = '<p class="texto-2 mb-1">Sin comisiones registradas.</p><p class="mb-0">' + enlaceChico('proveedores', 'Ir a Comisiones', { pestana: 'comisiones' }) + '</p>';
      return;
    }
    var pagadas = (est.comisiones || []).filter(function (c) { return c && c.estado === 'pagada'; });
    var html = '<div class="rejilla-2 mb-1">' +
      bloqueCifra('Pendientes de pago', com.lista.length ? fmt(com.total) : 'Sin pendientes', com.lista.length ? 'alerta' : 'positivo') +
      bloqueCifra('Pagadas', pagadas.length ? fmt(U.suma(pagadas, function (c) { return c.monto; })) : 'Ninguna') + '</div>';
    if (com.lista.length) {
      html += VF.ui.lista(com.lista.slice(0, 3).map(function (c) {
        var f = c.facturaId ? buscar(est.facturas, c.facturaId) : null;
        return {
          titulo: c.beneficiario || 'Sin beneficiario',
          sub: (f ? 'Factura ' + f.folio + ' · ' : '') + U.fmtNumero(c.porcentaje, 1) + ' % de ' + fmt(c.base) + ' · ' + U.fmtFecha(c.fecha),
          valor: fmt(c.monto),
          tono: 'alerta'
        };
      }));
    }
    html += '<div class="fila mt-1">' + enlaceChico('proveedores', 'Ver comisiones', { pestana: 'comisiones' }) + '</div>';
    el.innerHTML = html;
  }

  var EXTRAS_EMPRESA = [
    { id: 'facturas', titulo: 'Facturas y cobros', acciones: enlaceChico('cobros', 'Ver todo'), render: extraFacturas },
    { id: 'proveedores', titulo: 'Proveedores', acciones: enlaceChico('proveedores', 'Ver todo'), render: extraProveedores },
    { id: 'comisiones', titulo: 'Comisiones', acciones: enlaceChico('proveedores', 'Ver todo', { pestana: 'comisiones' }), render: extraComisiones }
  ];

  function renderEmpresa(contenedor, params) {
    vistaAmbito(contenedor, 'empresa', { extras: EXTRAS_EMPRESA, params: params });
  }

  VF.router.registrar('empresa', { titulo: 'Empresa', icono: 'empresa', nav: 'principal', render: renderEmpresa });

  VF.empresa = {
    render: renderEmpresa,
    nuevoMovimiento: function (o) { return abrirFormularioMovimiento('empresa', o || {}); },
    nuevaCuenta: function () { return abrirFormularioCuenta('empresa', {}); }
  };
})(window.VF);
