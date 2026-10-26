'use strict';
/*
 * js/modules/facturas.js — Facturas y cuentas por cobrar (#/facturas y #/cobros) de VILLEDA Finanzas
 * (docs/ARQUITECTURA.md §4). Ámbito implícito: empresa.
 *
 *  - Clientes: CRUD en modal (nombre, RFC, correo, teléfono, notas) y detalle con sus facturas.
 *  - Facturas: CRUD en modal con folio autoincremental F-0001 (siguiente al mayor existente), IVA 16 %
 *    automático con casilla "Sin IVA", resumen en vivo (subtotal / IVA / total), estado almacenado
 *    'borrador' | 'emitida' | 'cancelada' y estado derivado con color (VF.calc.estadoFactura).
 *  - Pagos: "Registrar pago" (monto ≤ pendiente, fecha, cuenta de EMPRESA) crea un movimiento de ingreso
 *    con categoría 'Ventas' y `facturaId`, y guarda el pago en factura.pagos con su `movimientoId`.
 *    Eliminar un pago elimina también su movimiento (revierte el saldo de la cuenta).
 *  - Resumen: KPIs Por cobrar / Vencido / Cobrado este mes / Clientes y tarjeta "Antigüedad de saldos"
 *    (VF.calc.antiguedadCxC) con barras. Filtros: todas / pendientes / vencidas / pagadas / borrador,
 *    cliente, búsqueda y "Agrupar por cliente" (VF.calc.porCobrar().porCliente).
 *  - #/cobros = la misma vista con filtro "pendientes" y agrupada por cliente (acepta ?cliente=<id>).
 *    #/facturas acepta ?id=<facturaId> (abre el detalle) y ?pestana=clientes.
 *  - Integridad: eliminar un cliente con facturas muestra el error del store (CLIENTE_CON_FACTURAS) de forma
 *    amable; eliminar una factura con pagos elimina sus movimientos vinculados (regla 2.1 del store).
 *  - Toda cifra sale de VF.calc; sin registros → "Sin facturas…", nunca ceros falsos.
 *  - Se vuelve a pintar al recibir VF.store 'cambio' sólo si la ruta activa sigue siendo facturas o cobros.
 *
 * Convenciones: JavaScript clásico, textos en español, todo texto de usuario pasa por VF.util.esc,
 * eventos por delegación con data-accion="fac-…" (sin handlers inline).
 */
window.VF = window.VF || {};
(function (VF) {
  if (!VF.util || !VF.calc || !VF.ui || !VF.store || !VF.router) {
    console.error('[VF.facturas] faltan módulos del núcleo (util, calc, ui, store, router).');
    return;
  }

  var U = VF.util;
  var esc = U.esc;
  var fmt = U.fmtMXN;

  var TASA_IVA = 0.16;
  var DIAS_CREDITO = 30;              // vencimiento por defecto: emisión + 30 días
  var CATEGORIA_PAGO = 'Ventas';
  var PREFIJO_FOLIO = 'F-';
  var LARGO_FOLIO = 4;
  var MAX_CONCEPTO_TABLA = 70;
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var ESTADOS = {
    borrador: { texto: 'Borrador', badge: 'badge' },
    emitida: { texto: 'Emitida', badge: 'badge badge-info' },
    parcial: { texto: 'Pago parcial', badge: 'badge badge-alerta' },
    vencida: { texto: 'Vencida', badge: 'badge badge-negativo' },
    pagada: { texto: 'Pagada', badge: 'badge badge-positivo' },
    cancelada: { texto: 'Cancelada', badge: 'badge' }
  };
  var FILTROS = [
    { valor: 'todas', texto: 'Todas' },
    { valor: 'pendientes', texto: 'Pendientes' },
    { valor: 'vencidas', texto: 'Vencidas' },
    { valor: 'pagadas', texto: 'Pagadas' },
    { valor: 'borrador', texto: 'Borrador' }
  ];
  var TRAMOS = [
    { clave: '0-30', texto: 'Vigente y 0–30 días', tono: '' },
    { clave: '31-60', texto: '31–60 días', tono: 'alerta' },
    { clave: '61-90', texto: '61–90 días', tono: 'alerta' },
    { clave: '90+', texto: 'Más de 90 días', tono: 'negativo' }
  ];
  var MENSAJES_ERROR = {
    CLIENTE_CON_FACTURAS: 'No se puede eliminar: el cliente tiene facturas registradas. Elimina o reasigna sus facturas primero.',
    BLOQUEADO: 'La bóveda está bloqueada. Desbloquéala para continuar.',
    ID_DUPLICADO: 'Ya existe un registro con ese identificador.',
    REGISTRO_INVALIDO: 'Los datos del registro no son válidos.',
    COLECCION_INVALIDA: 'Colección desconocida.',
    AMBITO_INVALIDO: 'El ámbito del registro no es válido.',
    FACTURA_INEXISTENTE: 'La factura ya no existe.',
    CLIENTE_INEXISTENTE: 'El cliente ya no existe.',
    PAGO_INEXISTENTE: 'El pago ya no existe.',
    FACTURA_NO_COBRABLE: 'Esta factura no admite pagos (está en borrador, cancelada o ya pagada).',
    MONTO_INVALIDO: 'Ingresa un monto mayor a cero.',
    MONTO_MAYOR_AL_PENDIENTE: 'El monto no puede ser mayor al saldo pendiente de la factura.',
    CUENTA_EMPRESA_REQUERIDA: 'Elige una cuenta de empresa activa para recibir el pago.'
  };

  // Estado de la vista activa: { ruta, filtro, agrupar, busqueda, clienteId, pestana }
  var vista = null;
  // Modales de detalle abiertos (se refrescan al recibir 'cambio'): { factura:{id, api}, cliente:{id, api} }
  var abiertos = { factura: null, cliente: null };
  var temporizadorCambio = null;

  /* ---------- auxiliares privados ------------------------------------------ */
  function estado() { return VF.store.estaDesbloqueado() ? VF.store.estado() : null; }
  function hoy() { return VF.calc.hoy(); }
  function toast(mensaje, tipo, ms) { if (VF.ui.toast) VF.ui.toast(mensaje, tipo, ms); }

  function capitalizar(s) {
    s = String(s == null ? '' : s);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function plural(n, singular, pluralTexto) {
    return n + ' ' + (n === 1 ? singular : (pluralTexto || singular + 's'));
  }
  function recortar(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  }
  function mesLargo(iso) {
    var d = U.parseFecha(iso);
    if (isNaN(d.getTime())) return '';
    return MESES_LARGOS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function buscar(arr, id) {
    arr = arr || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }
  function nombreCliente(est, id) {
    var c = buscar(est.clientes, id);
    return c ? c.nombre : 'Cliente eliminado';
  }
  function nombreCuenta(est, id) {
    var c = buscar(est.cuentas, id);
    return c ? c.nombre + (c.banco ? ' · ' + c.banco : '') : 'Cuenta eliminada';
  }
  function cuentasEmpresa(est) {
    return (est.cuentas || []).filter(function (c) { return c && c.ambito === 'empresa' && c.activa !== false; });
  }
  function nombreEmpresa(est) {
    return (est && est.ajustes && est.ajustes.nombreEmpresa) || 'la empresa';
  }
  function mensajeError(e) {
    var codigo = e && e.message ? e.message : String(e);
    return MENSAJES_ERROR[codigo] || ('Ocurrió un error: ' + codigo);
  }
  function esRutaActiva() {
    var r = VF.router.actual().ruta;
    return r === 'facturas' || r === 'cobros';
  }
  function filaCifra(etiqueta, valorHtml, clase) {
    return '<div class="fila-entre mb-1"><span class="texto-2">' + esc(etiqueta) + '</span>' +
      '<span class="derecha ' + esc(clase || '') + '">' + valorHtml + '</span></div>';
  }
  function accion(nombre, id, extra) {
    return 'data-accion="' + esc(nombre) + '"' + (id != null ? ' data-id="' + esc(id) + '"' : '') + (extra || '');
  }
  /** Agrupa dos o más .campo consecutivos del formulario en una .form-fila (2 columnas ≥560 px). */
  function agruparCampos(form, nombres) {
    var conts = nombres.map(function (n) { return form.querySelector('[data-campo-cont="' + n + '"]'); }).filter(Boolean);
    if (conts.length < 2) return;
    var fila = document.createElement('div');
    fila.className = 'form-fila';
    conts[0].parentNode.insertBefore(fila, conts[0]);
    conts.forEach(function (c) { fila.appendChild(c); });
  }
  /** Cierra los modales abiertos y ejecuta fn tras la animación (para abrir otro modal "en limpio"). */
  function trasCerrarModales(fn) {
    VF.ui.cerrarModales();
    setTimeout(fn, 60);
  }

  /* ---------- cálculo de facturas (sobre VF.calc) ---------------------------- */
  function estadoDe(f) { return VF.calc.estadoFactura(f, hoy()); }
  function pendienteDe(f) { return VF.calc.pendienteFactura(f); }
  function pagadoDe(f) { return VF.calc.pagadoFactura(f); }
  function cobrable(f) {
    return !!f && f.estado !== 'cancelada' && f.estado !== 'borrador' && pendienteDe(f) > 0;
  }
  function estaVencida(f) {
    return cobrable(f) && !!f.fechaVencimiento && f.fechaVencimiento < hoy();
  }
  function badgeEstado(e) {
    var d = ESTADOS[e] || ESTADOS.emitida;
    return '<span class="' + d.badge + '">' + esc(d.texto) + '</span>';
  }

  /** { subtotal, iva, total } con round2; sinIva → iva 0. */
  function calcularImportes(subtotal, sinIva) {
    var s = U.round2(Number(subtotal) || 0);
    var iva = sinIva ? 0 : U.round2(s * TASA_IVA);
    return { subtotal: s, iva: iva, total: U.round2(s + iva) };
  }

  /** Folio siguiente al mayor existente con forma F-#### (F-0001 si no hay). */
  function siguienteFolio(est) {
    var mayor = 0;
    var re = /^F-(\d+)$/i;
    (est.facturas || []).forEach(function (f) {
      var m = re.exec(String(f.folio || '').trim());
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > mayor) mayor = n;
      }
    });
    var s = String(mayor + 1);
    while (s.length < LARGO_FOLIO) s = '0' + s;
    return PREFIJO_FOLIO + s;
  }

  /* ---------- operaciones sobre el store ------------------------------------ */
  /**
   * Registra un pago: crea el movimiento de ingreso (categoría Ventas, facturaId) en la cuenta de EMPRESA y
   * guarda el pago en factura.pagos con movimientoId. → pago. Lanza Error con código (ver MENSAJES_ERROR).
   */
  function registrarPago(facturaId, datos) {
    var est = estado();
    if (!est) throw new Error('BLOQUEADO');
    var f = buscar(est.facturas, facturaId);
    if (!f) throw new Error('FACTURA_INEXISTENTE');
    if (!cobrable(f)) throw new Error('FACTURA_NO_COBRABLE');
    var d = datos || {};
    var monto = U.round2(d.monto);
    var pendiente = pendienteDe(f);
    if (!(monto > 0)) throw new Error('MONTO_INVALIDO');
    if (monto > pendiente + 0.001) throw new Error('MONTO_MAYOR_AL_PENDIENTE');
    var cuenta = buscar(est.cuentas, d.cuentaId);
    if (!cuenta || cuenta.ambito !== 'empresa' || cuenta.activa === false) throw new Error('CUENTA_EMPRESA_REQUERIDA');
    var cliente = buscar(est.clientes, f.clienteId);
    var fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : hoy();
    var mov = VF.store.agregar('movimientos', {
      ambito: 'empresa',
      cuentaId: cuenta.id,
      tipo: 'ingreso',
      monto: monto,
      fecha: fecha,
      categoria: CATEGORIA_PAGO,
      descripcion: 'Pago de factura ' + f.folio + (f.concepto ? ' — ' + f.concepto : ''),
      contraparte: cliente ? cliente.nombre : '',
      cuentaDestinoId: null,
      facturaId: f.id,
      cxpId: null,
      prestamoId: null,
      comisionId: null,
      estado: 'confirmado',
      etiquetas: []
    });
    var pago = { id: U.uid('pago'), fecha: fecha, monto: monto, cuentaId: cuenta.id, movimientoId: mov.id };
    VF.store.actualizar('facturas', f.id, { pagos: (f.pagos || []).concat([pago]) });
    return pago;
  }

  /** Elimina un pago y su movimiento vinculado (revierte el saldo de la cuenta). → true */
  function eliminarPago(facturaId, pagoId) {
    var est = estado();
    if (!est) throw new Error('BLOQUEADO');
    var f = buscar(est.facturas, facturaId);
    if (!f) throw new Error('FACTURA_INEXISTENTE');
    var pago = buscar(f.pagos || [], pagoId);
    if (!pago) throw new Error('PAGO_INEXISTENTE');
    if (pago.movimientoId && buscar(est.movimientos, pago.movimientoId)) {
      VF.store.eliminar('movimientos', pago.movimientoId);
    }
    VF.store.actualizar('facturas', f.id, { pagos: (f.pagos || []).filter(function (p) { return p.id !== pagoId; }) });
    return true;
  }

  /* ---------- render de la ruta -------------------------------------------- */
  function render(contenedor, params) {
    var p = params || {};
    var ruta = VF.router.actual().ruta === 'cobros' ? 'cobros' : 'facturas';
    var esCobros = ruta === 'cobros';
    var filtroValido = FILTROS.some(function (x) { return x.valor === p.filtro; });
    vista = {
      ruta: ruta,
      filtro: esCobros ? 'pendientes' : (filtroValido ? p.filtro : 'todas'),
      agrupar: esCobros,
      busqueda: '',
      clienteId: p.cliente || '',
      pestana: p.pestana === 'clientes' && !esCobros ? 'clientes' : 'facturas'
    };
    VF.ui.ambitoActivo('empresa');
    contenedor.innerHTML = cabecera(estado(), esCobros) + '<div id="fac-cuerpo"></div>';
    pintarCuerpo();
    if (p.id) setTimeout(function () { abrirDetalle(p.id); }, 0);
  }

  function cabecera(est, esCobros) {
    var sub = esCobros
      ? 'Facturas pendientes de cobro, agrupadas por cliente.'
      : 'Clientes, facturas emitidas y pagos recibidos de ' + nombreEmpresa(est) + '.';
    return '<div class="vista-cabecera">' +
      '<div><h1>' + (esCobros ? 'Cuentas por cobrar' : 'Facturas y cobros') + '</h1>' +
      '<p class="texto-2 mb-0">' + esc(sub) + '</p></div>' +
      '<div class="vista-acciones">' +
      (esCobros
        ? '<a class="btn btn-secundario" href="#/facturas">' + VF.ui.icono('facturas') + '<span>Todas las facturas</span></a>'
        : '<button type="button" class="btn btn-secundario" ' + accion('fac-nuevo-cliente') + '>' + VF.ui.icono('personal') + '<span>Cliente</span></button>') +
      '<button type="button" class="btn btn-primario" ' + accion('fac-nueva-factura') + '>' + VF.ui.icono('agregar') + '<span>Factura</span></button>' +
      '</div></div>';
  }

  function pintarCuerpo() {
    var cuerpo = document.getElementById('fac-cuerpo');
    var est = estado();
    if (!cuerpo || !est || !vista) return;
    if (!(est.facturas || []).length && !(est.clientes || []).length) {
      cuerpo.innerHTML = '<div class="tarjeta">' +
        VF.ui.vacio('Sin facturas ni clientes. Registra tu primer cliente para empezar a facturar.', 'Nuevo cliente', function () {
          abrirFormularioCliente();
        }) + '</div>';
      return;
    }
    var html = kpis(est) + tarjetaAntiguedad(est);
    if (vista.ruta === 'facturas') html += pestanas();
    html += '<div id="fac-seccion">' + seccion(est) + '</div>';
    cuerpo.innerHTML = html;
  }

  function pintarSeccion() {
    var el = document.getElementById('fac-seccion');
    var est = estado();
    if (!el || !est || !vista) return;
    el.innerHTML = seccion(est);
  }

  /** Vuelve a pintar sólo la lista de facturas (los filtros conservan el foco). */
  function pintarLista() {
    var el = document.getElementById('fac-lista');
    var est = estado();
    if (!el || !est || !vista) return;
    el.innerHTML = listaFacturas(est);
  }

  function seccion(est) {
    return vista.pestana === 'clientes' ? seccionClientes(est) : seccionFacturas(est);
  }

  /* ---------- KPIs y antigüedad -------------------------------------------- */
  function kpis(est) {
    var pc = VF.calc.porCobrar(est);
    var h = hoy();
    var cobrosMes = VF.calc.movimientosEn(est, 'empresa', U.inicioMes(h), U.finMes(h), { tipo: 'ingreso' })
      .filter(function (m) { return !!m.facturaId; });
    var cobradoMes = U.suma(cobrosMes, function (m) { return m.monto; });
    var hayPend = pc.facturas.length > 0;
    var clientes = est.clientes || [];
    var html = '<div class="kpis">';
    html += VF.ui.kpi({
      titulo: 'Por cobrar',
      valor: hayPend ? fmt(pc.total) : 'Sin pendientes',
      sub: hayPend ? plural(pc.facturas.length, 'factura pendiente', 'facturas pendientes') + ' · ' + plural(pc.porCliente.length, 'cliente') : 'No hay facturas con saldo pendiente',
      tono: 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Vencido',
      valor: pc.vencido > 0 ? fmt(pc.vencido) : 'Sin vencidos',
      sub: pc.vencido > 0
        ? plural(pc.facturas.filter(function (x) { return x.vencida; }).length, 'factura vencida', 'facturas vencidas')
        : (hayPend ? 'Todo el saldo está vigente' : 'Nada por cobrar'),
      tono: pc.vencido > 0 ? 'negativo' : (hayPend ? 'positivo' : 'neutro')
    });
    html += VF.ui.kpi({
      titulo: 'Cobrado este mes',
      valor: cobrosMes.length ? fmt(cobradoMes) : 'Sin cobros',
      sub: cobrosMes.length ? plural(cobrosMes.length, 'pago de factura', 'pagos de factura') + ' · ' + mesLargo(h) : 'Ningún pago de factura en ' + mesLargo(h),
      tono: 'neutro'
    });
    html += VF.ui.kpi({
      titulo: 'Clientes',
      valor: clientes.length ? String(clientes.length) : 'Sin clientes',
      sub: clientes.length ? plural(pc.porCliente.length, 'cliente con saldo pendiente', 'clientes con saldo pendiente') : 'Registra tu primer cliente',
      tono: 'neutro'
    });
    return html + '</div>';
  }

  function tarjetaAntiguedad(est) {
    var pc = VF.calc.porCobrar(est);
    var ant = VF.calc.antiguedadCxC(est);
    var cuerpo;
    if (!(pc.total > 0)) {
      cuerpo = '<p class="texto-2 mb-0">Sin saldo por cobrar. Cuando haya facturas pendientes verás aquí cuánto tiempo llevan vencidas.</p>';
    } else {
      cuerpo = '<div class="rejilla-4">' + TRAMOS.map(function (t) {
        var monto = U.round2(ant[t.clave] || 0);
        var pct = pc.total > 0 ? monto / pc.total * 100 : 0;
        var hay = monto > 0;
        return '<div class="tarjeta-cuerpo">' +
          '<div class="fila-entre mb-1"><span class="texto-2">' + esc(t.texto) + '</span>' +
          '<strong class="cifra ' + (hay ? esc(t.tono) : 'texto-3') + '">' + esc(hay ? fmt(monto) : '—') + '</strong></div>' +
          VF.ui.barraProgreso(pct, hay && t.tono ? t.tono : undefined) +
          '<p class="texto-3 mt-1 mb-0">' + esc(hay ? U.fmtNumero(pct, 0) + ' % del saldo por cobrar' : 'Sin saldo en este tramo') + '</p>' +
          '</div>';
      }).join('') + '</div>';
    }
    return VF.ui.tarjeta({
      titulo: 'Antigüedad de saldos',
      acciones: '<span class="texto-3">Días desde el vencimiento</span>',
      cuerpo: cuerpo
    });
  }

  /* ---------- pestañas (sólo #/facturas) ----------------------------------- */
  function pestanas() {
    var defs = [['facturas', 'Facturas'], ['clientes', 'Clientes']];
    return '<div class="pestanas" role="tablist" aria-label="Secciones">' + defs.map(function (p) {
      var sel = vista.pestana === p[0];
      return '<button type="button" class="pestana" role="tab" aria-selected="' + (sel ? 'true' : 'false') + '" ' +
        accion('fac-pestana', null, ' data-valor="' + p[0] + '"') + '>' + esc(p[1]) + '</button>';
    }).join('') + '</div>';
  }

  function cambiarPestana(valor) {
    if (!vista || (valor !== 'facturas' && valor !== 'clientes')) return;
    vista.pestana = valor;
    Array.prototype.forEach.call(document.querySelectorAll('#fac-cuerpo .pestana'), function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-valor') === valor ? 'true' : 'false');
    });
    if (/^#\/facturas\?/.test(location.hash)) {
      try { history.replaceState(null, '', '#/facturas'); } catch (e) { /* file:// en algunos navegadores */ }
    }
    pintarSeccion();
  }

  /* ---------- sección: facturas -------------------------------------------- */
  function seccionFacturas(est) {
    return filtrosHTML(est) + '<div id="fac-lista">' + listaFacturas(est) + '</div>';
  }

  function botonAgrupar(activo) {
    return '<button type="button" class="btn ' + (activo ? 'btn-primario' : 'btn-secundario') + ' btn-chico" ' +
      accion('fac-agrupar') + ' aria-pressed="' + (activo ? 'true' : 'false') + '">' + VF.ui.icono('personal') + '<span>Agrupar por cliente</span></button>';
  }

  function filtrosHTML(est) {
    var clientes = U.ordenar(est.clientes || [], 'nombre');
    var html = '<div class="fila-entre mb-1">' +
      VF.ui.segmentos(FILTROS, vista.filtro, function (valor) {
        if (!vista) return;
        vista.filtro = FILTROS.some(function (x) { return x.valor === valor; }) ? valor : 'todas';
        pintarLista();
      }) +
      botonAgrupar(vista.agrupar) +
      '</div>';
    html += '<div class="filtros">' +
      '<div class="campo"><label class="sr-solo" for="fac-filtro-cliente">Cliente</label>' +
      '<select id="fac-filtro-cliente" data-filtro="clienteId"><option value="">Todos los clientes</option>' +
      clientes.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === vista.clienteId ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="campo"><label class="sr-solo" for="fac-filtro-busqueda">Buscar</label>' +
      '<input type="search" id="fac-filtro-busqueda" data-filtro="busqueda" value="' + esc(vista.busqueda) + '" placeholder="Buscar folio, cliente o concepto…" autocomplete="off"></div>' +
      '</div>';
    return html;
  }

  function facturasFiltradas(est) {
    var h = hoy();
    var q = U.normalizar(vista.busqueda);
    var lista = (est.facturas || []).filter(function (f) {
      if (!f) return false;
      switch (vista.filtro) {
        case 'pendientes': if (!cobrable(f)) return false; break;
        case 'vencidas': if (!estaVencida(f)) return false; break;
        case 'pagadas': if (VF.calc.estadoFactura(f, h) !== 'pagada') return false; break;
        case 'borrador': if (f.estado !== 'borrador') return false; break;
        default: break;
      }
      if (vista.clienteId && f.clienteId !== vista.clienteId) return false;
      if (q) {
        var texto = U.normalizar([f.folio, f.concepto, nombreCliente(est, f.clienteId), f.uuidCfdi, f.total].join(' '));
        if (texto.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (vista.filtro === 'pendientes' || vista.filtro === 'vencidas') {
      lista.sort(function (a, b) {
        var va = a.fechaVencimiento || '', vb = b.fechaVencimiento || '';
        if (va !== vb) return va < vb ? -1 : 1;
        return String(a.folio).localeCompare(String(b.folio), 'es-MX', { numeric: true });
      });
    } else {
      lista.sort(function (a, b) {
        var ea = a.fechaEmision || '', eb = b.fechaEmision || '';
        if (ea !== eb) return ea < eb ? 1 : -1;
        return String(b.folio).localeCompare(String(a.folio), 'es-MX', { numeric: true });
      });
    }
    return lista;
  }

  /**
   * Celda de varias líneas. En móvil VF.ui.tabla vuelve cada <td> un contenedor flex (tarjeta con etiqueta), y
   * sus hijos directos (strong, <br>, small) se convertirían en flex items separados: el folio se partiría en
   * "F-" / "0008", el concepto quedaría como columna y un span.truncar se volvería bloque con elipsis. Un único
   * <div> envolvente mantiene las líneas juntas en ambos modos.
   */
  function celda(html) {
    return '<div>' + html + '</div>';
  }
  /** Botones de acción de una celda: el <span> vacío inicial los empuja a la derecha en la tarjeta móvil. */
  function celdaAcciones(botones) {
    return '<span></span><span class="truncar">' + botones + '</span>';
  }

  /**
   * Columnas de la tabla de facturas. opciones: { sinCliente (grupos por cliente), compacta (tablas dentro de un
   * modal de 560 px: el vencimiento va bajo el folio y no hay columna "Fechas") }.
   */
  function columnasFacturas(est, opciones) {
    var o = opciones || {};
    var cols = [
      { clave: 'folio', titulo: 'Folio', render: function (v, f) {
        var venc = estaVencida(f);
        return celda('<strong>' + esc(v) + '</strong>' +
          (f.concepto ? '<br><small class="texto-2">' + esc(recortar(f.concepto, o.compacta ? 40 : MAX_CONCEPTO_TABLA)) + '</small>' : '') +
          (o.compacta ? '<br><small class="' + (venc ? 'negativo' : 'texto-3') + '">Vence ' + esc(U.fmtFecha(f.fechaVencimiento)) + '</small>' : ''));
      } }
    ];
    if (!o.sinCliente) {
      cols.push({ clave: 'clienteId', titulo: 'Cliente', render: function (v) { return esc(nombreCliente(est, v)); } });
    }
    if (!o.compacta) {
      cols.push({ clave: 'fechaVencimiento', titulo: 'Fechas', render: function (v, f) {
        var venc = estaVencida(f);
        var rel = cobrable(f) && v ? ' · ' + capitalizar(VF.ui.fechaRelativa(v)) : '';
        return celda('Emitida ' + esc(U.fmtFecha(f.fechaEmision)) + '<br>' +
          '<small class="' + (venc ? 'negativo' : 'texto-2') + '">Vence ' + esc(U.fmtFecha(v)) + esc(rel) + '</small>');
      } });
    }
    cols.push({ clave: 'total', titulo: 'Total', alinear: 'derecha', render: function (v) { return '<span class="cifra">' + esc(fmt(v)) + '</span>'; } });
    cols.push({ clave: 'id', titulo: 'Pendiente', alinear: 'derecha', render: function (v, f) {
      if (!cobrable(f)) return '<span class="texto-3">—</span>';
      return '<strong class="cifra ' + (estaVencida(f) ? 'negativo' : '') + '">' + esc(fmt(pendienteDe(f))) + '</strong>';
    } });
    cols.push({ clave: 'estado', titulo: 'Estado', render: function (v, f) { return badgeEstado(estadoDe(f)); } });
    return cols;
  }

  function tablaFacturas(est, lista, opciones, vacioTexto) {
    return VF.ui.tabla({
      columnas: columnasFacturas(est, opciones),
      filas: lista,
      vacio: vacioTexto || 'Sin facturas',
      onFila: function (id, tr) {
        if (tr && tr.closest('.modal')) trasCerrarModales(function () { abrirDetalle(id); });
        else abrirDetalle(id);
      }
    });
  }

  function textoVacioLista() {
    if (vista.busqueda || vista.clienteId) return 'Sin facturas que coincidan con los filtros';
    switch (vista.filtro) {
      case 'pendientes': return 'Sin facturas pendientes de cobro';
      case 'vencidas': return 'Sin facturas vencidas';
      case 'pagadas': return 'Sin facturas pagadas';
      case 'borrador': return 'Sin facturas en borrador';
      default: return 'Sin facturas registradas';
    }
  }

  function resumenLista(lista) {
    var n = lista.length;
    var cobrables = lista.filter(cobrable);
    var pend = U.suma(cobrables, pendienteDe);
    var venc = U.suma(cobrables.filter(estaVencida), pendienteDe);
    var html = '<p class="texto-2 mb-1">' + esc(plural(n, 'factura')) +
      (cobrables.length ? ' · pendiente <strong class="cifra">' + esc(fmt(pend)) + '</strong>' : '') +
      (venc > 0 ? ' · <span class="negativo">vencido <strong class="cifra">' + esc(fmt(venc)) + '</strong></span>' : '') +
      ((vista.busqueda || vista.clienteId) ? ' <button type="button" class="btn btn-enlace btn-chico" ' + accion('fac-limpiar-filtros') + '>Limpiar filtros</button>' : '') +
      '</p>';
    return html;
  }

  function listaFacturas(est) {
    var lista = facturasFiltradas(est);
    if (!(est.facturas || []).length) {
      return '<div class="tarjeta">' + VF.ui.vacio('Sin facturas registradas. Crea la primera para empezar a llevar tus cuentas por cobrar.', 'Nueva factura', function () {
        abrirFormularioFactura({});
      }) + '</div>';
    }
    if (!lista.length) {
      return '<div class="tarjeta">' + VF.ui.vacio(textoVacioLista()) +
        ((vista.busqueda || vista.clienteId) ? '<p class="centro mb-0"><button type="button" class="btn btn-secundario btn-chico" ' + accion('fac-limpiar-filtros') + '>Limpiar filtros</button></p>' : '') +
        '</div>';
    }
    if (vista.agrupar) return listaAgrupada(est, lista);
    return VF.ui.tarjeta({ titulo: 'Facturas', acciones: resumenLista(lista), cuerpo: tablaFacturas(est, lista, {}, textoVacioLista()) });
  }

  /** Grupos por cliente: con filtro "pendientes" se toman de VF.calc.porCobrar().porCliente (orden por total). */
  function gruposDe(est, lista) {
    var ids = {};
    lista.forEach(function (f) { ids[f.id] = true; });
    var grupos = [];
    if (vista.filtro === 'pendientes') {
      VF.calc.porCobrar(est).porCliente.forEach(function (c) {
        var fs = c.facturas.filter(function (x) { return ids[x.factura.id]; }).map(function (x) { return x.factura; });
        if (!fs.length) return;
        grupos.push({ clienteId: c.clienteId, facturas: fs, pendiente: U.suma(fs, pendienteDe), vencido: U.suma(fs.filter(estaVencida), pendienteDe), total: c.total, vencidoCliente: c.vencido });
      });
      return grupos;
    }
    var porCliente = U.agrupar(lista, 'clienteId');
    Object.keys(porCliente).forEach(function (cid) {
      var fs = porCliente[cid];
      var cobrables = fs.filter(cobrable);
      grupos.push({ clienteId: cid, facturas: fs, pendiente: U.suma(cobrables, pendienteDe), vencido: U.suma(cobrables.filter(estaVencida), pendienteDe) });
    });
    grupos.sort(function (a, b) {
      if (a.pendiente !== b.pendiente) return b.pendiente - a.pendiente;
      return nombreCliente(est, a.clienteId).localeCompare(nombreCliente(est, b.clienteId), 'es-MX');
    });
    return grupos;
  }

  function listaAgrupada(est, lista) {
    var grupos = gruposDe(est, lista);
    var html = '<div class="mb-1">' + resumenLista(lista) + '</div>';
    grupos.forEach(function (g) {
      var acciones = '<span class="fila">' +
        (g.vencido > 0 ? '<span class="badge badge-negativo">Vencido ' + esc(fmt(g.vencido)) + '</span>' : '') +
        (g.pendiente > 0 ? '<strong class="cifra">' + esc(fmt(g.pendiente)) + '</strong>' : '<span class="badge badge-positivo">Sin saldo</span>') +
        '<button type="button" class="btn btn-fantasma btn-chico" ' + accion('fac-ver-cliente', g.clienteId) + '>Ver cliente</button>' +
        '</span>';
      html += VF.ui.tarjeta({
        titulo: nombreCliente(est, g.clienteId),
        acciones: acciones,
        cuerpo: '<p class="texto-3 mb-1">' + esc(plural(g.facturas.length, 'factura')) + '</p>' + tablaFacturas(est, g.facturas, { sinCliente: true })
      });
    });
    return html;
  }

  /* ---------- sección: clientes -------------------------------------------- */
  function seccionClientes(est) {
    var clientes = U.ordenar(est.clientes || [], 'nombre');
    var pc = VF.calc.porCobrar(est);
    var saldo = {};
    pc.porCliente.forEach(function (c) { saldo[c.clienteId] = c; });
    var filas = clientes.map(function (c) {
      var fs = (est.facturas || []).filter(function (f) { return f.clienteId === c.id; });
      var s = saldo[c.id];
      return {
        id: c.id, nombre: c.nombre, rfc: c.rfc || '',
        contacto: [c.email, c.telefono].filter(Boolean).join(' · '),
        facturas: fs.length,
        pendiente: s ? s.total : 0,
        vencido: s ? s.vencido : 0
      };
    });
    var cuerpo;
    if (!clientes.length) {
      cuerpo = VF.ui.vacio('Sin clientes registrados', 'Nuevo cliente', function () { abrirFormularioCliente(); });
    } else {
      cuerpo = VF.ui.tabla({
        columnas: [
          { clave: 'nombre', titulo: 'Cliente', render: function (v, fila) {
            return celda('<strong>' + esc(v) + '</strong>' + (fila.rfc ? '<br><small class="texto-2">RFC ' + esc(fila.rfc) + '</small>' : ''));
          } },
          { clave: 'contacto', titulo: 'Contacto', render: function (v) { return v ? esc(v) : '<span class="texto-3">—</span>'; } },
          { clave: 'facturas', titulo: 'Facturas', alinear: 'derecha', render: function (v) { return v ? '<span class="cifra">' + v + '</span>' : '<span class="texto-3">Ninguna</span>'; } },
          { clave: 'pendiente', titulo: 'Por cobrar', alinear: 'derecha', render: function (v, fila) {
            if (!(v > 0)) return '<span class="texto-3">Sin saldo</span>';
            return celda('<strong class="cifra">' + esc(fmt(v)) + '</strong>' +
              (fila.vencido > 0 ? '<br><small class="negativo">Vencido ' + esc(fmt(fila.vencido)) + '</small>' : ''));
          } },
          { clave: 'id', titulo: '', alinear: 'derecha', render: function (id, fila) {
            return celdaAcciones(
              '<button type="button" class="btn btn-icono" aria-label="Editar cliente ' + esc(fila.nombre) + '" title="Editar" ' + accion('fac-editar-cliente', id) + '>' + VF.ui.icono('editar') + '</button> ' +
              '<button type="button" class="btn btn-icono" aria-label="Eliminar cliente ' + esc(fila.nombre) + '" title="Eliminar" ' + accion('fac-eliminar-cliente', id) + '>' + VF.ui.icono('eliminar') + '</button>');
          } }
        ],
        filas: filas,
        vacio: 'Sin clientes registrados',
        onFila: function (id) { abrirDetalleCliente(id); }
      });
    }
    return VF.ui.tarjeta({
      titulo: 'Clientes',
      acciones: '<span class="fila"><span class="texto-3">' + esc(plural(clientes.length, 'cliente')) + '</span>' +
        '<button type="button" class="btn btn-secundario btn-chico" ' + accion('fac-nuevo-cliente') + '>' + VF.ui.icono('agregar') + '<span>Nuevo cliente</span></button></span>',
      cuerpo: cuerpo
    });
  }

  /* ---------- modal: detalle de factura ------------------------------------ */
  function cuerpoDetalle(est, f) {
    var e = estadoDe(f);
    var pagado = pagadoDe(f);
    var pendiente = pendienteDe(f);
    var venc = estaVencida(f);
    var pagos = (f.pagos || []).slice().sort(function (a, b) { return (a.fecha || '') < (b.fecha || '') ? -1 : (a.fecha || '') > (b.fecha || '') ? 1 : 0; });
    var pct = f.total > 0 ? Math.min(100, pagado / f.total * 100) : 0;
    var html = '<p class="hero-cifra cifra mb-0">' + esc(fmt(f.total)) + '</p>' +
      '<p class="fila mb-2">' + badgeEstado(e) + VF.ui.badgeAmbito('empresa') +
      (f.uuidCfdi ? '<span class="badge badge-neutro">CFDI</span>' : '') + '</p>';

    html += filaCifra('Cliente', '<button type="button" class="btn btn-enlace btn-chico" ' + accion('fac-ver-cliente', f.clienteId) + '>' + esc(nombreCliente(est, f.clienteId)) + '</button>');
    html += filaCifra('Concepto', esc(f.concepto || '—'));
    html += filaCifra('Emisión', esc(U.fmtFecha(f.fechaEmision)));
    html += filaCifra('Vencimiento', esc(U.fmtFecha(f.fechaVencimiento)) +
      (f.fechaVencimiento && e !== 'pagada' && e !== 'cancelada' ? ' <small class="' + (venc ? 'negativo' : 'texto-3') + '">' + esc(capitalizar(VF.ui.fechaRelativa(f.fechaVencimiento))) + '</small>' : ''));
    html += '<hr>';
    html += filaCifra('Subtotal', '<span class="cifra">' + esc(fmt(f.subtotal)) + '</span>');
    html += filaCifra(f.iva > 0 ? 'IVA 16 %' : 'IVA', f.iva > 0 ? '<span class="cifra">' + esc(fmt(f.iva)) + '</span>' : '<span class="texto-3">Sin IVA</span>');
    html += filaCifra('Total', '<strong class="cifra">' + esc(fmt(f.total)) + '</strong>');
    if (f.estado !== 'borrador' && f.estado !== 'cancelada') {
      html += filaCifra('Pagado', '<span class="cifra ' + (pagado > 0 ? 'positivo' : '') + '">' + esc(pagado > 0 ? fmt(pagado) : 'Sin pagos') + '</span>');
      html += filaCifra('Pendiente', '<strong class="cifra ' + (pendiente > 0 ? (venc ? 'negativo' : '') : 'positivo') + '">' + esc(pendiente > 0 ? fmt(pendiente) : 'Liquidada') + '</strong>');
      html += VF.ui.barraProgreso(pct, pendiente <= 0 ? 'positivo' : (venc ? 'negativo' : undefined));
      html += '<p class="texto-3 mt-1">' + esc(U.fmtNumero(pct, 0) + ' % cobrado') + '</p>';
    }
    if (f.uuidCfdi) html += filaCifra('UUID CFDI', '<small class="cifra">' + esc(f.uuidCfdi) + '</small>');
    if (f.notas) html += '<p class="aviso mt-1 mb-1"><strong>Notas:</strong> ' + esc(f.notas) + '</p>';

    // Historial de pagos
    html += '<h3 class="mt-2">Pagos</h3>';
    if (!pagos.length) {
      html += '<p class="texto-2">' + (f.estado === 'borrador' ? 'Emite la factura para poder registrar pagos.' : f.estado === 'cancelada' ? 'Factura cancelada: sin pagos.' : 'Sin pagos registrados.') + '</p>';
    } else {
      html += VF.ui.tabla({
        columnas: [
          { clave: 'fecha', titulo: 'Fecha', render: function (v) { return esc(U.fmtFecha(v)); } },
          { clave: 'cuentaId', titulo: 'Cuenta', render: function (v) { return esc(nombreCuenta(est, v)); } },
          { clave: 'monto', titulo: 'Monto', alinear: 'derecha', render: function (v) { return '<strong class="cifra positivo">' + esc('+' + fmt(v)) + '</strong>'; } },
          { clave: 'id', titulo: '', alinear: 'derecha', render: function (id, p) {
            var mov = p.movimientoId ? buscar(est.movimientos, p.movimientoId) : null;
            // .truncar (white-space: nowrap) evita que los dos botones se apilen en celdas angostas.
            return celdaAcciones(
              (mov ? '<button type="button" class="btn btn-icono" aria-label="Ver movimiento del pago" title="Ver movimiento" ' + accion('fac-ver-movimiento', mov.id) + '>' + VF.ui.icono('ojo') + '</button> ' : '') +
              '<button type="button" class="btn btn-icono" aria-label="Eliminar pago" title="Eliminar pago" ' + accion('fac-eliminar-pago', f.id, ' data-pago="' + esc(id) + '"') + '>' + VF.ui.icono('eliminar') + '</button>');
          } }
        ],
        filas: pagos,
        vacio: 'Sin pagos'
      });
    }

    // Acciones (van en el cuerpo para que se refresquen con el estado)
    var botones = '';
    if (cobrable(f)) botones += '<button type="button" class="btn btn-primario" ' + accion('fac-registrar-pago', f.id) + '>' + VF.ui.icono('pago') + '<span>Registrar pago</span></button>';
    if (f.estado === 'borrador') botones += '<button type="button" class="btn btn-primario" ' + accion('fac-emitir-factura', f.id) + '>' + VF.ui.icono('enviar') + '<span>Emitir</span></button>';
    if (f.estado !== 'cancelada') botones += '<button type="button" class="btn btn-secundario" ' + accion('fac-editar-factura', f.id) + '>' + VF.ui.icono('editar') + '<span>Editar</span></button>';
    if (f.estado === 'emitida') botones += '<button type="button" class="btn btn-fantasma" ' + accion('fac-cancelar-factura', f.id) + '>Cancelar factura</button>';
    if (f.estado === 'cancelada') botones += '<button type="button" class="btn btn-secundario" ' + accion('fac-reactivar-factura', f.id) + '>' + VF.ui.icono('refrescar') + '<span>Reactivar</span></button>';
    botones += '<button type="button" class="btn btn-fantasma negativo" ' + accion('fac-eliminar-factura', f.id) + '>' + VF.ui.icono('eliminar') + '<span>Eliminar</span></button>';
    html += '<div class="fila mt-2">' + botones + '</div>';
    return html;
  }

  /** Abre (o refresca) el modal de detalle de una factura. → api del modal | null */
  function abrirDetalle(id) {
    var est = estado();
    if (!est) return null;
    var f = buscar(est.facturas, id);
    if (!f) { toast('La factura ya no existe.', 'alerta'); return null; }
    if (abiertos.factura && abiertos.factura.id === id) { refrescarDetalles(); return abiertos.factura.api; }
    if (abiertos.factura) abiertos.factura.api.cerrar();
    var api = VF.ui.modal({
      titulo: 'Factura ' + f.folio,
      cuerpo: cuerpoDetalle(est, f),
      botones: [{ texto: 'Cerrar', tono: 'secundario' }],
      alCerrar: function () { if (abiertos.factura && abiertos.factura.api === api) abiertos.factura = null; }
    });
    api.elemento.setAttribute('data-factura', f.id);
    abiertos.factura = { id: f.id, api: api };
    return api;
  }

  /* ---------- modal: detalle de cliente ------------------------------------ */
  function cuerpoDetalleCliente(est, c) {
    var fs = (est.facturas || []).filter(function (f) { return f.clienteId === c.id; });
    fs.sort(function (a, b) { return (a.fechaEmision || '') < (b.fechaEmision || '') ? 1 : -1; });
    var pc = VF.calc.porCobrar(est);
    var s = null;
    pc.porCliente.forEach(function (x) { if (x.clienteId === c.id) s = x; });
    var html = '<p class="fila mb-2">' + VF.ui.badgeAmbito('empresa') +
      (s && s.vencido > 0 ? '<span class="badge badge-negativo">Vencido ' + esc(fmt(s.vencido)) + '</span>' : (s ? '<span class="badge badge-alerta">Por cobrar ' + esc(fmt(s.total)) + '</span>' : '<span class="badge badge-positivo">Sin saldo pendiente</span>')) + '</p>';
    html += filaCifra('RFC', c.rfc ? '<span class="cifra">' + esc(c.rfc) + '</span>' : '<span class="texto-3">—</span>');
    html += filaCifra('Correo', c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '<span class="texto-3">—</span>');
    html += filaCifra('Teléfono', c.telefono ? '<a href="tel:' + esc(String(c.telefono).replace(/\s/g, '')) + '">' + esc(c.telefono) + '</a>' : '<span class="texto-3">—</span>');
    if (c.notas) html += '<p class="aviso mt-1 mb-1"><strong>Notas:</strong> ' + esc(c.notas) + '</p>';
    html += '<hr>';
    html += '<div class="rejilla-3 mb-1">' +
      '<div><p class="kpi-titulo">Facturas</p><p class="kpi-valor">' + (fs.length ? fs.length : '<span class="texto-3">Ninguna</span>') + '</p></div>' +
      '<div><p class="kpi-titulo">Por cobrar</p><p class="kpi-valor">' + (s ? esc(fmt(s.total)) : '<span class="texto-3">—</span>') + '</p></div>' +
      '<div><p class="kpi-titulo">Vencido</p><p class="kpi-valor ' + (s && s.vencido > 0 ? 'negativo' : '') + '">' + (s && s.vencido > 0 ? esc(fmt(s.vencido)) : '<span class="texto-3">—</span>') + '</p></div>' +
      '</div>';
    html += '<h3 class="mt-2">Facturas</h3>';
    html += fs.length
      ? '<p class="texto-3 mb-1">Toca una factura para ver su detalle.</p>' + tablaFacturas(est, fs, { sinCliente: true, compacta: true }, 'Sin facturas')
      : '<p class="texto-2">Este cliente aún no tiene facturas.</p>';
    html += '<div class="fila mt-2">' +
      '<button type="button" class="btn btn-primario" ' + accion('fac-nueva-factura', null, ' data-cliente="' + esc(c.id) + '"') + '>' + VF.ui.icono('agregar') + '<span>Nueva factura</span></button>' +
      '<button type="button" class="btn btn-secundario" ' + accion('fac-editar-cliente', c.id) + '>' + VF.ui.icono('editar') + '<span>Editar</span></button>' +
      '<button type="button" class="btn btn-fantasma negativo" ' + accion('fac-eliminar-cliente', c.id) + '>' + VF.ui.icono('eliminar') + '<span>Eliminar</span></button>' +
      '</div>';
    return html;
  }

  function abrirDetalleCliente(id) {
    var est = estado();
    if (!est) return null;
    var c = buscar(est.clientes, id);
    if (!c) { toast('El cliente ya no existe.', 'alerta'); return null; }
    if (abiertos.cliente && abiertos.cliente.id === id) { refrescarDetalles(); return abiertos.cliente.api; }
    if (abiertos.cliente) abiertos.cliente.api.cerrar();
    var api = VF.ui.modal({
      titulo: c.nombre,
      cuerpo: cuerpoDetalleCliente(est, c),
      botones: [{ texto: 'Cerrar', tono: 'secundario' }],
      alCerrar: function () { if (abiertos.cliente && abiertos.cliente.api === api) abiertos.cliente = null; }
    });
    api.elemento.setAttribute('data-cliente', c.id);
    abiertos.cliente = { id: c.id, api: api };
    return api;
  }

  /** Vuelve a pintar el cuerpo de los modales de detalle abiertos (o los cierra si el registro ya no existe). */
  function refrescarDetalles() {
    var est = estado();
    if (!est) return;
    if (abiertos.factura) {
      var f = buscar(est.facturas, abiertos.factura.id);
      if (!f) abiertos.factura.api.cerrar();
      else {
        var cuerpoF = abiertos.factura.api.elemento.querySelector('.modal-cuerpo');
        if (cuerpoF) cuerpoF.innerHTML = cuerpoDetalle(est, f);
        var h2F = abiertos.factura.api.elemento.querySelector('.modal-cabecera h2');
        if (h2F) h2F.textContent = 'Factura ' + f.folio;
      }
    }
    if (abiertos.cliente) {
      var c = buscar(est.clientes, abiertos.cliente.id);
      if (!c) abiertos.cliente.api.cerrar();
      else {
        var cuerpoC = abiertos.cliente.api.elemento.querySelector('.modal-cuerpo');
        if (cuerpoC) cuerpoC.innerHTML = cuerpoDetalleCliente(est, c);
        var h2C = abiertos.cliente.api.elemento.querySelector('.modal-cabecera h2');
        if (h2C) h2C.textContent = c.nombre;
      }
    }
  }

  /* ---------- modal: alta / edición de cliente ------------------------------ */
  function abrirFormularioCliente(id) {
    var est = estado();
    if (!est) return null;
    var existente = id ? buscar(est.clientes, id) : null;
    if (id && !existente) { toast('El cliente ya no existe.', 'alerta'); return null; }
    var valores = existente
      ? { nombre: existente.nombre || '', rfc: existente.rfc || '', email: existente.email || '', telefono: existente.telefono || '', notas: existente.notas || '' }
      : { nombre: '', rfc: '', email: '', telefono: '', notas: '' };
    var campos = [
      { nombre: 'nombre', etiqueta: 'Nombre o razón social', tipo: 'texto', requerido: true, maxlength: 120, placeholder: 'Ej. Desarrollos Altavista SA de CV', autofoco: true },
      { nombre: 'rfc', etiqueta: 'RFC', tipo: 'texto', maxlength: 13, placeholder: 'Opcional · 12 o 13 caracteres' },
      { nombre: 'email', etiqueta: 'Correo', tipo: 'email', maxlength: 120, placeholder: 'pagos@cliente.mx' },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', maxlength: 30, placeholder: '55 0000 0000' },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2, placeholder: 'Condiciones de pago, contacto, proyecto…' }
    ];
    var envoltura = VF.ui.el('<div>' + VF.ui.formulario(campos, valores) + '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['email', 'telefono']);

    var reglas = {
      nombre: function (x) { return String(x || '').trim() ? null : 'Escribe el nombre del cliente'; },
      rfc: function (x) {
        x = String(x || '').trim().toUpperCase();
        if (!x) return null;
        return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(x) ? null : 'RFC inválido: usa 12 (persona moral) o 13 caracteres (persona física)';
      }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var registro = { nombre: v.nombre, rfc: String(v.rfc || '').toUpperCase(), email: v.email, telefono: v.telefono, notas: v.notas };
      try {
        if (existente) {
          VF.store.actualizar('clientes', existente.id, registro);
          toast('Cliente actualizado', 'exito');
        } else {
          VF.store.agregar('clientes', registro);
          toast('Cliente guardado', 'exito');
        }
      } catch (e) {
        toast(mensajeError(e), 'error', 5000);
        return false;
      }
      return true;
    }

    var api = VF.ui.modal({
      titulo: existente ? 'Editar cliente' : 'Nuevo cliente',
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

  function eliminarCliente(id) {
    var est = estado();
    if (!est) return;
    var c = buscar(est.clientes, id);
    if (!c) { toast('El cliente ya no existe.', 'alerta'); return; }
    var n = (est.facturas || []).filter(function (f) { return f.clienteId === id; }).length;
    var mensaje = n
      ? '¿Eliminar al cliente «' + c.nombre + '»? Tiene ' + plural(n, 'factura registrada', 'facturas registradas') + '; la aplicación no permite borrar clientes con facturas.'
      : '¿Eliminar al cliente «' + c.nombre + '»? Esta acción no se puede deshacer.';
    VF.ui.confirmar(mensaje, { peligro: true, titulo: 'Eliminar cliente', textoAceptar: 'Eliminar' }).then(function (ok) {
      if (!ok) return;
      try {
        VF.store.eliminar('clientes', id);
        toast('Cliente eliminado', 'exito');
        if (abiertos.cliente && abiertos.cliente.id === id) abiertos.cliente.api.cerrar();
      } catch (e) {
        // El store protege la integridad (CLIENTE_CON_FACTURAS): se explica de forma amable.
        toast(mensajeError(e), 'error', 6000);
      }
    });
  }

  /* ---------- modal: alta / edición de factura ----------------------------- */
  function abrirFormularioFactura(opciones) {
    var o = opciones || {};
    var est = estado();
    if (!est) return null;
    var existente = o.id ? buscar(est.facturas, o.id) : null;
    if (o.id && !existente) { toast('La factura ya no existe.', 'alerta'); return null; }
    if (existente && existente.estado === 'cancelada') { toast('Una factura cancelada no se edita. Reactívala primero.', 'alerta'); return null; }
    var clientes = U.ordenar(est.clientes || [], 'nombre');
    if (!clientes.length) {
      return VF.ui.modal({
        titulo: 'Nueva factura',
        cuerpo: VF.ui.vacio('Primero registra un cliente para poder facturar.', 'Nuevo cliente', function () {
          trasCerrarModales(function () { abrirFormularioCliente(); });
        }),
        botones: [{ texto: 'Cerrar', tono: 'secundario' }]
      });
    }
    var h = hoy();
    var pagado = existente ? pagadoDe(existente) : 0;
    var valores = existente ? {
      clienteId: existente.clienteId, folio: existente.folio, estado: existente.estado === 'borrador' ? 'borrador' : 'emitida',
      fechaEmision: existente.fechaEmision, fechaVencimiento: existente.fechaVencimiento, concepto: existente.concepto || '',
      subtotal: existente.subtotal, sinIva: !(existente.iva > 0), uuidCfdi: existente.uuidCfdi || '', notas: existente.notas || ''
    } : {
      clienteId: buscar(clientes, o.clienteId) ? o.clienteId : (clientes.length === 1 ? clientes[0].id : ''),
      folio: siguienteFolio(est), estado: 'emitida', fechaEmision: h, fechaVencimiento: U.sumarDias(h, DIAS_CREDITO),
      concepto: '', subtotal: '', sinIva: false, uuidCfdi: '', notas: ''
    };
    var campos = [
      { nombre: 'clienteId', etiqueta: 'Cliente', tipo: 'select', requerido: true, placeholder: 'Elige un cliente',
        opciones: clientes.map(function (c) { return { valor: c.id, texto: c.nombre }; }) },
      { nombre: 'folio', etiqueta: 'Folio', tipo: 'texto', requerido: true, maxlength: 20, ayuda: existente ? undefined : 'Siguiente al mayor existente; puedes cambiarlo.' },
      { nombre: 'estado', etiqueta: 'Estado', tipo: 'select',
        opciones: [{ valor: 'emitida', texto: 'Emitida' }, { valor: 'borrador', texto: 'Borrador' }],
        ayuda: 'Los borradores no cuentan en cuentas por cobrar.' },
      { nombre: 'fechaEmision', etiqueta: 'Fecha de emisión', tipo: 'fecha', requerido: true },
      { nombre: 'fechaVencimiento', etiqueta: 'Fecha de vencimiento', tipo: 'fecha', requerido: true, ayuda: 'Por defecto ' + DIAS_CREDITO + ' días después de la emisión.' },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'texto', requerido: true, maxlength: 160, placeholder: 'Servicio o producto facturado' },
      { nombre: 'subtotal', etiqueta: 'Subtotal (MXN)', tipo: 'monto', requerido: true, min: 0.01, placeholder: '0.00' },
      { nombre: 'sinIva', etiqueta: 'Sin IVA', tipo: 'checkbox', ayuda: 'Marca si la operación no causa IVA (tasa 0 % o exenta). Si no, se calcula el 16 %.' },
      { nombre: 'uuidCfdi', etiqueta: 'UUID del CFDI (folio fiscal)', tipo: 'texto', maxlength: 36, placeholder: 'Opcional' },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2 }
    ];
    var envoltura = VF.ui.el('<div>' +
      (existente && pagado > 0 ? '<p class="aviso aviso-alerta">Esta factura ya tiene pagos por ' + esc(fmt(pagado)) + '. El nuevo total no puede ser menor a lo pagado.</p>' : '') +
      VF.ui.formulario(campos, valores) +
      '<div class="aviso" data-resumen aria-live="polite"></div>' +
      '</div>');
    var form = envoltura.querySelector('form');
    var resumen = envoltura.querySelector('[data-resumen]');
    agruparCampos(form, ['folio', 'estado']);
    agruparCampos(form, ['fechaEmision', 'fechaVencimiento']);
    agruparCampos(form, ['subtotal', 'sinIva']);

    function actualizarResumen() {
      var v = VF.ui.leerFormulario(form);
      var imp = calcularImportes(isNaN(v.subtotal) ? 0 : v.subtotal, v.sinIva);
      resumen.innerHTML =
        '<div class="fila-entre"><span class="texto-2">Subtotal</span><strong class="cifra" data-resumen-subtotal>' + esc(fmt(imp.subtotal)) + '</strong></div>' +
        '<div class="fila-entre"><span class="texto-2">' + (v.sinIva ? 'IVA (sin IVA)' : 'IVA 16 %') + '</span><strong class="cifra" data-resumen-iva>' + esc(fmt(imp.iva)) + '</strong></div>' +
        '<div class="fila-entre"><span>Total</span><strong class="cifra" data-resumen-total>' + esc(fmt(imp.total)) + '</strong></div>';
    }

    var vencimientoTocado = !!existente;
    form.addEventListener('input', function (e) {
      var campo = e.target && e.target.getAttribute ? e.target.getAttribute('data-campo') : null;
      if (campo === 'subtotal') actualizarResumen();
    });
    form.addEventListener('change', function (e) {
      var campo = e.target && e.target.getAttribute ? e.target.getAttribute('data-campo') : null;
      if (campo === 'sinIva' || campo === 'subtotal') actualizarResumen();
      if (campo === 'fechaVencimiento') vencimientoTocado = true;
      if (campo === 'fechaEmision' && !vencimientoTocado) {
        var emision = form.querySelector('[data-campo="fechaEmision"]').value;
        var venc = form.querySelector('[data-campo="fechaVencimiento"]');
        if (venc && /^\d{4}-\d{2}-\d{2}$/.test(emision)) venc.value = U.sumarDias(emision, DIAS_CREDITO);
      }
    });

    var reglas = {
      clienteId: function (x) { return x ? null : 'Elige un cliente'; },
      folio: function (x) {
        x = String(x || '').trim();
        if (!x) return 'Escribe un folio';
        var dup = (est.facturas || []).some(function (f) {
          return String(f.folio || '').toLowerCase() === x.toLowerCase() && (!existente || f.id !== existente.id);
        });
        return dup ? 'Ya existe una factura con el folio ' + x : null;
      },
      subtotal: function (x, vals) {
        if (!(x > 0)) return 'Ingresa un subtotal mayor a cero';
        var imp = calcularImportes(x, vals.sinIva);
        if (pagado > 0 && imp.total < pagado) return 'El total (' + fmt(imp.total) + ') no puede ser menor a lo ya pagado (' + fmt(pagado) + ')';
        return null;
      },
      fechaVencimiento: function (x, vals) {
        return x && vals.fechaEmision && x < vals.fechaEmision ? 'El vencimiento no puede ser anterior a la emisión' : null;
      },
      estado: function (x) {
        return pagado > 0 && x === 'borrador' ? 'Una factura con pagos no puede volver a borrador' : null;
      }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      var estAhora = estado();
      if (!estAhora) return false;
      if (!buscar(estAhora.clientes, v.clienteId)) { toast('El cliente elegido ya no existe.', 'error'); return false; }
      var imp = calcularImportes(v.subtotal, v.sinIva);
      var registro = {
        clienteId: v.clienteId,
        folio: String(v.folio || '').trim(),
        fechaEmision: v.fechaEmision,
        fechaVencimiento: v.fechaVencimiento,
        concepto: v.concepto,
        subtotal: imp.subtotal,
        iva: imp.iva,
        total: imp.total,
        estado: v.estado === 'borrador' ? 'borrador' : 'emitida',
        uuidCfdi: String(v.uuidCfdi || '').trim().toUpperCase(),
        notas: v.notas
      };
      try {
        if (existente) {
          VF.store.actualizar('facturas', existente.id, registro);
          toast('Factura ' + registro.folio + ' actualizada', 'exito');
        } else {
          VF.store.agregar('facturas', Object.assign({ pagos: [] }, registro));
          toast('Factura ' + registro.folio + ' guardada', 'exito');
        }
      } catch (e) {
        toast(mensajeError(e), 'error', 5000);
        return false;
      }
      return true;
    }

    var api = VF.ui.modal({
      titulo: existente ? 'Editar factura ' + existente.folio : 'Nueva factura',
      cuerpo: envoltura,
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: existente ? 'Guardar cambios' : 'Guardar factura', tono: 'primario', accion: guardar }
      ]
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (guardar() !== false) api.cerrar();
    });
    actualizarResumen();
    return api;
  }

  /* ---------- acciones sobre una factura ----------------------------------- */
  function cambiarEstadoFactura(id, nuevo, mensaje) {
    var est = estado();
    if (!est) return;
    var f = buscar(est.facturas, id);
    if (!f) { toast('La factura ya no existe.', 'alerta'); return; }
    try {
      VF.store.actualizar('facturas', id, { estado: nuevo });
      toast(mensaje, 'exito');
    } catch (e) {
      toast(mensajeError(e), 'error', 5000);
    }
  }

  function emitirFactura(id) { cambiarEstadoFactura(id, 'emitida', 'Factura emitida'); }
  function reactivarFactura(id) { cambiarEstadoFactura(id, 'emitida', 'Factura reactivada'); }

  function cancelarFactura(id) {
    var est = estado();
    if (!est) return;
    var f = buscar(est.facturas, id);
    if (!f) { toast('La factura ya no existe.', 'alerta'); return; }
    if (f.estado === 'cancelada') return;
    if ((f.pagos || []).length) {
      toast('La factura ' + f.folio + ' tiene pagos registrados. Elimina primero sus pagos para cancelarla.', 'alerta', 6000);
      return;
    }
    VF.ui.confirmar('¿Cancelar la factura ' + f.folio + '? Dejará de contar en cuentas por cobrar; podrás reactivarla después.',
      { peligro: true, titulo: 'Cancelar factura', textoAceptar: 'Cancelar factura', textoCancelar: 'Volver' }).then(function (ok) {
      if (ok) cambiarEstadoFactura(id, 'cancelada', 'Factura ' + f.folio + ' cancelada');
    });
  }

  function eliminarFactura(id) {
    var est = estado();
    if (!est) return;
    var f = buscar(est.facturas, id);
    if (!f) { toast('La factura ya no existe.', 'alerta'); return; }
    var n = (f.pagos || []).length;
    var mensaje = '¿Eliminar la factura ' + f.folio + '?' +
      (n ? ' También se eliminarán sus ' + plural(n, 'pago') + ' y los movimientos de ingreso vinculados; los saldos de las cuentas se recalcularán.' : ' Esta acción no se puede deshacer.');
    VF.ui.confirmar(mensaje, { peligro: true, titulo: 'Eliminar factura', textoAceptar: 'Eliminar' }).then(function (ok) {
      if (!ok) return;
      try {
        VF.store.eliminar('facturas', id);
        toast('Factura ' + f.folio + ' eliminada', 'exito');
      } catch (e) {
        toast(mensajeError(e), 'error', 5000);
      }
    });
  }

  function eliminarPagoConfirmando(facturaId, pagoId) {
    var est = estado();
    if (!est) return;
    var f = buscar(est.facturas, facturaId);
    var p = f ? buscar(f.pagos || [], pagoId) : null;
    if (!f || !p) { toast('El pago ya no existe.', 'alerta'); return; }
    VF.ui.confirmar('¿Eliminar el pago de ' + fmt(p.monto) + ' del ' + U.fmtFecha(p.fecha) + '? Se eliminará también su movimiento de ingreso y el saldo de la cuenta se recalculará.',
      { peligro: true, titulo: 'Eliminar pago', textoAceptar: 'Eliminar pago' }).then(function (ok) {
      if (!ok) return;
      try {
        eliminarPago(facturaId, pagoId);
        toast('Pago eliminado; el movimiento se revirtió', 'exito');
      } catch (e) {
        toast(mensajeError(e), 'error', 5000);
      }
    });
  }

  /* ---------- modal: registrar pago ---------------------------------------- */
  function abrirFormularioPago(facturaId) {
    var est = estado();
    if (!est) return null;
    var f = buscar(est.facturas, facturaId);
    if (!f) { toast('La factura ya no existe.', 'alerta'); return null; }
    if (!cobrable(f)) { toast(MENSAJES_ERROR.FACTURA_NO_COBRABLE, 'alerta', 5000); return null; }
    var pendiente = pendienteDe(f);
    var pagado = pagadoDe(f);
    var cuentas = cuentasEmpresa(est);
    var campos = [
      { nombre: 'monto', etiqueta: 'Monto recibido (MXN)', tipo: 'monto', requerido: true, min: 0.01, max: pendiente, ayuda: 'Máximo el pendiente: ' + fmt(pendiente) + '. Un monto menor registra un pago parcial.' },
      { nombre: 'fecha', etiqueta: 'Fecha del pago', tipo: 'fecha', requerido: true },
      { nombre: 'cuentaId', etiqueta: 'Cuenta de empresa donde se recibió', tipo: 'select', requerido: true, placeholder: 'Elige una cuenta',
        opciones: cuentas.map(function (c) { return { valor: c.id, texto: c.nombre + (c.banco ? ' · ' + c.banco : '') }; }),
        ayuda: 'Se creará un ingreso con categoría «' + CATEGORIA_PAGO + '» vinculado a la factura.' }
    ];
    var valores = { monto: pendiente, fecha: hoy(), cuentaId: cuentas.length === 1 ? cuentas[0].id : '' };
    var envoltura = VF.ui.el('<div>' +
      (cuentas.length ? '' : '<p class="aviso aviso-alerta">No hay cuentas de empresa activas. <a href="#/empresa">Crea una cuenta en Empresa</a> para poder registrar el cobro.</p>') +
      '<p class="texto-2 mb-2">Factura <strong>' + esc(f.folio) + '</strong> · ' + esc(nombreCliente(est, f.clienteId)) + '<br>' +
      'Total ' + esc(fmt(f.total)) + (pagado > 0 ? ' · pagado ' + esc(fmt(pagado)) : '') + ' · <strong>pendiente ' + esc(fmt(pendiente)) + '</strong></p>' +
      VF.ui.formulario(campos, valores) +
      '</div>');
    var form = envoltura.querySelector('form');
    agruparCampos(form, ['monto', 'fecha']);

    var reglas = {
      monto: function (x) {
        if (!(x > 0)) return 'Ingresa un monto mayor a cero';
        if (x > pendiente + 0.001) return 'El monto no puede ser mayor al pendiente (' + fmt(pendiente) + ')';
        return null;
      },
      cuentaId: function (x) { return x ? null : 'Elige una cuenta de empresa'; }
    };

    function guardar() {
      if (!VF.ui.validar(form, reglas)) return false;
      var v = VF.ui.leerFormulario(form);
      try {
        registrarPago(f.id, { monto: v.monto, fecha: v.fecha, cuentaId: v.cuentaId });
        var fAhora = buscar(estado().facturas, f.id);
        var liquidada = fAhora && pendienteDe(fAhora) <= 0;
        toast(liquidada ? 'Pago registrado: la factura ' + f.folio + ' quedó pagada' : 'Pago parcial registrado en la factura ' + f.folio, 'exito');
      } catch (e) {
        toast(mensajeError(e), 'error', 5000);
        return false;
      }
      return true;
    }

    var api = VF.ui.modal({
      titulo: 'Registrar pago · ' + f.folio,
      cuerpo: envoltura,
      botones: [
        { texto: 'Cancelar', tono: 'secundario' },
        { texto: 'Registrar pago', tono: 'primario', accion: guardar }
      ]
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (guardar() !== false) api.cerrar();
    });
    return api;
  }

  /* ---------- delegación de eventos (data-accion="fac-…") ------------------ */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-accion^="fac-"]') : null;
    if (!t) return;
    if (!VF.store.estaDesbloqueado()) return;
    var accionNombre = t.getAttribute('data-accion');
    var id = t.getAttribute('data-id');
    var enModal = !!t.closest('.modal');
    switch (accionNombre) {
      case 'fac-nueva-factura':
        abrirFormularioFactura({ clienteId: t.getAttribute('data-cliente') || '' });
        break;
      case 'fac-nuevo-cliente':
        abrirFormularioCliente();
        break;
      case 'fac-ver-factura':
        if (enModal) trasCerrarModales(function () { abrirDetalle(id); });
        else abrirDetalle(id);
        break;
      case 'fac-editar-factura':
        abrirFormularioFactura({ id: id });
        break;
      case 'fac-eliminar-factura':
        eliminarFactura(id);
        break;
      case 'fac-emitir-factura':
        emitirFactura(id);
        break;
      case 'fac-cancelar-factura':
        cancelarFactura(id);
        break;
      case 'fac-reactivar-factura':
        reactivarFactura(id);
        break;
      case 'fac-registrar-pago':
        abrirFormularioPago(id);
        break;
      case 'fac-eliminar-pago':
        eliminarPagoConfirmando(id, t.getAttribute('data-pago'));
        break;
      case 'fac-ver-movimiento':
        if (VF.panel && typeof VF.panel.verMovimiento === 'function') VF.panel.verMovimiento(id);
        else toast('El detalle de movimientos está en el Panel.', 'info');
        break;
      case 'fac-ver-cliente':
        if (enModal) trasCerrarModales(function () { abrirDetalleCliente(id); });
        else abrirDetalleCliente(id);
        break;
      case 'fac-editar-cliente':
        abrirFormularioCliente(id);
        break;
      case 'fac-eliminar-cliente':
        eliminarCliente(id);
        break;
      case 'fac-pestana':
        cambiarPestana(t.getAttribute('data-valor'));
        break;
      case 'fac-agrupar':
        if (!vista) return;
        vista.agrupar = !vista.agrupar;
        t.outerHTML = botonAgrupar(vista.agrupar);
        pintarLista();
        break;
      case 'fac-limpiar-filtros':
        if (!vista) return;
        vista.busqueda = '';
        vista.clienteId = '';
        vista.filtro = vista.ruta === 'cobros' ? 'pendientes' : 'todas';
        pintarSeccion();
        break;
      default:
        break;
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#fac-cuerpo') || !vista) return;
    if (t.getAttribute('data-filtro') === 'clienteId') {
      vista.clienteId = t.value;
      pintarLista();
    }
  });

  var buscarConRetardo = U.debounce(function () { pintarLista(); }, 180);
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#fac-cuerpo') || !vista) return;
    if (t.getAttribute('data-filtro') === 'busqueda') {
      vista.busqueda = t.value;
      buscarConRetardo();
    }
  });

  /* ---------- reacción a cambios del store --------------------------------- */
  VF.store.on('cambio', function () {
    clearTimeout(temporizadorCambio);
    temporizadorCambio = setTimeout(function () {
      if (!VF.store.estaDesbloqueado()) return;
      refrescarDetalles();
      if (!esRutaActiva()) return;
      pintarCuerpo();
    }, 30);
  });
  VF.store.on('bloqueado', function () {
    vista = null;
    abiertos = { factura: null, cliente: null };
  });

  /* ---------- registro ----------------------------------------------------- */
  VF.router.registrar('facturas', { titulo: 'Facturas y cobros', icono: 'facturas', nav: 'mas', render: render });
  VF.router.registrar('cobros', { titulo: 'Cobros', icono: 'cobros', nav: false, render: render });

  VF.facturas = {
    render: render,
    nuevaFactura: abrirFormularioFactura,     // ({ clienteId?, id? }) → api del modal
    verFactura: abrirDetalle,                 // (facturaId) → api del modal
    nuevoCliente: abrirFormularioCliente,     // (clienteId?) → api del modal (con id edita)
    verCliente: abrirDetalleCliente,          // (clienteId) → api del modal
    registrarPago: abrirFormularioPago,       // (facturaId) → api del modal
    agregarPago: registrarPago,               // (facturaId, { monto, fecha, cuentaId }) → pago (sin modal)
    quitarPago: eliminarPago,                 // (facturaId, pagoId) → true (sin modal)
    siguienteFolio: function () { var est = estado(); return est ? siguienteFolio(est) : null; },
    calcularImportes: calcularImportes        // (subtotal, sinIva) → { subtotal, iva, total }
  };
})(window.VF);
